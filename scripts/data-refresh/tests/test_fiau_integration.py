"""FIAU fallback selection, recency and source attribution without network calls."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import importlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
fatf = importlib.import_module("scripts.data-refresh.fetchers.fatf")
v = importlib.import_module("scripts.data-refresh.verify_fatf")
NOW = datetime(2026, 10, 24, 9, tzinfo=timezone.utc)

BLACK = ["Iran", "North Korea", "Myanmar"]
GREY = ["Angola", "Bolivia", "Bulgaria", "Cameroon", "Haiti", "Kenya", "Lebanon", "Monaco"]
ROWS = [{"status": status, "country": country, "publication_date": "2026-06-19",
         "source_provider": "FIAU 转载 FATF", "source_url": "https://fiaumalta.org/statement.pdf"}
        for status, names in [("Call for Action", BLACK), ("Increased Monitoring", GREY)]
        for country in names]


class FiauIntegrationTests(unittest.TestCase):
    def setUp(self):
        clock = patch.object(fatf, "datetime", wraps=datetime).start()
        clock.now.return_value = NOW
        self.baseline = patch.object(v, "load_baseline", return_value={"listDate": "2026-06-19"}).start()
        self.calendar = patch.object(v, "baseline_due_check", return_value={
            "due": False, "latestDuePlenary": "2026-06"}).start()
        self.addCleanup(patch.stopall)

    def test_fiau_succeeds_before_browser_or_archive_is_started(self):
        patch.object(fatf, "_http_fetch", side_effect=fatf.FetchError("HTTP 403")).start()
        provider = patch.object(fatf, "fetch_fiau", return_value=copy.deepcopy(ROWS)).start()
        browser = patch.object(fatf, "_playwright_session").start()
        archive = patch.object(fatf, "_wayback_latest").start()
        f = fatf.FatfFetcher()
        rows = f.fetch()
        self.assertEqual(len(rows), len(ROWS))
        self.assertEqual(f._strategy, "fiau-pdf")
        self.assertEqual(f.url, fatf.FIAU_INDEX)
        self.assertEqual(f.source_provider, "FIAU 转载 FATF")
        self.assertIn(("Source provider", "FIAU 转载 FATF"), f.extra_about_rows())
        provider.assert_called_once()
        browser.assert_not_called()
        archive.assert_not_called()

    def test_fiau_older_than_legal_baseline_is_rejected(self):
        self.baseline.return_value = {"listDate": "2026-10-30"}
        with self.assertRaisesRegex(fatf.FetchError, "早于法务基线"):
            fatf.FatfFetcher()._validate_statement_rows(ROWS, "FIAU 转载 FATF")

    def test_fiau_cannot_hide_a_missing_plenary_update_after_grace(self):
        self.calendar.return_value = {"due": True, "latestDuePlenary": "2026-10"}
        with self.assertRaisesRegex(fatf.FetchError, "尚未覆盖应更新期"):
            fatf.FatfFetcher()._validate_statement_rows(ROWS, "FIAU 转载 FATF")

    def test_missing_or_mismatched_dates_are_rejected(self):
        for day in [None, "2026-02-13"]:
            with self.subTest(day=day):
                rows = copy.deepcopy(ROWS)
                rows[0]["publication_date"] = day
                with self.assertRaisesRegex(fatf.FetchError, "同一天"):
                    fatf.FatfFetcher()._validate_statement_rows(rows, "FIAU 转载 FATF")

    def test_future_statement_date_is_rejected(self):
        rows = copy.deepcopy(ROWS)
        next_year = NOW.year + 1
        for row in rows:
            row["publication_date"] = f"{next_year}-06-19"
        with self.assertRaisesRegex(fatf.FetchError, "未来"):
            fatf.FatfFetcher()._validate_statement_rows(rows, "FIAU 转载 FATF")

    def test_invalid_calendar_dates_are_rejected_for_every_transport(self):
        for strategy, provider in [("http", "FATF 官网"), ("fiau-pdf", "FIAU 转载 FATF"),
                                   ("playwright", "FATF 官网"), ("wayback", "FATF 官网存档（Wayback）")]:
            for invalid in ["2026-02-30", "31 June 2026"]:
                with self.subTest(strategy=strategy, invalid=invalid):
                    rows = copy.deepcopy(ROWS)
                    for row in rows:
                        row["publication_date"] = invalid
                    with self.assertRaisesRegex(fatf.FetchError, "有效日历日期"):
                        fatf.FatfFetcher()._accept(rows, strategy, provider, fatf.FATF_INDEX)

    def test_partial_list_is_rejected_before_source_selection(self):
        with self.assertRaisesRegex(fatf.FetchError, "名单不完整"):
            fatf.FatfFetcher()._validate_statement_rows([r for r in ROWS if r["status"] == "Increased Monitoring"], "FIAU 转载 FATF")


    def test_every_acceptance_path_checks_dates_before_mutating_source(self):
        for strategy, provider in [("http", "FATF 官网"), ("fiau-pdf", "FIAU 转载 FATF"),
                                   ("playwright", "FATF 官网"), ("wayback", "FATF 官网存档（Wayback）")]:
            with self.subTest(strategy=strategy):
                rows = copy.deepcopy(ROWS)
                rows[0]["publication_date"] = None
                fetcher = fatf.FatfFetcher()
                with self.assertRaisesRegex(fatf.FetchError, "同一天"):
                    fetcher._accept(rows, strategy, provider, "https://example.invalid/")
                self.assertEqual(fetcher._strategy, "")
                self.assertEqual(fetcher.source_provider, "FATF 官网")



class PublicationGraceTests(unittest.TestCase):
    def test_october_schedule_does_not_prematurely_expire_june(self):
        for day in [24, 30]:
            result = v.baseline_due_check("2026-06-19", datetime(2026, 10, day, tzinfo=v.TZ_SHANGHAI))
            self.assertFalse(result["due"])

    def test_old_edition_is_due_after_month_end_grace(self):
        result = v.baseline_due_check("2026-06-19", datetime(2026, 11, 7, tzinfo=v.TZ_SHANGHAI))
        self.assertTrue(result["due"])
        self.assertEqual(result["latestDuePlenary"], "2026-10")


if __name__ == "__main__":
    unittest.main()
