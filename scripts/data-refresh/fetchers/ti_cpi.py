"""Transparency International CPI — annual Excel download.

The published CPI spreadsheet uses ISO 29500 (Strict) OOXML, which openpyxl
silently fails on. We parse the underlying XML directly so we work with both
Strict and Transitional namespaces.
"""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from io import BytesIO
from typing import Any

from ..common import Fetcher, FetchError, http_get


# OOXML supports two namespaces in the wild
NS_TRANSITIONAL = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_STRICT = "http://purl.oclc.org/ooxml/spreadsheetml/main"


def _strip_ns(elem: ET.Element) -> None:
    """Recursively strip xmlns prefixes so we can use a single XPath."""
    for el in elem.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]


def _read_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    _strip_ns(root)
    out = []
    for si in root.findall("si"):
        out.append("".join(t.text or "" for t in si.iter() if t.tag == "t"))
    return out


def _read_rows(zf: zipfile.ZipFile, sheet_xml_name: str, strings: list[str]) -> list[list[Any]]:
    root = ET.fromstring(zf.read(sheet_xml_name))
    _strip_ns(root)
    rows: list[list[Any]] = []
    for r in root.findall(".//row"):
        vals: list[Any] = []
        for c in r.findall("c"):
            t = c.get("t")
            v = c.find("v")
            inline = c.find("is")
            if t == "s" and v is not None and v.text is not None:
                idx = int(v.text)
                vals.append(strings[idx] if 0 <= idx < len(strings) else None)
            elif t == "inlineStr" and inline is not None:
                vals.append("".join(t2.text or "" for t2 in inline.iter() if t2.tag == "t"))
            elif v is not None:
                txt = v.text or ""
                # numeric?
                try:
                    fl = float(txt)
                    vals.append(int(fl) if fl.is_integer() else fl)
                except ValueError:
                    vals.append(txt)
            else:
                vals.append(None)
        rows.append(vals)
    return rows


class TiCpiFetcher(Fetcher):
    id = "ti-cpi"
    name = "Transparency International CPI"
    url = ""
    out_filename = "ti-cpi.xlsx"

    def columns(self):
        return [
            ("rank", "Rank", 8),
            ("country", "Country", 36),
            ("iso3", "ISO Code", 10),
            ("region", "Region", 24),
            ("score", "CPI Score (0-100, higher = cleaner)", 22),
        ]

    # TI renames the results workbook between editions — 2024 shipped as
    # "CPI2024-Results-and-trends.xlsx" and 2025 as "CPI2025_Results.xlsx". Guessing
    # filenames therefore silently falls back to an older edition, which looks like
    # healthy data while being a year stale. Discover the link from the edition page
    # instead, and only guess as a last resort.
    EDITION_PAGE = "https://www.transparency.org/en/cpi/{year}"
    _edition_year: int = 0

    def _xlsx_url_from_page(self, year: int) -> str | None:
        try:
            html = http_get(self.EDITION_PAGE.format(year=year), timeout=45,
                            retries=2).decode("utf-8", errors="replace")
        except FetchError:
            return None
        # Prefer a results workbook for this edition over methodology/map bundles.
        cands = re.findall(r"https://[^\"'\s)]+\.xlsx", html)
        scored = [c for c in cands if str(year) in c and "ethodolog" not in c.lower()]
        for c in scored:
            if "result" in c.lower():
                return c
        return scored[0] if scored else (cands[0] if cands else None)

    def _try_year(self, year: int) -> bytes | None:
        urls = [u for u in (self._xlsx_url_from_page(year),
                            f"https://images.transparencycdn.org/images/CPI{year}-Results-and-trends.xlsx",
                            f"https://images.transparencycdn.org/images/CPI{year}_Results.xlsx")
                if u]
        for url in urls:
            try:
                data = http_get(url, timeout=60, retries=2)
                self.url = url
                self._edition_year = year
                return data
            except FetchError:
                continue
        return None

    def fetch(self) -> list[dict[str, Any]]:
        data: bytes | None = None
        # CPI for year N publishes early in N+1, so the newest possible edition is
        # last year's until this year's lands.
        newest = date.today().year
        for year in range(newest, newest - 5, -1):
            data = self._try_year(year)
            if data:
                if year < newest - 1:
                    # Two or more editions behind means the download moved again.
                    raise FetchError(
                        f"newest CPI edition found is {year}, expected {newest - 1} or "
                        f"{newest} — TI likely renamed the workbook again; check "
                        f"{self.EDITION_PAGE.format(year=newest - 1)}"
                    )
                break
        if not data:
            raise FetchError("Could not locate any recent TI CPI Excel")

        zf = zipfile.ZipFile(BytesIO(data))
        strings = _read_strings(zf)
        sheet_files = sorted(n for n in zf.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        if not sheet_files:
            raise FetchError("CPI xlsx contains no worksheet XML")

        rows: list[dict[str, Any]] = []
        for sheet_xml in sheet_files:
            sheet_rows = _read_rows(zf, sheet_xml, strings)
            # Find header row by looking for any row containing "Country" or "CPI score"
            data_start = None
            for i, row in enumerate(sheet_rows):
                joined = " ".join(str(v) for v in row if v is not None).lower()
                if "country" in joined and ("cpi score" in joined or "score" in joined or "rank" in joined):
                    data_start = i + 1
                    break
            if data_start is None:
                continue

            for row in sheet_rows[data_start:]:
                if not row or not row[0]:
                    continue
                country = row[0]
                if not isinstance(country, str) or len(country) < 2:
                    continue
                # Normal layout: Country | ISO3 | Region | CPI Score | Rank | ...
                iso = row[1] if len(row) > 1 else ""
                region = row[2] if len(row) > 2 else ""
                score = row[3] if len(row) > 3 else None
                rank = row[4] if len(row) > 4 else None
                if not isinstance(score, (int, float)) or not (0 <= score <= 100):
                    continue
                rows.append({
                    "rank": rank if isinstance(rank, (int, float)) else "",
                    "country": country.strip(),
                    "iso3": iso if isinstance(iso, str) else "",
                    "region": region if isinstance(region, str) else "",
                    "score": float(score),
                })
            if rows:
                break  # used a working sheet

        if not rows:
            raise FetchError("CPI xlsx parsed but no country rows recognized")
        return rows
