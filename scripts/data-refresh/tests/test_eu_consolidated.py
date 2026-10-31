"""Offline EU XML transport/validation regressions; HTTP binds loopback only."""
from __future__ import annotations

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import http.cookiejar
import importlib
import io
from pathlib import Path
import ssl
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import urllib.response
from unittest.mock import MagicMock, patch

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
eu = importlib.import_module("scripts.data-refresh.fetchers.eu_consolidated")
common = importlib.import_module("scripts.data-refresh.common")

SECRET_URL = "https://webgate.ec.europa.eu/unit/content?token=QUERY_MUST_NOT_APPEAR"


def rows(count=2):
    return [{"kind": "Person", "logical_id": f"EU.TEST.{i}", "listed_on": "2026-10-30",
             "name": f"Test person {i}", "aliases": "", "countries": "Testland",
             "regulation": "TEST/2026", "remarks": ""} for i in range(count)]


XML = b'''<?xml version="1.0" encoding="UTF-8"?>
<export xmlns="http://eu.europa.ec/fpi/fsd/export" generationDate="2026-10-30T10:00:00Z">
 <sanctionEntity euReferenceNumber="EU.TEST.1" logicalId="101">
  <subjectType code="person"/>
  <nameAlias wholeName="   " firstName=" Ada " middleName=" Unit " lastName=" Test "/>
  <nameAlias wholeName="Alias Unit"/>
  <citizenship countryDescription="Testland"/>
  <address countryDescription="Elsewhere"/>
  <regulation publicationTitle="TEST/2026" entryIntoForceDate="2026-10-30"/>
  <remark> Test remark </remark>
 </sanctionEntity>
 <sanctionEntity euReferenceNumber="EU.TEST.2" logicalId="102">
  <subjectType code="enterprise"/><nameAlias wholeName="Unit Organisation"/>
 </sanctionEntity>
</export>'''


def response(raw=XML):
    return urllib.response.addinfourl(io.BytesIO(raw), {}, SECRET_URL, code=200)


def http_error(code):
    return urllib.error.HTTPError(SECRET_URL, code, "unit failure", {}, io.BytesIO(b""))


@contextmanager
def local_server(*, cookie_gate):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.server.requests += 1
            cookies = self.headers.get("Cookie", "")
            cleared = "FSD_SESSIONID=unit-session" in cookies and "XSRF-TOKEN=unit-xsrf" in cookies
            if not cookies:
                self.server.without_cookies += 1
            if cookie_gate and cleared:
                self.send_response(200)
                self.send_header("Content-Type", "application/xml")
                self.send_header("Content-Length", str(len(XML)))
                self.end_headers()
                self.wfile.write(XML)
                return
            self.send_response(307)
            self.send_header("Location", self.path)
            if cookie_gate:
                self.send_header("Set-Cookie", "FSD_SESSIONID=unit-session; Path=/")
                self.send_header("Set-Cookie", "XSRF-TOKEN=unit-xsrf; Path=/")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    server.requests = server.without_cookies = 0
    worker = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    worker.start()
    try:
        yield server, f"http://127.0.0.1:{server.server_port}/content?token=LOCAL_TEST_ONLY"
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


