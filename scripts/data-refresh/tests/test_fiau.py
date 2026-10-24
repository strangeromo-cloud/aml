"""FIAU parsing regressions; network is mocked and PDFs are generated in memory."""
from __future__ import annotations

from datetime import date
import importlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
fiau = importlib.import_module("scripts.data-refresh.fetchers.fiau")
verifier = importlib.import_module("scripts.data-refresh.verify_fatf")

DAY = date(2026, 6, 19)
BLACK_URL = "https://fiaumalta.org/app/uploads/2026/06/black.pdf"
GREY_URL = "https://fiaumalta.org/app/uploads/2026/06/grey.pdf"
BLACK = ["Democratic People's Republic of Korea (DPRK)", "Iran", "Myanmar"]
GREY = ["ANGOLA", "BOLIVIA", "BULGARIA", "CAMEROON", "HAITI", "KENYA", "LAO PDR", "PAPAU NEW GUINEA"]
BLACK_TITLE = "High-Risk Jurisdictions subject to a Call for Action"
GREY_TITLE = "Jurisdictions under Increased Monitoring"


def index(black="19th June 2026", grey="19th June 2026", black_extra="", grey_extra=""):
    # The heading's parent does not contain its PDF anchors on the real site.
    return (f'<div><h2>High Risk Jurisdictions Subject to a Call for Action (FATF Statements)</h2></div>'
            f'<div><a href="{BLACK_URL}">{black}</a>{black_extra}</div>'
            '<h2>Jurisdictions Under Increased Monitoring (FATF On-Going Process)</h2>'
            f'<div><a href="{GREY_URL}">{grey}</a>{grey_extra}</div>'
            '<h2>EU Commission Delegated Acts on High Risk Third Countries</h2>'
            '<a href="https://fiaumalta.org/eu.pdf">4th December 2026</a>')


