"""Regression coverage for FATF transport failures, freshness and list integrity.

Run: python -m unittest discover -s scripts/data-refresh/tests -p 'test_fatf.py'
Network and browsers are stubbed; these tests never send alerts or write baselines.
"""
from __future__ import annotations

import importlib
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
fatf = importlib.import_module("scripts.data-refresh.fetchers.fatf")
verifier = importlib.import_module("scripts.data-refresh.verify_fatf")
NOW = datetime(2026, 10, 24, 9, tzinfo=timezone.utc)

BLACK_URL = ("https://www.fatf-gafi.org/en/publications/"
             "High-risk-and-other-monitored-jurisdictions/call-for-action-june-2026.html")
GREY_URL = BLACK_URL.replace("call-for-action", "increased-monitoring")
INDEX = f'<html><title>FATF</title><a href="{BLACK_URL}">Latest</a><a href="{GREY_URL}">Latest</a></html>'
BLACK = ["Democratic People's Republic of Korea", "Iran", "Myanmar"]
GREY = ["Angola", "Bolivia", "Bulgaria", "Cameroon", "Haiti", "Kenya", "Lebanon", "Monaco"]


def statement(kind: str, countries: list[str]) -> str:
    links = "".join(f'<a href="/en/countries/detail/{i}.html">{name}</a>'
                    for i, name in enumerate(countries))
    # The menu links belong to members, not this statement's country facet.
    return (f'<html><title>{kind} - 19 June 2026</title><h1>{kind} - 19 June 2026</h1>'
            f'<div><h6>Country</h6><p>{links}</p></div>'
            '<footer><div><p><a href="/en/countries/detail/South-Africa.html">South Africa</a>'
            '<a href="/en/countries/detail/Turkiye.html">Türkiye</a></p></div></footer></html>')


BLACK_HTML = statement("High-Risk Jurisdictions subject to a Call for Action", BLACK)
GREY_HTML = statement("Jurisdictions under Increased Monitoring", GREY)
PAGES = {fatf.FATF_INDEX: INDEX, fatf.FATF_CURRENT: INDEX,
         BLACK_URL: BLACK_HTML, GREY_URL: GREY_HTML}