class EuDownloadTests(unittest.TestCase):
    def test_same_url_307_sets_both_cookies_then_downloads_xml(self):
        with local_server(cookie_gate=True) as (server, url), patch.object(eu.time, "sleep") as sleep:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({}),
                urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            self.assertEqual(eu.download_xml(url, opener), XML)
            self.assertEqual(server.requests, 2)
            self.assertEqual(server.without_cookies, 1)
        sleep.assert_not_called()

    def test_persistent_real_redirect_loop_is_bounded_and_retains_guard(self):
        with local_server(cookie_gate=False) as (server, url), patch.object(eu.time, "sleep") as sleep:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({}),
                urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            with self.assertRaises(eu.FetchError) as caught:
                eu.download_xml(url, opener)
            self.assertGreater(server.requests, 2)
            self.assertLessEqual(server.requests, 12)
            self.assertNotIn("LOCAL_TEST_ONLY", str(caught.exception))
        sleep.assert_called_once_with(120)

    def test_transient_http_status_retries_once_with_120_second_cooldown(self):
        for code in (301, 307, 308, 429, 500, 502, 503, 504):
            with self.subTest(code=code), patch.object(eu.time, "sleep") as sleep:
                opener = MagicMock()
                opener.open.side_effect = [http_error(code), response()]
                with self.assertLogs("data-refresh", level="WARNING") as logged:
                    self.assertEqual(eu.download_xml(SECRET_URL, opener), XML)
                self.assertEqual(opener.open.call_count, 2)
                sleep.assert_called_once_with(120)
                self.assertNotIn("QUERY_MUST_NOT_APPEAR", " ".join(logged.output))

    def test_transient_network_failures_retry_once(self):
        for error in (urllib.error.URLError(SECRET_URL), TimeoutError(SECRET_URL),
                      ConnectionResetError(SECRET_URL), http.client.RemoteDisconnected(SECRET_URL)):
            with self.subTest(error=type(error).__name__), patch.object(eu.time, "sleep") as sleep:
                opener = MagicMock()
                opener.open.side_effect = [error, response()]
                self.assertEqual(eu.download_xml(SECRET_URL, opener), XML)
                sleep.assert_called_once_with(120)
                self.assertEqual(opener.open.call_count, 2)

    def test_second_failure_raises_sanitized_error_without_third_request(self):
        opener = MagicMock()
        opener.open.side_effect = [http_error(307), urllib.error.URLError(SECRET_URL)]
        with patch.object(eu.time, "sleep") as sleep, self.assertRaises(eu.FetchError) as caught:
            eu.download_xml(SECRET_URL, opener)
        self.assertEqual(opener.open.call_count, 2)
        sleep.assert_called_once_with(120)
        self.assertNotIn("QUERY_MUST_NOT_APPEAR", str(caught.exception))
        self.assertNotIn("token=", str(caught.exception))

    def test_tls_or_truncated_body_during_read_retries_without_leaking_query(self):
        for error in (ssl.SSLEOFError(SECRET_URL),
                      http.client.IncompleteRead(b"partial " + SECRET_URL.encode(), 4096)):
            with self.subTest(error=type(error).__name__), patch.object(eu.time, "sleep") as sleep:
                broken = response()
                broken.read = MagicMock(side_effect=error)
                opener = MagicMock()
                opener.open.side_effect = [broken, response()]
                with self.assertLogs("data-refresh", level="WARNING") as logged:
                    self.assertEqual(eu.download_xml(SECRET_URL, opener), XML)
                broken.read.assert_called_once()
                self.assertEqual(opener.open.call_count, 2)
                sleep.assert_called_once_with(120)
                self.assertNotIn("QUERY_MUST_NOT_APPEAR", " ".join(logged.output))

    def test_permanent_client_errors_are_not_retried(self):
        for code in (400, 401, 403, 404):
            with self.subTest(code=code), patch.object(eu.time, "sleep") as sleep:
                opener = MagicMock()
                opener.open.side_effect = http_error(code)
                with self.assertRaises(eu.FetchError) as caught:
                    eu.download_xml(SECRET_URL, opener)
                self.assertEqual(opener.open.call_count, 1)
                self.assertNotIn("QUERY_MUST_NOT_APPEAR", str(caught.exception))
                sleep.assert_not_called()

    def test_fetch_reuses_cookie_session_but_starts_fresh_for_next_fetch(self):
        real_build = urllib.request.build_opener
        def no_proxy(*handlers):
            return real_build(urllib.request.ProxyHandler({}), *handlers)
        fetcher = eu.EuConsolidatedFetcher()
        with local_server(cookie_gate=True) as (server, url), \
             patch.object(eu.urllib.request, "build_opener", side_effect=no_proxy) as build, \
             patch.object(eu, "MIN_ENTITIES", 2), \
             patch.object(fetcher, "_previous_count", return_value=None), \
             patch.object(eu.time, "sleep") as sleep:
            fetcher.url = url
            for _ in range(2):
                self.assertEqual(len(fetcher.fetch()), 2)
            self.assertEqual(build.call_count, 2)
            self.assertEqual(server.requests, 4)
            self.assertEqual(server.without_cookies, 2)
        sleep.assert_not_called()


class EuXmlTests(unittest.TestCase):
    def test_namespaced_export_preserves_eight_columns_and_eu_reference_identity(self):
        parsed = eu._parse_xml(XML)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(set(parsed[0]), set(rows()[0]))
        self.assertEqual(parsed[0]["logical_id"], "EU.TEST.1")
        self.assertNotEqual(parsed[0]["logical_id"], "101")
        self.assertEqual(parsed[0]["name"], "Ada Unit Test")
        self.assertEqual(parsed[0]["aliases"], "Alias Unit")
        self.assertEqual(parsed[0]["countries"], "Elsewhere ; Testland")
        self.assertEqual(parsed[0]["listed_on"], "2026-10-30")
        self.assertEqual(parsed[0]["regulation"], "TEST/2026")
        self.assertEqual(parsed[0]["remarks"], "Test remark")
        self.assertEqual([r["kind"] for r in parsed], ["Person", "Entity"])

    def test_html_wrong_root_or_truncated_xml_never_becomes_a_list(self):
        for raw in (b"<html><body>Gateway page</body></html>",
                    b"<unrelated><sanctionEntity/></unrelated>", XML[:-10]):
            with self.subTest(raw=raw[:20]), self.assertRaises(eu.FetchError):
                eu._parse_xml(raw)

    def test_entity_floor_and_exact_80_percent_boundary(self):
        self.assertEqual(eu.MIN_ENTITIES, 3000)
        self.assertEqual(eu.MIN_RETAINED_RATIO, 0.8)
        with patch.object(eu, "MIN_ENTITIES", 2):
            for candidate in ([], rows(1), rows(7)):
                with self.subTest(count=len(candidate)), self.assertRaises(eu.FetchError):
                    eu._validate_rows(candidate, 10)
            eu._validate_rows(rows(8), 10)
            eu._validate_rows(rows(12), 10)
            eu._validate_rows(rows(2), None)

    def test_missing_duplicate_identity_and_whitespace_names_reject_entire_list(self):
        bad_rows = []
        for identity in (None, "", "   "):
            candidate = rows()
            candidate[0]["logical_id"] = identity
            bad_rows.append(candidate)
        candidate = rows()
        candidate[1]["logical_id"] = candidate[0]["logical_id"]
        bad_rows.append(candidate)
        for name in (None, "", " \t "):
            candidate = rows()
            candidate[0]["name"] = name
            bad_rows.append(candidate)
        with patch.object(eu, "MIN_ENTITIES", 2):
            for candidate in bad_rows:
                with self.subTest(candidate=candidate[0]), self.assertRaises(eu.FetchError):
                    eu._validate_rows(candidate)


class EuPreviousOutputTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / "downloads"
        self.output.mkdir()
        self.snapshots = self.output / "_snapshots"
        self.snapshots.mkdir()
        self.fetcher = eu.EuConsolidatedFetcher()
        self.path = self.output / self.fetcher.out_filename
        for module, key, value in ((eu, "OUTPUT_DIR", self.output),
                                   (common, "REPO_ROOT", self.root),
                                   (common, "OUTPUT_DIR", self.output),
                                   (common, "SNAPSHOT_DIR", self.snapshots)):
            mocked = patch.object(module, key, value)
            mocked.start()
            self.addCleanup(mocked.stop)

    def stored_workbook(self, declared, actual):
        # Disposable regression fixture, never a production output.
        book = Workbook()
        book.active.title = "About"
        book["About"]["B5"] = declared
        data = book.create_sheet("Data")
        data.append(["Kind", "Logical ID", "Name"])
        for i in range(actual):
            data.append(["Person", f"EU.TEST.{i}", f"Unit {i}"])
        book.save(self.path)
        book.close()

    def test_manifest_count_precedes_workbook_and_previous_records_is_valid_fallback(self):
        self.stored_workbook(8, 8)
        for entry, expected in (({"records": 10, "previousRecords": 9}, 10),
                                ({"records": None, "previousRecords": 9}, 9),
                                ({"records": True, "previousRecords": 9}, 9)):
            with self.subTest(entry=entry), patch.object(eu, "load_manifest", return_value={"sources": {"eu-consolidated": entry}}):
                self.assertEqual(self.fetcher._previous_count(), expected)

    def test_invalid_manifest_counts_fall_back_to_verified_published_workbook(self):
        self.stored_workbook(8, 8)
        for count in (None, True, False, 0, -1, "6234", 6234.0):
            entry = {"status": "error", "records": count, "previousRecords": count}
            with self.subTest(count=count), patch.object(eu, "load_manifest", return_value={"sources": {"eu-consolidated": entry}}):
                self.assertEqual(self.fetcher._previous_count(), 8)

    def test_workbook_about_count_must_match_data_rows(self):
        self.stored_workbook(10, 8)
        with patch.object(eu, "load_manifest", return_value={"sources": {}}):
            self.assertIsNone(self.fetcher._previous_count())

    def test_corrupt_or_missing_prior_workbook_has_no_invented_count(self):
        for content in (None, b"broken old file"):
            self.path.unlink(missing_ok=True)
            if content is not None:
                self.path.write_bytes(content)
            with self.subTest(content=content), patch.object(eu, "load_manifest", return_value={"sources": {}}):
                self.assertIsNone(self.fetcher._previous_count())

    def test_download_parse_or_validation_failure_preserves_prior_output_and_hash(self):
        previous = {"contentHash": "prior-confirmed-content", "contentChangedAt": "2026-10-29T00:00:00Z"}
        snapshot = self.snapshots / "eu-consolidated.json"
        for raw in (None, b"<html/>", XML, XML.replace(b"Unit Organisation", b"   ")):
            with self.subTest(raw=raw[:20] if raw else None):
                self.path.write_bytes(b"published XLSX sentinel")
                snapshot.write_bytes(b"published snapshot sentinel")
                with patch.object(eu, "download_xml", side_effect=eu.FetchError("bounded redirect failure") if raw is None else None,
                                  return_value=raw), \
                     patch.object(self.fetcher, "_previous_count", return_value=10), \
                     patch.object(eu, "MIN_ENTITIES", 2), \
                     patch.object(eu.urllib.request, "build_opener", return_value=MagicMock()), \
                     patch.object(common, "write_excel") as write:
                    entry = common.run_fetcher(self.fetcher, MagicMock(), previous)
                self.assertEqual(entry["status"], "error")
                self.assertEqual(entry["contentHash"], previous["contentHash"])
                self.assertEqual(entry["contentChangedAt"], previous["contentChangedAt"])
                self.assertFalse(entry["changed"])
                self.assertEqual(self.path.read_bytes(), b"published XLSX sentinel")
                self.assertEqual(snapshot.read_bytes(), b"published snapshot sentinel")
                write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
