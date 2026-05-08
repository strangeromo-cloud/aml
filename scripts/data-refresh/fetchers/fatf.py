"""FATF High-Risk and Other Monitored Jurisdictions.

The official FATF site is behind a Cloudflare interstitial that blocks plain
HTTP fetches, so we fetch through the Wayback Machine. Wayback can lag the
live site by days or weeks, so we explicitly capture the snapshot date via
the CDX API and fail loudly if the most recent snapshot is older than the
staleness threshold (default: 45 days, comfortably more than FATF's
4-month publication cycle).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup

from ..common import Fetcher, FetchError, http_get


FATF_INDEX = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions.html"
CDX_API = "https://web.archive.org/cdx/search/cdx"
WB_PREFIX = "https://web.archive.org/web/"

# How old can the Wayback snapshot be before we treat it as "stale enough to
# alert"? FATF publishes 3× per year (every ~4 months), so 45 days is a
# generous safety margin.
STALE_AFTER_DAYS = 45

# Country names FATF has used in its statements over the past few years.
# Stable curated set — keeps parser robust across page-layout drift.
KNOWN_COUNTRIES = {
    "Algeria", "Angola", "Bolivia", "Bulgaria", "Burkina Faso",
    "Cameroon", "Côte d'Ivoire", "Cote d'Ivoire", "Croatia",
    "Democratic People's Republic of Korea", "DPRK", "North Korea",
    "Democratic Republic of the Congo",
    "Haiti", "Iran", "Kenya", "Lao People's Democratic Republic", "Laos",
    "Lebanon", "Mali", "Monaco", "Mozambique", "Myanmar", "Burma",
    "Namibia", "Nepal", "Nigeria", "Philippines", "Russia",
    "South Africa", "South Sudan", "Syria", "Tanzania", "Türkiye", "Turkey",
    "Trinidad and Tobago", "Venezuela", "Vietnam", "Yemen",
    "Bahrain",
}


def _latest_snapshot(url: str) -> tuple[str, str]:
    """Return (waybackUrl, snapshotISODate) for the most recent capture.

    Uses the CDX API which gives us the actual capture timestamp.
    Raises FetchError if no snapshot is found.
    """
    cdx_url = (
        f"{CDX_API}?url={quote(url, safe='')}&output=json&limit=-1"
        f"&filter=statuscode:200&fl=timestamp,original"
    )
    try:
        raw = http_get(cdx_url, timeout=30).decode("utf-8")
        rows = json.loads(raw)
    except (FetchError, json.JSONDecodeError) as e:
        raise FetchError(f"Wayback CDX lookup failed for {url}: {e}")
    if len(rows) < 2:
        raise FetchError(f"No Wayback snapshot exists for {url}")
    # rows[0] is the column header; rows[1] is most-recent successful capture
    timestamp, original = rows[1]
    iso = (
        f"{timestamp[0:4]}-{timestamp[4:6]}-{timestamp[6:8]}"
        f"T{timestamp[8:10]}:{timestamp[10:12]}:{timestamp[12:14]}+00:00"
    )
    return f"{WB_PREFIX}{timestamp}/{original}", iso


def _days_ago(iso: str) -> int:
    snap = datetime.fromisoformat(iso)
    return (datetime.now(timezone.utc) - snap).days


class FatfFetcher(Fetcher):
    id = "fatf-jurisdictions"
    name = "FATF High-Risk & Other Monitored Jurisdictions"
    url = FATF_INDEX
    out_filename = "fatf-jurisdictions.xlsx"

    # Set during fetch() so they appear on the About sheet
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
        return [
            ("Source channel",
             "Wayback Machine (FATF site is Cloudflare-protected)"),
            ("Wayback snapshot taken", self._index_snapshot_date or "n/a"),
            ("Wayback snapshot URL", self._index_snapshot_url or "n/a"),
            ("Staleness rule",
             f"Run fails if the snapshot is older than {STALE_AFTER_DAYS} days. "
             "FATF publishes 3× per year so this is well above the natural cycle."),
        ]

    def _find_publication_links(self, html: str) -> tuple[str | None, str | None]:
        """Return (call_for_action_url, increased_monitoring_url) — most recent."""
        soup = BeautifulSoup(html, "html.parser")
        cfa_links: list[tuple[str, str]] = []
        im_links: list[tuple[str, str]] = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            title = a.get_text(" ", strip=True).lower()
            if "Call-for-action" in href or "call for action" in title:
                cfa_links.append((title, href))
            elif "increased-monitoring" in href.lower() or "increased monitoring" in title:
                im_links.append((title, href))

        def latest(items):
            if not items:
                return None
            scored = []
            for t, u in items:
                m = re.search(r"(20\d{2})", t + " " + u)
                year = int(m.group(1)) if m else 0
                month = next(
                    (i for i, n in enumerate([
                        "january", "february", "march", "april", "may", "june",
                        "july", "august", "september", "october", "november", "december"
                    ], start=1) if n in (t + " " + u).lower()),
                    0,
                )
                scored.append((year, month, u))
            scored.sort(reverse=True)
            return scored[0][2]

        return latest(cfa_links), latest(im_links)

    def _extract_countries(self, html: str) -> list[str]:
        text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        out: list[str] = []
        for c in KNOWN_COUNTRIES:
            if re.search(r"\b" + re.escape(c) + r"\b", text):
                if c not in out:
                    out.append(c)
        return out

    def fetch(self) -> list[dict[str, Any]]:
        # 1. Use CDX to find the most recent successful Wayback capture of the index
        snap_url, snap_iso = _latest_snapshot(FATF_INDEX)
        self._index_snapshot_url = snap_url
        self._index_snapshot_date = snap_iso
        age = _days_ago(snap_iso)
        if age > STALE_AFTER_DAYS:
            raise FetchError(
                f"Most recent Wayback snapshot of FATF is {age} days old "
                f"(threshold {STALE_AFTER_DAYS}). Live FATF blocked by Cloudflare. "
                f"Manual review needed: open {FATF_INDEX} in a browser and check."
            )

        # 2. Fetch the index page from that snapshot
        index_html = http_get(snap_url, timeout=45).decode("utf-8", errors="replace")
        cfa_url, im_url = self._find_publication_links(index_html)

        rows: list[dict[str, Any]] = []
        labelled = [
            ("Blacklist (Call for Action)", cfa_url),
            ("Greylist (Increased Monitoring)", im_url),
        ]

        def resolve(u: str | None) -> str | None:
            if not u:
                return None
            if u.startswith("http"):
                return u
            return urljoin("https://web.archive.org/", u)

        for status, raw_url in labelled:
            full = resolve(raw_url)
            if not full:
                continue
            try:
                html = http_get(full, timeout=45).decode("utf-8", errors="replace")
            except FetchError:
                continue
            countries = self._extract_countries(html)
            m = re.search(
                r"(january|february|march|april|may|june|july|august|september|october|november|december)[-\s]+(20\d{2})",
                (full + " " + html[:1000]).lower(),
            )
            pub_date = " ".join(m.groups()).title() if m else ""
            for c in countries:
                rows.append({
                    "status": status,
                    "country": c,
                    "publication_date": pub_date,
                    "source_url": full,
                })

        if not rows:
            raise FetchError(
                "Wayback returned the index page but no countries could be "
                "extracted from the linked publications."
            )
        return rows
