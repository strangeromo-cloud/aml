"""Tax Justice Network FSI — captured via headless browser network interception.

The full-list page calls a token-protected JSON API at
api.data.taxjustice.net. The token is set by JavaScript at runtime, so a plain
HTTP request returns 401. Instead of reverse-engineering the auth, we let the
browser do its thing and intercept the JSON responses we care about.
"""
from __future__ import annotations

import logging
import math
import re
from typing import Any
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

from ..common import Fetcher, FetchError


JURIS_RE = re.compile(r"/v1/query/(fsi(?:20\d{2})?)_jurisdictions/?$")
MIN_JURISDICTIONS = 100  # The full index has ~140; one table page is not a snapshot.


def _jurisdiction_records(payloads: list[Any]) -> list[dict[str, Any]]:
    """Merge observed batches without counting duplicate requests as more countries."""
    merged: dict[str, dict[str, Any]] = {}
    for payload in payloads:
        items = payload
        if isinstance(payload, dict):
            items = payload.get("data") or payload.get("results") or []
        if not isinstance(items, list):
            continue
        for d in items:
            if not isinstance(d, dict):
                continue
            country = (d.get("jurisdiction_name_en") or d.get("jurisdiction_name")
                       or d.get("jurisdiction"))
            if not isinstance(country, str) or not country.strip():
                continue
            key = str(d.get("jurisdiction_id") or country).casefold()
            merged[key] = d
    return list(merged.values())


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _complete(payloads: list[Any]) -> bool:
    records = _jurisdiction_records(payloads)
    if len(records) < MIN_JURISDICTIONS:
        return False
    # FSI shares are fractions of the whole index and must add up to one. This
    # rejects a delayed/missing page even if the first 100 jurisdictions arrived.
    # The live 2026 API returns one complete 141-row array with this invariant.
    if not all(_number(d.get("index_share")) and 0 <= d["index_share"] <= 1
               and _number(d.get("index_score")) and 0 <= d["index_score"] <= 100
               and _number(d.get("index_value")) and d["index_value"] >= 0
               for d in records):
        return False
    return math.isclose(sum(d["index_share"] for d in records), 1.0, abs_tol=1e-6)


def _jurisdiction_rows(payloads: list[Any]) -> list[dict[str, Any]]:
    rows = []
    for d in _jurisdiction_records(payloads):
        country = (d.get("jurisdiction_name_en") or d.get("jurisdiction_name")
                   or d.get("jurisdiction"))
        rank = d.get("rank")
        try:
            rank = int(rank) if rank not in (None, "") else ""
        except (TypeError, ValueError):
            rank = ""
        iso2 = d.get("jurisdiction_id") or ""
        rows.append({
            "rank": rank,
            "country": country.strip(),
            "iso2": iso2,
            "fsi_value": d.get("index_value", ""),
            "secrecy_score": d.get("index_score", ""),
            # gsw is the scale-weight fraction. index_share is the distinct
            # FSI share and must not be labelled as Global Scale Weight.
            "global_scale": d["gsw"] * 100 if _number(d.get("gsw")) else "",
        })
    return sorted(rows, key=lambda r: r["rank"]
                  if isinstance(r["rank"], int) else 10**9)


class TjnFsiFetcher(Fetcher):
    id = "tjn-fsi"
    name = "Tax Justice Network Financial Secrecy Index"
    # The homepage is now an introduction; it need not request ranking data.
    url = "https://fsi.taxjustice.net/full-list/"
    out_filename = "tjn-fsi.xlsx"
    requires_headless = True

    def columns(self):
        return [
            ("rank", "Rank", 8),
            ("country", "Jurisdiction", 36),
            ("iso2", "ISO-2", 8),
            ("fsi_value", "FSI Value", 14),
            ("secrecy_score", "Secrecy Score (0-100)", 22),
            ("global_scale", "Global Scale Weight (%)", 22),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        log = logging.getLogger("data-refresh")
        payloads_by_edition: dict[str, list[Any]] = {}
        endpoint_statuses: set[str] = set()
        parse_errors = 0
        title = ""
        navigation_status: int | str = "no response"

        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"],
            )
            try:
                ctx = browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    locale="en-US",
                )
                page = ctx.new_page()
                page.set_default_timeout(60_000)

                def on_response(r):
                    nonlocal parse_errors
                    parts = urlsplit(r.url)
                    match = JURIS_RE.search(parts.path)
                    if parts.hostname != "api.data.taxjustice.net" or not match:
                        return
                    collection = match.group(1)
                    payloads = payloads_by_edition.setdefault(collection, [])
                    # API query strings can contain session tokens; never log them.
                    endpoint_statuses.add(f"{parts.hostname}{parts.path}: HTTP {r.status}")
                    if not r.ok:
                        return
                    try:
                        payloads.append(r.json())
                    except Exception:
                        parse_errors += 1

                page.on("response", on_response)
                try:
                    response = page.goto(self.url, wait_until="domcontentloaded", timeout=60_000)
                    navigation_status = response.status if response else "no response"
                except PlaywrightTimeout:
                    log.info("TJN full-list navigation timed out; still waiting for ranking responses")

                # The first response may be a batch. Wait for enough unique rows
                # and two quiet seconds, rather than stopping at the first batch.
                previous_count = -1
                quiet_ms = 0
                for _ in range(60):
                    page.wait_for_timeout(500)
                    # Never merge two editions, nor use an older edition to mask
                    # an authorization/response failure on the current one.
                    current = max(payloads_by_edition, default="")
                    juris_payloads = payloads_by_edition.get(current, [])
                    count = sum(len(p) for p in payloads_by_edition.values())
                    quiet_ms = quiet_ms + 500 if count == previous_count else 0
                    previous_count = count
                    if quiet_ms >= 2000 and _complete(juris_payloads):
                        break
                title = page.title()[:160]
            finally:
                browser.close()

        current = max(payloads_by_edition, default="")
        juris_payloads = payloads_by_edition.get(current, [])
        rows = _jurisdiction_rows(juris_payloads)
        if not _complete(juris_payloads):
            statuses = "; ".join(sorted(endpoint_statuses)) or "no jurisdiction API response"
            raise FetchError(
                f"TJN full-list incomplete: {len(rows)} unique jurisdictions "
                f"(expected at least {MIN_JURISDICTIONS}); page HTTP {navigation_status}, "
                f"title={title!r}; {statuses}; JSON parse failures={parse_errors}. "
                "Check the full-list page, API authorization, schema and pagination "
                "(FSI shares must sum to 1)."
            )
        return rows
