"""FATF High-Risk and Other Monitored Jurisdictions.

Try official HTTP, then FIAU's copies of the original FATF PDFs before launching
Chromium. Only a complete, dated pair is accepted. Record the actual provider;
Wayback is the final fallback and retains its 45-day staleness limit.
"""
from __future__ import annotations

import json
import logging
import re
from contextlib import contextmanager
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import quote, urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from ..common import Fetcher, FetchError, http_get
from .fiau import FIAU_INDEX, fetch_fiau


FATF_INDEX = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions.html"
FATF_CURRENT = "https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html"
OFFICIAL_INDEXES = (FATF_INDEX, FATF_CURRENT)
CDX_API = "https://web.archive.org/cdx/search/cdx"
WB_PREFIX = "https://web.archive.org/web/"

# Snapshot freshness is independent of the publication cycle. Never relax this
# guard simply because both live transports are unavailable.
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
        # Wayback may rewrite hrefs even though we resolve against the original
        # official index. Always return the underlying source URL.
        replay = re.search(r"/web/\d+(?:[a-z_]+)?/(https?://.+)", href)
        target = replay.group(1) if replay else urljoin(base, href)
        if urlparse(target).hostname not in {"www.fatf-gafi.org", "fatf-gafi.org"}:
            continue
        # Score on year + month found in the title or URL
        haystack = (title + " " + target).lower()
        m_year = re.search(r"(20\d{2})", haystack)
        year = int(m_year.group(1)) if m_year else 0
        month = next((i for i, n in enumerate(months, start=1) if n in haystack), 0)
        if "call-for-action" in href.lower() or "call for action" in title:
            cfa_links.append((year, month, target))
        elif "increased-monitoring" in href.lower() or "increased monitoring" in title:
            im_links.append((year, month, target))

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


# Preserve fetched markup for diagnosing challenges and changes to the Country
# facet. Diagnostics must not turn an unavailable or incomplete list into success.
DEBUG_DIR = "/tmp/data-refresh-debug"


def _dump_html(status: str, url: str, html: str) -> None:
    try:
        from pathlib import Path
        Path(DEBUG_DIR).mkdir(parents=True, exist_ok=True)
        if "Call for Action" in status:
            slug = "blacklist-cfa"
        elif "Increased Monitoring" in status:
            slug = "greylist-im"
        else:
            slug = "browser-error"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        out = Path(DEBUG_DIR) / f"fatf-{slug}-{stamp}.html"
        out.write_text(f"<!-- source: {url} -->\n{html}", encoding="utf-8")
    except Exception:
        # Diagnostics must never break the fetch.
        pass


# Each statement page carries a "Country" facet in its publication details: a single
# <p> of <a href="/en/countries/detail/<Name>.html"> links that IS the list. Read that.
#
# Scanning the whole page instead is what produced the wrong black list: every FATF
# page footer carries the 38-strong FATF *member* nations list using the same link
# pattern, so South Africa and Türkiye — members, not listed jurisdictions — were
# collected as if the statement had named them. On the June 2026 grey-list page the
# facet holds 22 links while the page holds 60.
COUNTRY_LINK_RE = re.compile(
    r'<a[^>]+href="[^"]*/countries/detail/[^"]*"[^>]*>(.*?)</a>', re.S | re.I)


def _countries_from_facet(html: str) -> list[str]:
    """Jurisdictions from the Country facet only. [] if the facet is not found.

    The facet can span several <p> elements inside one container — the June 2026
    black-list page splits it as "DPRK, Iran" then "Myanmar", so reading only the
    first paragraph loses Myanmar. Take every country link in the container holding
    the first one, which keeps the footer's FATF-member list out (that lives in a
    different container: 41 links on the black page and 60 on the grey page, versus
    3 and 22 in the facet).
    """
    soup = BeautifulSoup(html, "html.parser")
    for chrome in soup.find_all(["header", "nav", "footer"]):
        chrome.decompose()

    def country_links(tag):
        return [a for a in tag.find_all("a", href=True)
                if "/countries/detail/" in a["href"]]

    paras = [para for para in soup.find_all("p") if country_links(para)]
    if not paras:
        return []
    box = paras[0].parent
    names, seen = [], set()
    for para in paras:
        if para.parent is not box:
            continue
        for a in country_links(para):
            name = a.get_text(strip=True)
            if not name:
                # Fall back to the href slug when the anchor text is empty.
                name = a["href"].rsplit("/", 1)[-1].removesuffix(".html").replace("-", " ")
            if name not in seen:
                seen.add(name)
                names.append(name)
    return names


