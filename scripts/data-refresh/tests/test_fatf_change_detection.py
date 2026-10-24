"""FATF transport changes are provenance updates, not list amendments."""
from __future__ import annotations

import copy
import importlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
common = importlib.import_module("scripts.data-refresh.common")
notify = importlib.import_module("scripts.data-refresh.notify_email")
builder = importlib.import_module("scripts.data-refresh.build_legal_workbook")

FATF = "fatf-jurisdictions"
CHANGED_AT = "2026-06-19T12:00:00+00:00"
OFFICIAL = "https://www.fatf-gafi.org/en/publications/example.html"
FIAU = "https://fiaumalta.org/country-statements/"
OLD = [
    {"country": "DPRK", "status": "Blacklist (Call for Action)",
     "publication_date": "19 June 2026", "source_url": OFFICIAL},
    {"country": "Côte d’Ivoire", "status": "Greylist (Increased Monitoring)",
     "publication_date": "19 June 2026", "source_url": OFFICIAL},
]


def mirrored():
    rows = copy.deepcopy(OLD)
    rows[0].update(country="North Korea", status="Call for Action")
    rows[1].update(country="Cote d'Ivoire", status="Increased Monitoring")
    for row in rows:
        row.update(publication_date="2026-06-19", source_url=FIAU,
                   source_provider="FIAU 转载 FATF", actual_source_url=FIAU + "latest.pdf")
    return rows


class ResolvedFetcher(common.Fetcher):
    id = FATF
    name = "FATF"
    out_filename = "fatf-jurisdictions.xlsx"
    url = OFFICIAL

    def __init__(self, rows):
        self.rows = rows

    def fetch(self):
        self.url = FIAU
        self.source_provider = "FIAU 转载 FATF"
        return copy.deepcopy(self.rows)

    def columns(self):
        return [("country", "Country", 30)]


class FatfChangeDetectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / "downloads"
        self.snapshots = self.output / "_snapshots"
        self.snapshots.mkdir(parents=True)
        self.manifest = self.output / "_manifest.json"
        for module, attribute, value in [
            (common, "REPO_ROOT", self.root), (common, "OUTPUT_DIR", self.output),
            (common, "SNAPSHOT_DIR", self.snapshots),
            (notify, "SNAPSHOT_DIR", self.snapshots),
            (notify, "MANIFEST_FILE", self.manifest),
        ]:
            mock = patch.object(module, attribute, value)
            mock.start()
            self.addCleanup(mock.stop)
        self.excel = patch.object(common, "write_excel").start()
        self.addCleanup(patch.stopall)
        self.logger = MagicMock()

    def snapshot(self, rows):
        (self.snapshots / f"{FATF}.json").write_text(json.dumps(rows))

    def legacy(self, rows=OLD):
        return {"contentHash": common.content_hash(rows), "records": len(rows),
                "contentChangedAt": CHANGED_AT}

    def run_rows(self, rows, previous):
        return common.run_fetcher(ResolvedFetcher(rows), self.logger, previous)

    def test_metadata_and_alias_changes_migrate_without_list_notification(self):
        self.snapshot(OLD)
        previous = self.legacy()
        entry = self.run_rows(mirrored(), previous)
        self.assertEqual(entry["status"], "success")
        self.assertFalse(entry["changed"])
        self.assertEqual(entry["hashSchema"], common.FATF_HASH_SCHEMA)
        self.assertEqual(entry["changeDetection"], "migrated-legacy-hash")
        self.assertEqual(entry["contentHash"], common.source_content_hash(FATF, OLD))
        self.assertEqual(entry["previousHash"], previous["contentHash"])
        self.assertEqual(entry["contentChangedAt"], CHANGED_AT)
        # Keep actual provenance in the saved snapshot and About/manifest URL.
        self.assertEqual(common.load_snapshot(FATF), mirrored())
        self.assertEqual(entry["url"], FIAU)
        self.assertEqual(entry["sourceProvider"], "FIAU 转载 FATF")
        self.assertEqual(self.excel.call_args.kwargs["source_url"], FIAU)

    def test_real_amendments_are_not_swallowed_during_hash_migration(self):
        for change in ("add", "remove", "status", "new-statement-date"):
            with self.subTest(change=change):
                self.snapshot(OLD)
                rows = mirrored()
                if change == "add":
                    rows.append(dict(rows[1], country="Haiti"))
                elif change == "remove":
                    rows.pop()
                elif change == "status":
                    rows[0]["status"] = "Increased Monitoring"
                else:
                    for row in rows:
                        row["publication_date"] = "30 October 2026"
                entry = self.run_rows(rows, self.legacy())
                self.assertTrue(entry["changed"])
                self.assertNotEqual(entry["contentChangedAt"], CHANGED_AT)

    def test_missing_or_unmatched_legacy_snapshot_reports_unknown_not_no_change(self):
        for snapshot in (None, [], mirrored(), {"corrupt": "shape"}):
            with self.subTest(snapshot=snapshot):
                path = self.snapshots / f"{FATF}.json"
                path.unlink(missing_ok=True)
                if snapshot is not None:
                    self.snapshot(snapshot)
                entry = self.run_rows(mirrored(), self.legacy())
                self.assertEqual(entry["status"], "success")
                self.assertIsNone(entry["changed"])
                self.assertEqual(entry["changeDetection"], "unverified-legacy-hash")
                self.assertEqual(entry["contentChangedAt"], CHANGED_AT)
                self.logger.warning.assert_called()

    def test_known_semantic_hash_needs_no_old_snapshot(self):
        previous = dict(self.legacy(), hashSchema=common.FATF_HASH_SCHEMA,
                        contentHash=common.source_content_hash(FATF, OLD))
        entry = self.run_rows(mirrored(), previous)
        self.assertFalse(entry["changed"])
        self.assertEqual(entry["changeDetection"], "compared")
        self.assertEqual(entry["contentChangedAt"], CHANGED_AT)

    def test_first_snapshot_does_not_invent_change_time(self):
        entry = self.run_rows(mirrored(), None)
        self.assertFalse(entry["changed"])
        self.assertIsNone(entry["contentChangedAt"])
        self.assertEqual(entry["changeDetection"], "initial-baseline")

    def test_failure_keeps_the_schema_of_the_retained_hash(self):
        for semantic in (False, True):
            with self.subTest(semantic=semantic):
                self.snapshot(OLD)
                previous = self.legacy()
                if semantic:
                    previous.update(hashSchema=common.FATF_HASH_SCHEMA,
                                    contentHash=common.source_content_hash(FATF, OLD))
                with patch.object(common, "write_excel", side_effect=OSError("disk unavailable")):
                    entry = self.run_rows(mirrored(), previous)
                self.assertEqual(entry["status"], "error")
                self.assertEqual(entry["contentHash"], previous["contentHash"])
                self.assertEqual(entry.get("hashSchema"), previous.get("hashSchema"))
                self.assertEqual(entry["contentChangedAt"], CHANGED_AT)

    def test_complete_dates_normalize_but_new_editions_still_differ(self):
        for date in ("2026-06-19", "19th June 2026", "19 June, 2026", "June 19, 2026"):
            with self.subTest(date=date):
                rows = copy.deepcopy(OLD)
                for row in rows:
                    row["publication_date"] = date
                self.assertEqual(common.source_content_hash(FATF, rows),
                                 common.source_content_hash(FATF, OLD))
        rows[0]["publication_date"] = "June 2026"
        self.assertEqual(common.content_rows(FATF, rows)[0]["publication_date"],
                         "unparsed:june 2026")

    def test_non_fatf_hash_and_provenance_diff_remain_unchanged(self):
        fetcher = ResolvedFetcher(mirrored())
        fetcher.id = "ti-cpi"
        entry = common.run_fetcher(fetcher, self.logger, self.legacy())
        self.assertTrue(entry["changed"])
        self.assertEqual(entry["contentHash"], common.content_hash(mirrored()))
        self.assertNotIn("hashSchema", entry)
        self.assertEqual(common.content_rows("ti-cpi", OLD), OLD)

    def diff(self, current, previous, source_id=FATF):
        (self.snapshots / f"{source_id}.json").write_text(json.dumps(current))
        with patch.object(notify, "_load_git_previous_snapshot", return_value=previous):
            return notify.diff_source(source_id)

    def test_email_diff_ignores_metadata_and_country_alias_changes(self):
        result = self.diff(mirrored(), OLD)
        self.assertEqual(result, {"added": [], "removed": [], "modified": [], "available": True})

    def test_email_diff_keeps_actual_add_remove_status_and_date_changes(self):
        rows = mirrored()
        rows[0]["publication_date"] = "30 October 2026"
        rows[1] = dict(rows[1], country="Haiti")
        result = self.diff(rows, OLD)
        self.assertEqual(result["added"], ["haiti"])
        self.assertEqual(result["removed"], ["cote divoire"])
        self.assertEqual(result["modified"], ["north korea"])
        rows = mirrored()
        rows[0]["status"] = "Increased Monitoring"
        self.assertEqual(self.diff(rows, OLD)["modified"], ["north korea"])

    def test_non_fatf_email_diff_still_compares_whole_rows(self):
        rows = copy.deepcopy(OLD)
        rows[0]["source_url"] = FIAU
        self.assertEqual(self.diff(rows, OLD, source_id="ti-cpi")["modified"], ["DPRK"])

    def test_unreadable_semantic_snapshot_is_unavailable_for_email_diff(self):
        self.assertFalse(self.diff(mirrored(), {"invalid": "shape"})["available"])

    def test_email_uses_provider_and_exposes_unknown_comparison(self):
        report = {"fatf": {"seeded": False, "records": 2, "listDate": "2026-10-30",
                           "fetchProvider": "FIAU 转载 FATF"}}
        manifest = {"sources": {FATF: {"status": "success", "records": 2,
                                      "changeDetection": "unverified-legacy-hash"}}}
        with patch.object(builder, "build", return_value=report), \
             patch.object(builder, "default_out_path", return_value=self.output / "attachment.xlsx"), \
             patch.object(notify, "override_drift", return_value=[]):
            _, html, text, _ = notify.build_email(manifest, [], True)
        self.assertIn("本次抓取（FIAU 转载 FATF）", html)
        self.assertNotIn("本次官方抓取", html)
        self.assertIn("[无法比对] FATF", text)
        self.assertNotIn("[无变化] FATF", text)

    def test_metadata_only_change_does_not_trigger_mail(self):
        self.snapshot(OLD)
        entry = self.run_rows(mirrored(), self.legacy())
        self.manifest.write_text(json.dumps({"sources": {FATF: entry}}))
        with patch.object(sys, "argv", ["notify_email"]), \
             patch.object(notify, "baseline_changed", return_value=(False, None, None)), \
             patch.object(notify, "build_email") as build, patch.object(notify, "send") as send:
            self.assertEqual(notify.main(), 0)
        build.assert_not_called()
        send.assert_not_called()

    def test_unknown_migration_does_not_add_a_mail_trigger(self):
        entry = self.run_rows(mirrored(), self.legacy())
        self.assertIsNone(entry["changed"])
        self.manifest.write_text(json.dumps({"sources": {FATF: entry}}))
        with patch.object(sys, "argv", ["notify_email"]), \
             patch.object(notify, "baseline_changed", return_value=(False, None, None)), \
             patch.object(notify, "build_email") as build, patch.object(notify, "send") as send:
            self.assertEqual(notify.main(), 0)
        build.assert_not_called()
        send.assert_not_called()

    def test_actual_list_change_still_triggers_mail(self):
        self.snapshot(OLD)
        rows = mirrored() + [dict(mirrored()[1], country="Haiti")]
        entry = self.run_rows(rows, self.legacy())
        self.manifest.write_text(json.dumps({"sources": {FATF: entry}}))
        recipient = "unit-test@example.invalid"
        with patch.object(sys, "argv", ["notify_email"]), \
             patch.object(notify, "baseline_changed", return_value=(False, None, None)), \
             patch.object(notify, "build_email", return_value=("subject", "html", "text", [])) as build, \
             patch.object(notify, "send", return_value={"sent": True, "recipients": [recipient]}) as send, \
             patch.dict(notify.os.environ, {"SMTP_USER": "sender@example.invalid",
                                           "SMTP_PASSWORD": "UNIT_TEST_ONLY",
                                           "LIST_ALERT_RECIPIENT": recipient}, clear=True):
            self.assertEqual(notify.main(), 0)
        self.assertEqual(build.call_args.args[1], [FATF])
        send.assert_called_once()


if __name__ == "__main__":
    unittest.main()
