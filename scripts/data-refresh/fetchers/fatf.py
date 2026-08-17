"""FATF High-Risk and Other Monitored Jurisdictions.

The official FATF site sits behind Cloudflare's "Just a moment..." challenge,
which blocks plain HTTP fetches. With a real Chromium instance the challenge
typically resolves in under a second, so we go straight to the source via
Playwright.

If Playwright fails too (Cloudflare upgrades, timeout, etc.), we fall back
to the Wayback Machine — with a 45-day staleness guard that hard-fails the
run when the most recent capture is older than the natural FATF publication
cycle.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

from ..common import Fetcher, FetchError, http_get


FATF_INDEX = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions.html"
CDX_API = "https://web.archive.org/cdx/search/cdx"
WB_PREFIX = "https://web.archive.org/web/"

# Wayback fallback only kicks in if Playwright fails. The 45-day window is
# generous: FATF publishes 3× per year (~4 months apart) so this still
# surfaces "the upstream went silent for too long" cases.
WAYBACK_STALE_AFTER_DAYS = 45

# Country names FATF has used in its statements over the past few years.
# Stable curated set keeps the parser robust across page-layout drift.
KNOWN_COUNTRIES = {
    "Algeria", "Angola", "Bolivia", "Bulgaria", "Burkina Faso",
    "Cameroon", "Côte d'Ivoire", "Cote d'Ivoire", "Croatia",
    "Democratic People's Republic of Korea", "DPRK", "North Korea",
    "Democratic Republic of the Congo",
    "Haiti", "Iran", "Kenya", "Lao People's Democratic Republic", "Laos",
    "Lebanon", "Mali", "Monaco", "Mozambique", "Myanmar", "Burma",
    "Namibia", "Nepal", "Nigeria", "Philippines", "Russia",
    "South Africa", "South Sudan", "Syria", "Tanzania", "Türkiye", "Turkey",
    "Trinidad and Tobago", "Venezuela", "Vietnam", "Yemen", "Bahrain",
}


def _extract_publication_links(html: str, base: str) -> tuple[str | None, str | None]:
    """Pull the most recent CFA + IM links out of the FATF index page."""
    soup = BeautifulSoup(html, "html.parser")

    cfa_links: list[tuple[int, int, str]] = []
    im_links: list[tuple[int, int, str]] = []
    months = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
    ]
    for a in soup.find_all("a", href=True):
        href = a["href"]
        title = a.get_text(" ", strip=True).lower()
        # Score on year + month found in the title or URL
        haystack = (title + " " + href).lower()
        m_year = re.search(r"(20\d{2})", haystack)
        year = int(m_year.group(1)) if m_year else 0
        month = next((i for i, n in enumerate(months, start=1) if n in haystack), 0)
        if "Call-for-action" in href or "call for action" in title:
            cfa_links.append((year, month, urljoin(base, href)))
        elif "increased-monitoring" in href.lower() or "increased monitoring" in title:
            im_links.append((year, month, urljoin(base, href)))

    def best(items: list[tuple[int, int, str]]) -> str | None:
        if not items:
            return None
        items.sort(reverse=True)
        return items[0][2]

    return best(cfa_links), best(im_links)


def _extract_countries(html: str) -> list[str]:
    """Extract countries from a FATF publication page.

    FATF pages mention three classes of country in plain text:
      a) the active list (what we want)
      b) countries removed in this round (false positives if treated as active)
      c) examples / context paragraphs
    We split the page into sentences and drop any sentence that talks about
    removal / delisting before scanning for known countries.
    """
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    REMOVAL_RE = re.compile(
        r"no longer subject|no longer (?:on|in)|removed from|removal of|"
        r"delisted|now meet|completed (?:its|the) action plan|"
        r"made (?:significant|substantial) progress|exit the",
        re.IGNORECASE,
    )

    out: list[str] = []
    seen: set[str] = set()
    # Split on periods + likely sentence boundaries; FATF text is fairly clean
    for sent in re.split(r"(?<=[.!?])\s+", text):
        if REMOVAL_RE.search(sent):
            continue
        for c in sorted(KNOWN_COUNTRIES, key=len, reverse=True):
            if re.search(r"\b" + re.escape(c) + r"\b", sent) and c not in seen:
                seen.add(c)
                out.append(c)
    return out


# The country extractor scans prose, so a jurisdiction merely mentioned (typically
# one being removed) can be collected into the wrong list. Fixing it properly needs
# the real page markup, which is unreachable outside CI — the live site is behind
# Cloudflare and the Wayback replay server is intermittently down. Dump what CI
# actually fetched so the parser can be rewritten against real structure.
DEBUG_DIR = "/tmp/data-refresh-debug"


def _dump_html(status: str, url: str, html: str) -> None:
    try:
        from pathlib import Path
        Path(DEBUG_DIR).mkdir(parents=True, exist_ok=True)
        slug = "blacklist-cfa" if "Call for Action" in status else "greylist-im"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        out = Path(DEBUG_DIR) / f"fatf-{slug}-{stamp}.html"
        out.write_text(f"<!-- source: {url} -->\n{html}", encoding="utf-8")
    except Exception:
        # Diagnostics must never break the fetch.
        pass


def _extract_pub_date(url: str, html_head: str) -> str:
    """Pull a "<Month> <Year>" label from a publication URL or head matter."""
    m = re.search(
        r"(january|february|march|april|may|june|july|august|september|october|november|december)[-\s]+(20\d{2})",
        (url + " " + html_head[:1000]).lower(),
    )
    return " ".join(m.groups()).title() if m else ""


# -----------------------------------------------------------------------------
# Strategy 1 — direct Playwright (passes Cloudflare automatically)
# -----------------------------------------------------------------------------

def _playwright_fetch(url: str, *, debug_slug: str = "fatf",
                      logger: logging.Logger | None = None,
                      timeout_ms: int = 45_000) -> str:
    log = logger or logging.getLogger("data-refresh")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        try:
            ctx = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.119 Safari/537.36"
                ),
                viewport={"width": 1440, "height": 900},
                locale="en-US",
            )
            page = ctx.new_page()
            page.set_default_timeout(timeout_ms)
            page.goto(url, wait_until="domcontentloaded")

            # Wait for Cloudflare's "Just a moment..." to clear (max ~15s).
            for _ in range(30):
                title = page.title()
                if title and "moment" not in title.lower() and "checking" not in title.lower():
                    break
                page.wait_for_timeout(500)

            # Wait for at least one publication link (attached, not visible —
            # FATF hides items below the fold via CSS).
            try:
                page.wait_for_selector(
                    "a[href*='Call-for-action'], a[href*='increased-monitoring']",
                    state="attached",
                    timeout=20_000,
                )
            except PlaywrightTimeout:
                # Save context for triage and bubble up
                from pathlib import Path
                Path("/tmp/data-refresh-debug").mkdir(parents=True, exist_ok=True)
                ts = datetime.now().strftime("%Y%m%d-%H%M%S")
                try:
                    page.screenshot(path=f"/tmp/data-refresh-debug/{debug_slug}-{ts}.png", full_page=True)
                except Exception:
                    pass
                raise FetchError("Playwright loaded FATF but no publication links appeared")

            return page.content()
        finally:
            browser.close()


# -----------------------------------------------------------------------------
# Strategy 2 — Wayback Machine (fallback only)
# -----------------------------------------------------------------------------

def _wayback_latest(url: str) -> tuple[str, str]:
    """Return (waybackUrl, snapshotISODate) of the most recent capture."""
    cdx_url = (
        f"{CDX_API}?url={quote(url, safe='')}&output=json&limit=-1"
        f"&filter=statuscode:200&fl=timestamp,original"
    )
    try:
        raw = http_get(cdx_url, timeout=30).decode("utf-8")
        rows = json.loads(raw)
    except (FetchError, json.JSONDecodeError) as e:
        raise FetchError(f"Wayback CDX lookup failed: {e}")
    if len(rows) < 2:
        raise FetchError(f"No Wayback snapshot exists for {url}")
    timestamp, original = rows[1]
    iso = (
        f"{timestamp[0:4]}-{timestamp[4:6]}-{timestamp[6:8]}"
        f"T{timestamp[8:10]}:{timestamp[10:12]}:{timestamp[12:14]}+00:00"
    )
    return f"{WB_PREFIX}{timestamp}/{original}", iso


def _days_ago(iso: str) -> int:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).days


# -----------------------------------------------------------------------------
# Public Fetcher
# -----------------------------------------------------------------------------

class FatfFetcher(Fetcher):
    id = "fatf-jurisdictions"
    name = "FATF High-Risk & Other Monitored Jurisdictions"
    url = FATF_INDEX
    out_filename = "fatf-jurisdictions.xlsx"
    requires_headless = True  # primary path uses Playwright

    # Set during fetch() so they appear on the About sheet
    _strategy: str = ""
    _index_snapshot_date: str = ""
    _index_snapshot_url: str = ""

    def columns(self):
        return [
            ("status", "FATF Status", 30),
            ("country", "Country / Jurisdiction", 40),
            ("publication_date", "Statement Date", 20),
            ("source_url", "Source URL", 60),
        ]

    def extra_about_rows(self):
        rows = [("Fetch strategy", self._strategy or "n/a")]
        if self._strategy == "wayback":
            rows.extend([
                ("Wayback snapshot taken", self._index_snapshot_date or "n/a"),
                ("Wayback snapshot URL", self._index_snapshot_url or "n/a"),
                ("Staleness rule",
                 f"Run fails if Wayback snapshot is older than {WAYBACK_STALE_AFTER_DAYS} days"),
            ])
        return rows

    def _fetch_publication_html(self, url: str) -> str:
        """Fetch a publication page using whichever strategy succeeded for the index."""
        if self._strategy == "playwright":
            return _playwright_fetch(url, debug_slug="fatf-pub")
        # Wayback path: the URL is already a Wayback URL, just GET it
        return http_get(url, timeout=45).decode("utf-8", errors="replace")

    def fetch(self) -> list[dict[str, Any]]:
        index_html: str | None = None
        index_base = FATF_INDEX

        # Strategy 1 — direct Playwright
        try:
            index_html = _playwright_fetch(FATF_INDEX, debug_slug="fatf")
            self._strategy = "playwright"
        except (FetchError, PlaywrightTimeout, Exception) as e:
            logging.getLogger("data-refresh").info(
                f"  FATF: Playwright path failed ({type(e).__name__}: {e}); falling back to Wayback"
            )

        # Strategy 2 — Wayback
        if index_html is None:
            snap_url, snap_iso = _wayback_latest(FATF_INDEX)
            self._index_snapshot_url = snap_url
            self._index_snapshot_date = snap_iso
            age = _days_ago(snap_iso)
            if age > WAYBACK_STALE_AFTER_DAYS:
                raise FetchError(
                    f"Playwright failed and the Wayback snapshot is {age} days old "
                    f"(threshold {WAYBACK_STALE_AFTER_DAYS}). Manual review required."
                )
            try:
                index_html = http_get(snap_url, timeout=45).decode("utf-8", errors="replace")
                self._strategy = "wayback"
                index_base = snap_url
            except FetchError as e:
                raise FetchError(f"Both Playwright and Wayback failed: {e}")

        cfa_url, im_url = _extract_publication_links(index_html, index_base)

        rows: list[dict[str, Any]] = []
        for status, raw_url in [
            ("Blacklist (Call for Action)", cfa_url),
            ("Greylist (Increased Monitoring)", im_url),
        ]:
            if not raw_url:
                continue
            try:
                html = self._fetch_publication_html(raw_url)
            except FetchError:
                continue
            _dump_html(status, raw_url, html)
            countries = _extract_countries(html)
            pub_date = _extract_pub_date(raw_url, html)
            for c in countries:
                rows.append({
                    "status": status,
                    "country": c,
                    "publication_date": pub_date,
                    "source_url": raw_url,
                })

        if not rows:
            raise FetchError("FATF index loaded but no countries could be extracted from the linked publications")
        return rows