def _extract_pub_date(url: str, html_head: str) -> str:
    """Exact statement date when the page states one, else "<Month> <Year>".

    A day-precision date matters downstream: the verifier compares a source's list
    date against the baseline's to tell "this mirror is older" from "the baseline has
    gone stale", and a month-only label cannot be compared. The title carries it
    ("... Call for Action - 19 June 2026") and so does the dateline ("Paris, 19 June,
    2026"), so prefer those over the month in the URL slug.
    """
    MONTHS = ("january|february|march|april|may|june|july|august|september|"
              "october|november|december")
    for pattern in (rf"(\d{{1,2}})\s+({MONTHS}),?\s+(20\d{{2}})",
                    rf"({MONTHS})\s+(\d{{1,2}}),?\s+(20\d{{2}})"):
        m = re.search(pattern, html_head[:4000], re.I)
        if m:
            g = list(m.groups())
            day, month, year = (g if g[0].isdigit() else [g[1], g[0], g[2]])
            return f"{int(day)} {month.title()} {year}"
    m = re.search(rf"({MONTHS})[-\s]+(20\d{{2}})", (url + " " + html_head[:1000]).lower())
    return " ".join(m.groups()).title() if m else ""


# -----------------------------------------------------------------------------
# Live official transports
# -----------------------------------------------------------------------------


def _check_html(html: str, url: str, *, publication: bool) -> None:
    """A 200 response or a finished navigation can still be a challenge page."""
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True).lower() if soup.title else ""
    if "just a moment" in title or "checking your browser" in title:
        raise FetchError(f"FATF challenge page at {url} (title={title!r})")
    if publication:
        heading = soup.find("h1")
        heading_text = heading.get_text(" ", strip=True).lower() if heading else ""
        statement = "call for action" in heading_text or "increased monitoring" in heading_text
        # A prose scan can collect FATF members or countries being removed and
        # still pass the numeric range checks. Require the structured country
        # facet; a layout change must be diagnosed instead of becoming new data.
        ready = statement and bool(_countries_from_facet(html))
    else:
        ready = all(_extract_publication_links(html, url))
    if not ready:
        kind = "statement countries" if publication else "both statement links"
        raise FetchError(f"FATF page missing {kind}: {url} (title={title!r})")


def _http_fetch(url: str, *, publication: bool = False) -> str:
    html = http_get(url, timeout=30, retries=2).decode("utf-8", errors="replace")
    _check_html(html, url, publication=publication)
    return html


@contextmanager
def _playwright_session():
    """Keep clearance cookies across the index and the two publication pages."""
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        try:
            # Use the installed browser's own UA. A fixed Chrome/127 UA drifted
            # from the bundled Chromium version and made challenge failures opaque.
            ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                                      locale="en-US")
            yield ctx.new_page()
        finally:
            browser.close()


def _playwright_fetch(url: str, *, page, publication: bool = False,
                      timeout_ms: int = 45_000) -> str:
    """Wait for the requested page's content, not a link in the global menu."""
    page.set_default_timeout(timeout_ms)
    page.set_default_navigation_timeout(timeout_ms)
    try:
        response = page.goto(url, wait_until="domcontentloaded")
        # Content may arrive after DOMContentLoaded / a Cloudflare transition.
        # Checking the HTML also handles case changes in statement URL slugs.
        for attempt in range(31):
            html = page.content()
            try:
                _check_html(html, url, publication=publication)
                return html
            except FetchError:
                if attempt == 30:
                    break
                page.wait_for_timeout(500)
        status = response.status if response else "no response"
        title = page.title()
        raise FetchError(f"FATF browser content unavailable: {url} "
                         f"(HTTP {status}, title={title!r})")
    except Exception as e:
        # HTML is often more useful than a screenshot for diagnosing a changed
        # layout; neither diagnostic is allowed to hide the original failure.
        try:
            _dump_html("browser-error", url, page.content())
        except Exception:
            pass
        try:
            from pathlib import Path
            Path(DEBUG_DIR).mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            page.screenshot(path=f"{DEBUG_DIR}/fatf-browser-{stamp}.png", full_page=True,
                            timeout=5000)
        except Exception:
            pass
        if isinstance(e, FetchError):
            raise
        raise FetchError(f"FATF browser fetch failed at {url}: {type(e).__name__}: {e}") from e


