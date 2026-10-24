"""Offline regression tests for the FSI entry page and paginated responses."""
from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
tjn = importlib.import_module("scripts.data-refresh.fetchers.tjn_fsi")


def jurisdictions(start=1, stop=142):
    return [{"jurisdiction_id": f"C{i}", "jurisdiction_name_en": f"Country {i}",
             "rank": str(i), "index_value": i * 10, "index_score": 50,
             "index_share": 1 / 141, "gsw": 0.0001} for i in range(start, stop)]


class TjnRegressionTests(unittest.TestCase):
    def run_browser(self, responses, *, late_responses=None, page_status=200, late_at=3):
        page = MagicMock()
        page.title.return_value = "Full list – Financial Secrecy Index"
        handler = None
        waits = 0

        def listen(event, callback):
            nonlocal handler
            if event == "response":
                handler = callback

        def emit(items):
            for item in items:
                status, payload = item[:2]
                collection = item[2] if len(item) > 2 else "fsi2026"
                response = SimpleNamespace(
                    url=f"https://api.data.taxjustice.net/v1/query/{collection}_jurisdictions?token=DO_NOT_LOG",
                    status=status, ok=200 <= status < 300,
                    json=lambda payload=payload: payload)
                handler(response)

        def navigate(*args, **kwargs):
            emit(responses)
            return SimpleNamespace(status=page_status)

        def wait(milliseconds):
            nonlocal waits
            waits += 1
            if late_responses and waits == late_at:
                emit(late_responses)

        page.on.side_effect = listen
        page.goto.side_effect = navigate
        page.wait_for_timeout.side_effect = wait
        browser = MagicMock()
        browser.new_context.return_value.new_page.return_value = page
        pw = MagicMock()
        pw.chromium.launch.return_value = browser
        context = MagicMock()
        context.__enter__.return_value = pw
        with patch.object(tjn, "sync_playwright", return_value=context):
            try:
                rows = tjn.TjnFsiFetcher().fetch()
            finally:
                browser.close.assert_called_once()
        return rows, page

    def test_visits_full_list_instead_of_home_and_collects_complete_index(self):
        rows, page = self.run_browser([(200, jurisdictions())])
        self.assertEqual(len(rows), 141)
        self.assertEqual(rows[0]["rank"], 1)
        self.assertEqual(rows[-1]["rank"], 141)
        self.assertEqual(rows[0]["country"], "Country 1")
        self.assertEqual(rows[0]["global_scale"], 0.01)
        self.assertEqual(page.goto.call_args.args, ("https://fsi.taxjustice.net/full-list/",))
        self.assertEqual(page.goto.call_args.kwargs["wait_until"], "domcontentloaded")

    def test_waits_for_later_batches_and_deduplicates_repeated_requests(self):
        rows, page = self.run_browser(
            [(200, {"data": jurisdictions(1, 76)})],
            late_responses=[(200, {"results": jurisdictions(76, 142)}),
                            (200, jurisdictions(1, 76))])
        self.assertEqual(len(rows), 141)
        self.assertGreaterEqual(page.wait_for_timeout.call_count, 7)

    def test_repeated_single_table_page_is_not_a_successful_snapshot(self):
        with self.assertRaisesRegex(tjn.FetchError, "25 unique jurisdictions"):
            self.run_browser([(200, jurisdictions(1, 26))] * 6)

    def test_api_authorization_error_has_status_but_never_query_token(self):
        with self.assertRaises(tjn.FetchError) as caught:
            self.run_browser([(401, {})])
        message = str(caught.exception)
        self.assertIn("HTTP 401", message)
        self.assertIn("fsi2026_jurisdictions", message)
        self.assertNotIn("DO_NOT_LOG", message)
        self.assertNotIn("token=", message)

    def test_no_response_distinguishes_page_block_from_endpoint_failure(self):
        with self.assertRaisesRegex(tjn.FetchError, "page HTTP 403.*no jurisdiction API response"):
            self.run_browser([], page_status=403)

    def test_100_rows_and_quiet_period_do_not_hide_a_missing_last_batch(self):
        rows, page = self.run_browser(
            [(200, jurisdictions(1, 101))],
            late_responses=[(200, jurisdictions(101, 142))], late_at=12)
        self.assertEqual(len(rows), 141)
        self.assertGreater(page.wait_for_timeout.call_count, 12)

    def test_older_edition_cannot_fill_gaps_in_current_edition(self):
        with self.assertRaisesRegex(tjn.FetchError, "25 unique jurisdictions"):
            self.run_browser([(200, jurisdictions(), "fsi"),
                              (200, jurisdictions(1, 26), "fsi2026")])

    def test_legacy_endpoint_and_country_name_remain_supported(self):
        payload = jurisdictions()
        for d in payload:
            d["jurisdiction_name"] = d.pop("jurisdiction_name_en")
        rows, _ = self.run_browser([(200, payload, "fsi")])
        self.assertEqual(len(rows), 141)

    def test_schema_drift_with_names_but_missing_scores_is_rejected(self):
        payload = jurisdictions()
        for d in payload:
            d.pop("index_score")
        with self.assertRaisesRegex(tjn.FetchError, "schema"):
            self.run_browser([(200, payload)])


if __name__ == "__main__":
    unittest.main()