def pdf(kind, countries=None, *, day="19th June 2026", footer=True, style=None,
        removed=True, style_overrides=None):
    """Small actual PDF with three standard fonts; no extra test dependencies."""
    title = (BLACK_TITLE if kind == "black" else GREY_TITLE) + " - " + day
    countries = (BLACK if kind == "black" else GREY) if countries is None else countries
    lines = [(title, "F2", 14 if kind == "black" else 16)]
    lines.append(("Countries mentioned only in prose: Algeria, Namibia and South Africa.", "F1", 12))
    font, size = style or (("F3", 16) if kind == "black" else ("F2", 13.56))
    for country in countries:
        country_font, country_size = (style_overrides or {}).get(country, (font, size))
        lines.append((country, country_font, country_size))
        lines.append(("The country continues to implement its FATF action plan.", "F1", 12))
    if kind == "grey" and removed:
        lines.extend([
            ("JURISDICTIONS NO LONGER SUBJECT TO INCREASED MONITORING BY THE FATF", "F2", 13.56),
            ("ALGERIA", "F2", 13.56), ("NAMIBIA", "F2", 13.56)])
    if footer:
        lines.append(("Source: " + title, "F1", 12))
    commands = []
    y = 800
    for text, font, size in lines:
        literal = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(f"BT /{font} {size} Tf 30 {y} Td ({literal}) Tj ET")
        y -= 22
    stream = "\n".join(commands).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 1000] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010} 00000 n \n".encode())
    data.extend(f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(data)


class FiauTests(unittest.TestCase):
    def test_discovery_keeps_sections_separate_and_selects_each_latest(self):
        older = '<a href="https://fiaumalta.org/older.pdf">13th February 2026</a>'
        black, grey = fiau.discover_latest_pair(index(black_extra=older, grey_extra=older))
        self.assertEqual((black.day, grey.day), (DAY, DAY))
        self.assertEqual((black.url, grey.url), (BLACK_URL, GREY_URL))

    def test_one_side_update_never_rolls_back_to_matching_older_pair(self):
        older = f'<a href="{BLACK_URL}">19th June 2026</a>'
        with self.assertRaisesRegex(fiau.FetchError, "latest editions differ"):
            fiau.discover_latest_pair(index(black="23rd October 2026", black_extra=older))

    def test_missing_side_invalid_date_and_ambiguous_links_are_rejected(self):
        for html in [index().split('<h2>Jurisdictions Under')[0],
                     index(black="not a date"),
                     index(black_extra='<a href="https://fiaumalta.org/other.pdf">19th June 2026</a>')]:
            with self.subTest(html=html):
                with self.assertRaises(fiau.FetchError):
                    fiau.discover_latest_pair(html)

    def test_external_pdf_is_not_a_trusted_fiau_source(self):
        with self.assertRaisesRegex(fiau.FetchError, "outside the official site"):
            fiau.discover_latest_pair(index().replace(BLACK_URL, "https://example.com/black.pdf"))

    def test_fetch_returns_pdf_provenance_and_only_active_country_headings(self):
        pages = {fiau.FIAU_INDEX: index().encode(), BLACK_URL: pdf("black"), GREY_URL: pdf("grey")}
        with patch.object(fiau, "http_get", side_effect=lambda url, **kw: pages[url]):
            rows = fiau.fetch_fiau()
        self.assertEqual(len(rows), 11)
        self.assertEqual({r["source_provider"] for r in rows}, {"FIAU 转载 FATF"})
        self.assertEqual({r["publication_date"] for r in rows}, {"2026-06-19"})
        names = {verifier.norm(r["country"]) for r in rows}
        self.assertNotIn("algeria", names)
        self.assertNotIn("namibia", names)
        self.assertNotIn("south africa", names)
        self.assertIn("papua new guinea", names)
        self.assertIn("north korea", names)
        for row in rows:
            self.assertEqual(row["source_url"], BLACK_URL if "Blacklist" in row["status"] else GREY_URL)

    def test_html_invalid_pdf_or_wrong_date_cannot_be_adopted(self):
        statement = fiau.Statement("black", DAY, BLACK_URL)
        for data in [b"<html>Just a moment...</html>", b"%PDF-not-a-document", pdf("black", day="13th February 2026")]:
            with self.subTest(data=data[:30]):
                with self.assertRaises(fiau.FetchError):
                    fiau.parse_statement(data, statement)

    def test_wrong_statement_type_cannot_be_adopted(self):
        with self.assertRaisesRegex(fiau.FetchError, "title/date"):
            fiau.parse_statement(pdf("grey"), fiau.Statement("black", DAY, BLACK_URL))

    def test_missing_final_citation_rejects_a_partial_document(self):
        with self.assertRaisesRegex(fiau.FetchError, "final source citation"):
            fiau.parse_statement(pdf("grey", footer=False), fiau.Statement("grey", DAY, GREY_URL))

    def test_unknown_heading_or_changed_country_style_fails_closed(self):
        statement = fiau.Statement("grey", DAY, GREY_URL)
        for data in [pdf("grey", countries=GREY + ["UNEXPECTED SECTION"]),
                     pdf("grey", countries=GREY + ["JURISDICTIONS AWAITING REVIEW"]),
                     pdf("grey", style=("F2", 16))]:
            with self.subTest(data=data[:30]):
                with self.assertRaises(fiau.FetchError):
                    fiau.parse_statement(data, statement)

    def test_download_failure_does_not_return_a_half_list(self):
        pages = {fiau.FIAU_INDEX: index().encode(), BLACK_URL: pdf("black")}
        def get(url, **kw):
            if url == GREY_URL:
                raise fiau.FetchError("grey PDF unavailable")
            return pages[url]
        with patch.object(fiau, "http_get", side_effect=get):
            with self.assertRaisesRegex(fiau.FetchError, "grey PDF unavailable"):
                fiau.fetch_fiau()

    def test_single_country_losing_heading_style_cannot_silently_disappear(self):
        # Nine countries means dropping one would still meet the broad grey-list
        # lower bound of eight. The independent text-line check must catch it.
        for style in [("F1", 12), ("F2", 12), ("F1", 13.56)]:
            with self.subTest(style=style):
                document = pdf("grey", countries=GREY + ["MONACO"],
                               style_overrides={"KENYA": style})
                with self.assertRaisesRegex(fiau.FetchError, "headings/text disagree"):
                    fiau.parse_statement(document, fiau.Statement("grey", DAY, GREY_URL))

    def test_partial_country_list_is_rejected_by_shared_validation(self):
        pages = {fiau.FIAU_INDEX: index().encode(), BLACK_URL: pdf("black"), GREY_URL: pdf("grey", countries=GREY[:2])}
        with patch.object(fiau, "http_get", side_effect=lambda url, **kw: pages[url]):
            with self.assertRaisesRegex(fiau.FetchError, "incomplete or inconsistent"):
                fiau.fetch_fiau()

    def test_duplicate_country_heading_is_rejected(self):
        with self.assertRaisesRegex(fiau.FetchError, "duplicate active country"):
            fiau.parse_statement(pdf("grey", countries=GREY + ["ANGOLA"]),
                                 fiau.Statement("grey", DAY, GREY_URL))

    def test_country_in_both_lists_is_rejected(self):
        pages = {fiau.FIAU_INDEX: index().encode(), BLACK_URL: pdf("black"),
                 GREY_URL: pdf("grey", countries=GREY[1:] + ["IRAN"])}
        with patch.object(fiau, "http_get", side_effect=lambda url, **kw: pages[url]):
            with self.assertRaisesRegex(fiau.FetchError, "incomplete or inconsistent"):
                fiau.fetch_fiau()


if __name__ == "__main__":
    unittest.main()