# -----------------------------------------------------------------------------
# Wayback Machine (final fallback only)
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
    requires_headless = True  # the live-site fallback still needs Chromium

    # Set during fetch() so they appear on the About sheet
    _strategy: str = ""
    _extraction: str = ""
    _index_snapshot_date: str = ""
    _index_snapshot_url: str = ""
    source_provider: str = "FATF 官网"

    def columns(self):
        return [
            ("status", "FATF Status", 30),
            ("country", "Country / Jurisdiction", 40),
            ("publication_date", "Statement Date", 20),
            ("source_url", "Source URL", 60),
        ]

    def extra_about_rows(self):
        rows = [("Source provider", self.source_provider),
                ("Fetch strategy", self._strategy or "n/a"),
                ("Extraction", self._extraction or "n/a")]
        if self._strategy == "wayback":
            rows.extend([
                ("Wayback snapshot taken", self._index_snapshot_date or "n/a"),
                ("Wayback snapshot URL", self._index_snapshot_url or "n/a"),
                ("Staleness rule",
                 f"Run fails if Wayback snapshot is older than {WAYBACK_STALE_AFTER_DAYS} days"),
            ])
        return rows

    def _accept(self, rows: list[dict[str, Any]], strategy: str,
                provider: str, source_url: str) -> list[dict[str, Any]]:
        # Apply one acceptance contract to every transport. A recent archive
        # capture must never revive an edition rejected as stale from FIAU.
        self._validate_statement_rows(rows, provider)
        self._strategy = strategy
        self.source_provider = provider
        self.url = source_url
        for row in rows:
            row["source_provider"] = provider
        return rows

    def _validate_statement_rows(self, rows: list[dict[str, Any]], provider: str) -> None:
        from ..verify_fatf import baseline_due_check, load_baseline, parse_date, validate_rows
        rejected = validate_rows(rows)
        if rejected:
            raise FetchError(f"{provider} 名单不完整：{rejected}")
        dates = {parse_date(row.get("publication_date")) for row in rows}
        if len(dates) != 1 or None in dates:
            raise FetchError(f"{provider} 黑灰名单缺少同一天的 FATF 声明日期")
        statement_date = next(iter(dates))
        try:
            date.fromisoformat(statement_date)
        except (TypeError, ValueError) as exc:
            raise FetchError(f"{provider} FATF 声明日期不是有效日历日期：{statement_date}") from exc
        if statement_date > datetime.now(timezone.utc).date().isoformat():
            raise FetchError(f"{provider} 声明日期在未来：{statement_date}")
        baseline = load_baseline() or {}
        baseline_date = parse_date(baseline.get("listDate"))
        if baseline_date and statement_date < baseline_date:
            raise FetchError(f"{provider} 声明 {statement_date} 早于法务基线 {baseline_date}")
        # Reuse the existing month-end + 7 day publication grace. Downloading an
        # old mirror successfully must not hide a missed plenary update.
        due = baseline_due_check(statement_date)
        if due["due"]:
            raise FetchError(f"{provider} 声明 {statement_date} 尚未覆盖应更新期 "
                             f"{due['latestDuePlenary']}（月底后宽限 7 天）")

    def _rows_from_index(self, index_html: str, index_url: str, fetch_page) -> list[dict[str, Any]]:
        cfa_url, im_url = _extract_publication_links(index_html, index_url)
        if not cfa_url or not im_url:
            raise FetchError(f"FATF index missing black/grey statement links: {index_url}")
        rows: list[dict[str, Any]] = []
        extractions = set()
        for status, raw_url in [
            ("Blacklist (Call for Action)", cfa_url),
            ("Greylist (Increased Monitoring)", im_url),
        ]:
            html = fetch_page(raw_url, publication=True)
            _dump_html(status, raw_url, html)
            countries = _countries_from_facet(html)
            if not countries:
                raise FetchError(f"FATF statement has no country facet: {raw_url}")
            extractions.add("country-facet")
            pub_date = _extract_pub_date(raw_url, html)
            for country in countries:
                rows.append({"status": status, "country": country,
                             "publication_date": pub_date, "source_url": raw_url})
        # _accept validates completeness and recency before selecting a transport.
        self._extraction = ", ".join(sorted(extractions))
        return rows

    def fetch(self) -> list[dict[str, Any]]:
        log = logging.getLogger("data-refresh")
        failures: list[str] = []
        self._strategy = self._extraction = ""
        self._index_snapshot_date = self._index_snapshot_url = ""
        self.url = FATF_INDEX
        self.source_provider = "FATF 官网"

        def failed(label: str, exc: Exception) -> None:
            detail = f"{label}: {type(exc).__name__}: {exc}"
            failures.append(detail)
            log.info("  FATF: %s", detail)

        # Both URLs are official entrances to the current pair of statements.
        # Try the inexpensive transport first; challenge responses are failures.
        for index_url in OFFICIAL_INDEXES:
            try:
                html = _http_fetch(index_url)
                rows = self._rows_from_index(html, index_url, _http_fetch)
                return self._accept(rows, "http", "FATF 官网", index_url)
            except Exception as e:
                failed(f"official HTTP {index_url}", e)

        # FIAU republishes the original documents. Attribute the successful
        # download to FIAU, and reject stale editions before using the data.
        try:
            rows = fetch_fiau()
            self._extraction = "fiau-pdf-active-list"
            return self._accept(rows, "fiau-pdf", "FIAU 转载 FATF", FIAU_INDEX)
        except Exception as e:
            failed("FIAU republication", e)

        try:
            with _playwright_session() as page:
                def render(url: str, *, publication: bool = False) -> str:
                    return _playwright_fetch(url, page=page, publication=publication)
                for index_url in OFFICIAL_INDEXES:
                    try:
                        html = render(index_url)
                        rows = self._rows_from_index(html, index_url, render)
                        return self._accept(rows, "playwright", "FATF 官网", index_url)
                    except Exception as e:
                        failed(f"official Playwright {index_url}", e)
        except Exception as e:
            failed("official Playwright session", e)

        # Last resort: an archive is acceptable only within the existing window.
        # Check the individual statement captures too: a recent index capture does
        # not prove its linked statement captures are recent.
        try:
            def archived(url: str, *, publication: bool = False) -> str:
                # Replay HTML can contain Wayback-rewritten relative links. Resolve
                # them back to the official URL before looking up its newest capture.
                if urlparse(url).hostname == "web.archive.org":
                    m = re.search(r"/web/\d+(?:[a-z_]+)?/(https?://.+)", url)
                    if not m:
                        raise FetchError(f"Unrecognized FATF archive URL: {url}")
                    url = m.group(1)
                snap_url, snap_iso = _wayback_latest(url)
                age = _days_ago(snap_iso)
                if age > WAYBACK_STALE_AFTER_DAYS:
                    raise FetchError(f"Wayback snapshot is {age} days old "
                                     f"(threshold {WAYBACK_STALE_AFTER_DAYS}): {url}")
                if not publication:
                    self._index_snapshot_url = snap_url
                    self._index_snapshot_date = snap_iso
                html = http_get(snap_url, timeout=45).decode("utf-8", errors="replace")
                _check_html(html, url, publication=publication)
                return html
            html = archived(FATF_INDEX)
            rows = self._rows_from_index(html, FATF_INDEX, archived)
            return self._accept(rows, "wayback", "FATF 官网存档（Wayback）", FATF_INDEX)
        except Exception as e:
            failed("Wayback", e)
        raise FetchError("FATF fetch failed; no complete, current source. " + " | ".join(failures))
