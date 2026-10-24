"""Complete FATF statement copies published by Malta's official FIAU.

Only date-labelled PDF links in the two FATF sections are eligible. Each section
must have the same newest edition; an incomplete update never rolls back to an
older pair. Country names come from PDF headings, not prose mentioning countries.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag
from pypdf import PdfReader

from ..common import FetchError, http_get

FIAU_INDEX = "https://fiaumalta.org/country-statements/"
SOURCE_PROVIDER = "FIAU 转载 FATF"
_MONTHS = {name.lower(): i for i, name in enumerate(
    ("January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"), 1)}
_DATE = re.compile(r"\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+(" + "|".join(_MONTHS) + r")\s+(20\d{2})\b", re.I)
_TITLES = {"black": "high-risk jurisdictions subject to a call for action",
           "grey": "jurisdictions under increased monitoring"}
_REMOVED = re.compile(r"jurisdictions?\s+no longer subject", re.I)
_ISO_FILE = Path(__file__).resolve().parents[1] / "seeds" / "iso3166.json"


@dataclass(frozen=True)
class Statement:
    kind: str
    day: date
    url: str


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


def _country_name(text: str) -> str:
    # The DPRK heading appends an acronym. The current grey PDF misspells PAPUA
    # as PAPAU in its heading, while its following paragraph spells it correctly.
    country = re.sub(r"\s*\(DPRK\)$", "", _clean(text), flags=re.I)
    return "Papua New Guinea" if country.upper() == "PAPAU NEW GUINEA" else country


def _date(text: str) -> date:
    match = _DATE.search(_clean(text))
    if not match:
        raise FetchError(f"FIAU statement date missing: {_clean(text)[:100]}")
    day, month, year = match.groups()
    try:
        return date(int(year), _MONTHS[month.lower()], int(day))
    except ValueError as exc:
        raise FetchError(f"FIAU statement date invalid: {match.group(0)}") from exc


def discover_latest_pair(html: str) -> tuple[Statement, Statement]:
    soup = BeautifulSoup(html, "html.parser")
    sections: dict[str, list[Statement]] = {"black": [], "grey": []}
    seen_sections: set[str] = set()
    for heading in soup.find_all("h2"):
        title = _clean(heading.get_text(" ", strip=True)).lower()
        if "high risk jurisdictions subject to a call for action" in title:
            kind = "black"
        elif "jurisdictions under increased monitoring" in title:
            kind = "grey"
        else:
            continue
        if kind in seen_sections:
            raise FetchError(f"FIAU page has duplicate {kind} sections")
        seen_sections.add(kind)
        for node in heading.next_elements:
            if isinstance(node, Tag) and node.name == "h2":
                break
            if not isinstance(node, Tag) or node.name != "a" or not node.get("href"):
                continue
            url = urljoin(FIAU_INDEX, node["href"])
            parts = urlparse(url)
            if not parts.path.lower().endswith(".pdf"):
                continue
            if parts.scheme != "https" or parts.hostname not in {"fiaumalta.org", "www.fiaumalta.org"}:
                raise FetchError(f"FIAU statement PDF is outside the official site: {url}")
            sections[kind].append(Statement(kind, _date(node.get_text(" ", strip=True)), url))
    latest = []
    for kind, statements in sections.items():
        if not statements:
            raise FetchError(f"FIAU page has no date-labelled {kind} statement PDFs")
        day = max(item.day for item in statements)
        urls = {item.url for item in statements if item.day == day}
        if len(urls) != 1:
            raise FetchError(f"FIAU has ambiguous {kind} PDFs for {day}")
        latest.append(Statement(kind, day, urls.pop()))
    black, grey = latest
    if black.day != grey.day:
        raise FetchError(f"FIAU latest editions differ: black {black.day}, grey {grey.day}; refusing an older pair")
    return black, grey


def _headings(page) -> list[tuple[str, float, bool]]:
    """Join font runs on one heading line (e.g. 'B' + 'OLIVIA').

    The inspected FIAU copies use 13.56pt bold grey country headings and 15.96pt
    bold-italic black country headings. Body text is 12pt. We retain large bold
    headings so an unexpected layout can fail explicitly instead of scanning prose.
    """
    result: list[tuple[str, float, bool]] = []
    current: list[str] = []
    current_y: float | None = None
    current_size = 0.0
    current_italic = False

    def flush() -> None:
        nonlocal current
        if current:
            result.append((_clean("".join(current)), current_size, current_italic))
            current = []

    def visit(text, cm, tm, font, size):
        nonlocal current_y, current_size, current_italic
        if not text.strip():
            return
        name = str(font.get("/BaseFont", "")) if font else ""
        italic = "Italic" in name or "Oblique" in name
        y = round(float(tm[5]), 1)
        if "Bold" not in name or float(size) < 12.5:
            flush()
            return
        if current and (y != current_y or italic != current_italic):
            flush()
        if not current:
            current_y, current_size, current_italic = y, float(size), italic
        current.append(text)

    page.extract_text(visitor_text=visit)
    flush()
    return result


def parse_statement(raw: bytes, statement: Statement) -> list[dict[str, Any]]:
    if not raw.startswith(b"%PDF-"):
        raise FetchError(f"FIAU {statement.kind} download is not a PDF: {statement.url}")
    try:
        reader = PdfReader(BytesIO(raw), strict=True)
        if reader.is_encrypted or not reader.pages:
            raise ValueError("encrypted or empty document")
        page_texts = [page.extract_text() or "" for page in reader.pages]
        # Verify the document's own title/date, not dates mentioned in its prose.
        first = page_texts[0]
        title = _clean(first.splitlines()[0]) if first.splitlines() else ""
        title_key = title.lower().replace("–", "-").replace("—", "-")
        if not title_key.startswith(_TITLES[statement.kind]) or _date(title) != statement.day:
            raise FetchError(f"FIAU {statement.kind} PDF title/date does not match {statement.day}: {title}")
        # Both inspected complete copies end with an explicit source citation.
        # A valid PDF containing only its first pages must not look complete.
        tail = _clean(page_texts[-1])
        citation = re.search(r"\bSource\s*:\s*(.+)$", tail, re.I)
        if not citation or _date(citation.group(1)) != statement.day:
            raise FetchError(f"FIAU {statement.kind} PDF is missing its dated final source citation")
        headings = [heading for page in reader.pages for heading in _headings(page)]
    except FetchError:
        raise
    except Exception as exc:
        raise FetchError(f"Cannot parse FIAU {statement.kind} PDF: {type(exc).__name__}: {exc}") from exc

    from ..verify_fatf import norm
    iso_names = json.loads(_ISO_FILE.read_text())
    countries: list[str] = []
    for text, size, italic in headings:
        if _REMOVED.search(text):
            break
        # Titles and category headings are deliberately not treated as countries.
        if text.lower().startswith(_TITLES[statement.kind]):
            continue
        expected_style = ((statement.kind == "black" and italic and 15 <= size <= 19)
                          or (statement.kind == "grey" and not italic and 12.5 <= size <= 14.5 and text.isupper()))
        country = _country_name(text)
        known = norm(country) in iso_names
        if not expected_style:
            if known or (statement.kind == "grey" and text.isupper()):
                raise FetchError(f"FIAU country heading layout changed: {text}")
            continue
        if not known:
            raise FetchError(f"FIAU unrecognized country heading: {text}")
        if norm(country) in {norm(name) for name in countries}:
            raise FetchError(f"FIAU duplicate active country heading: {text}")
        countries.append(country)
    if not countries:
        raise FetchError(f"FIAU {statement.kind} PDF has no recognized active country headings")
    # Independently check complete country-name lines without relying on fonts.
    # A single country losing its bold/size styling could otherwise disappear
    # while the remaining list still passes the shared broad count bounds.
    active_text = "\n".join(page_texts)
    removed = _REMOVED.search(active_text)
    if removed:
        active_text = active_text[:removed.start()]
    standalone = {norm(_country_name(line)) for line in active_text.splitlines()
                  if norm(_country_name(line)) in iso_names}
    parsed = {norm(name) for name in countries}
    if standalone != parsed:
        raise FetchError(f"FIAU {statement.kind} country headings/text disagree: "
                         f"missing headings={sorted(standalone - parsed)}, "
                         f"missing country lines={sorted(parsed - standalone)}")
    status = "Blacklist (Call for Action)" if statement.kind == "black" else "Greylist (Increased Monitoring)"
    return [{"status": status, "country": country,
             "publication_date": statement.day.isoformat(), "source_url": statement.url,
             "source_provider": SOURCE_PROVIDER} for country in countries]


def fetch_fiau() -> list[dict[str, Any]]:
    html = http_get(FIAU_INDEX, timeout=45, retries=2).decode("utf-8", errors="replace")
    pair = discover_latest_pair(html)
    rows = []
    for statement in pair:
        rows.extend(parse_statement(http_get(statement.url, timeout=60, retries=2), statement))
    from ..verify_fatf import validate_rows
    rejected = validate_rows(rows)
    if rejected:
        raise FetchError(f"FIAU FATF statements are incomplete or inconsistent: {rejected}")
    return rows