class FatfRegressionTests(unittest.TestCase):
    def setUp(self):
        self.dump = patch.object(fatf, "_dump_html").start()
        patch.object(fatf, "fetch_fiau", side_effect=fatf.FetchError("FIAU unavailable in transport test")).start()
        self.clock = patch.object(fatf, "datetime", wraps=datetime).start()
        self.clock.now.return_value = NOW
        self.calendar_clock = patch.object(verifier, "datetime", wraps=datetime).start()
        self.calendar_clock.now.return_value = NOW
        self.baseline = patch.object(verifier, "load_baseline",
                                     return_value={"listDate": "2026-06-19"}).start()
        self.addCleanup(patch.stopall)

    def test_lowercase_blacklist_slug_and_archive_rewrites(self):
        self.assertEqual(fatf._extract_publication_links(INDEX, fatf.FATF_INDEX),
                         (BLACK_URL, GREY_URL))
        replay = INDEX.replace('href="https://', 'href="/web/20260901000000/https://')
        self.assertEqual(fatf._extract_publication_links(replay, fatf.FATF_INDEX),
                         (BLACK_URL, GREY_URL))

    def test_complete_official_http_does_not_require_browser_or_archive(self):
        get = patch.object(fatf, "http_get", side_effect=lambda url, **kw: PAGES[url].encode()).start()
        browser = patch.object(fatf, "_playwright_session").start()
        archive = patch.object(fatf, "_wayback_latest").start()
        fetcher = fatf.FatfFetcher()
        rows = fetcher.fetch()
        self.assertEqual(fetcher._strategy, "http")
        self.assertEqual({r["country"] for r in rows}, set(BLACK + GREY))
        self.assertNotIn("South Africa", {r["country"] for r in rows})
        self.assertEqual(len(rows), 11)
        self.assertEqual(get.call_count, 3)
        browser.assert_not_called()
        archive.assert_not_called()

    def test_partial_http_result_retries_shared_browser_before_archive(self):
        def get(url, **kw):
            if url == GREY_URL:
                raise fatf.FetchError("HTTP 403 on grey statement")
            return PAGES[url].encode()
        patch.object(fatf, "http_get", side_effect=get).start()
        session = patch.object(fatf, "_playwright_session").start()
        page = session.return_value.__enter__.return_value
        render = patch.object(fatf, "_playwright_fetch",
                              side_effect=lambda url, **kw: PAGES[url]).start()
        archive = patch.object(fatf, "_wayback_latest").start()
        fetcher = fatf.FatfFetcher()
        self.assertEqual(len(fetcher.fetch()), 11)
        self.assertEqual(fetcher._strategy, "playwright")
        session.assert_called_once()
        self.assertEqual([c.args[0] for c in render.call_args_list],
                         [fatf.FATF_INDEX, BLACK_URL, GREY_URL])
        self.assertTrue(all(c.kwargs["page"] is page for c in render.call_args_list))
        archive.assert_not_called()

    def test_second_official_entry_is_tried_before_archive(self):
        def get(url, **kw):
            if url == fatf.FATF_INDEX:
                raise fatf.FetchError("index unavailable")
            return PAGES[url].encode()
        patch.object(fatf, "http_get", side_effect=get).start()
        browser = patch.object(fatf, "_playwright_session").start()
        fetcher = fatf.FatfFetcher()
        self.assertEqual(len(fetcher.fetch()), 11)
        self.assertEqual(fetcher._strategy, "http")
        browser.assert_not_called()

    def test_both_live_transports_failed_does_not_accept_106_day_archive(self):
        patch.object(fatf, "_http_fetch", side_effect=fatf.FetchError("HTTP blocked")).start()
        patch.object(fatf, "_playwright_session", side_effect=fatf.FetchError("browser blocked")).start()
        old = (NOW - timedelta(days=106)).isoformat()
        patch.object(fatf, "_wayback_latest", return_value=("https://web.archive.org/old", old)).start()
        get = patch.object(fatf, "http_get").start()
        with self.assertRaises(fatf.FetchError) as err:
            fatf.FatfFetcher().fetch()
        message = str(err.exception)
        self.assertIn("HTTP blocked", message)
        self.assertIn("browser blocked", message)
        self.assertIn("106 days old", message)
        self.assertIn("threshold 45", message)
        get.assert_not_called()

    def test_recent_archive_index_does_not_hide_old_statement_capture(self):
        patch.object(fatf, "_http_fetch", side_effect=fatf.FetchError("blocked")).start()
        patch.object(fatf, "_playwright_session", side_effect=fatf.FetchError("blocked")).start()
        now = NOW
        def capture(url):
            age = 1 if url == fatf.FATF_INDEX else 106
            return "https://web.archive.org/capture", (now - timedelta(days=age)).isoformat()
        archive = patch.object(fatf, "_wayback_latest", side_effect=capture).start()
        patch.object(fatf, "http_get", return_value=INDEX.encode()).start()
        with self.assertRaisesRegex(fatf.FetchError, "106 days old"):
            fatf.FatfFetcher().fetch()
        self.assertEqual([c.args[0] for c in archive.call_args_list], [fatf.FATF_INDEX, BLACK_URL])

    def test_recent_complete_archive_remains_a_valid_final_fallback(self):
        patch.object(fatf, "_http_fetch", side_effect=fatf.FetchError("blocked")).start()
        patch.object(fatf, "_playwright_session", side_effect=fatf.FetchError("blocked")).start()
        stamp = (NOW - timedelta(days=1)).isoformat()
        patch.object(fatf, "_wayback_latest",
                     side_effect=lambda url: ("https://web.archive.org/web/20261023000000/" + url, stamp)).start()
        patch.object(fatf, "http_get",
                     side_effect=lambda url, **kw: PAGES[url.split("/20261023000000/", 1)[1]].encode()).start()
        fetcher = fatf.FatfFetcher()
        self.assertEqual(len(fetcher.fetch()), 11)
        self.assertEqual(fetcher._strategy, "wayback")
        self.assertEqual(fetcher._index_snapshot_date, stamp)

    def test_recent_wayback_capture_cannot_revive_an_expired_fiau_edition(self):
        now = datetime(2026, 11, 8, 9, tzinfo=timezone.utc)
        self.clock.now.return_value = self.calendar_clock.now.return_value = now
        patch.object(fatf, "_http_fetch", side_effect=fatf.FetchError("HTTP blocked")).start()
        rows = [{"status": status, "country": country, "publication_date": "2026-06-19"}
                for status, names in [("Call for Action", BLACK), ("Increased Monitoring", GREY)]
                for country in names]
        patch.object(fatf, "fetch_fiau", return_value=rows).start()
        patch.object(fatf, "_playwright_session", side_effect=fatf.FetchError("browser blocked")).start()
        stamp = (now - timedelta(days=1)).isoformat()
        patch.object(fatf, "_wayback_latest",
                     side_effect=lambda url: ("https://web.archive.org/web/20261107000000/" + url, stamp)).start()
        patch.object(fatf, "http_get",
                     side_effect=lambda url, **kw: PAGES[url.split("/20261107000000/", 1)[1]].encode()).start()
        fetcher = fatf.FatfFetcher()
        with self.assertRaises(fatf.FetchError) as err:
            fetcher.fetch()
        self.assertIn("FIAU republication", str(err.exception))
        self.assertIn("FIAU 转载 FATF 声明 2026-06-19 尚未覆盖应更新期 2026-10", str(err.exception))
        self.assertIn("FATF 官网存档（Wayback） 声明 2026-06-19 尚未覆盖应更新期 2026-10", str(err.exception))
        self.assertEqual(fetcher._strategy, "")

    def test_all_transports_reject_an_edition_older_than_the_legal_baseline(self):
        self.baseline.return_value = {"listDate": "2026-10-20"}
        patch.object(fatf, "http_get", side_effect=lambda url, **kw: PAGES[url.rsplit("/20261023000000/", 1)[-1]].encode()).start()
        patch.object(fatf, "_playwright_session").start()
        patch.object(fatf, "_playwright_fetch", side_effect=lambda url, **kw: PAGES[url]).start()
        patch.object(fatf, "_wayback_latest", side_effect=lambda url: (
            "https://web.archive.org/web/20261023000000/" + url, (NOW - timedelta(days=1)).isoformat())).start()
        fetcher = fatf.FatfFetcher()
        with self.assertRaises(fatf.FetchError) as err:
            fetcher.fetch()
        message = str(err.exception)
        for provider in ["FATF 官网", "FATF 官网存档（Wayback）"]:
            self.assertIn(provider + " 声明 2026-06-19 早于法务基线 2026-10-20", message)
        self.assertEqual(fetcher._strategy, "")

    def test_grey_only_result_is_rejected_before_transport_is_selected(self):
        def get(url, **kw):
            html = statement("High-Risk Jurisdictions subject to a Call for Action", []) if url == BLACK_URL else PAGES[url]
            return html.encode()
        patch.object(fatf, "http_get", side_effect=get).start()
        patch.object(fatf, "_playwright_session", side_effect=fatf.FetchError("unavailable")).start()
        patch.object(fatf, "_wayback_latest", side_effect=fatf.FetchError("unavailable")).start()
        fetcher = fatf.FatfFetcher()
        with self.assertRaises(fatf.FetchError):
            fetcher.fetch()
        self.assertEqual(fetcher._strategy, "")

    def test_browser_statement_does_not_wait_for_unrelated_navigation_links(self):
        page = MagicMock()
        page.goto.return_value = SimpleNamespace(status=200)
        page.content.return_value = BLACK_HTML
        self.assertEqual(fatf._playwright_fetch(BLACK_URL, page=page, publication=True), BLACK_HTML)
        page.wait_for_timeout.assert_not_called()
        page.wait_for_selector.assert_not_called()

    def test_http_challenge_is_not_accepted_even_when_status_is_200(self):
        patch.object(fatf, "http_get", return_value=b'<title>Just a moment...</title>').start()
        with self.assertRaisesRegex(fatf.FetchError, "challenge page"):
            fatf._http_fetch(fatf.FATF_INDEX)


if __name__ == "__main__":
    unittest.main()
