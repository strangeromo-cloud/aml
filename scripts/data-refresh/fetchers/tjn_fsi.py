"""Tax Justice Network FSI — captured via headless browser network interception.

The fsi.taxjustice.net page calls a token-protected JSON API at
api.data.taxjustice.net. The token is set by JavaScript at runtime, so a plain
HTTP request returns 401. Instead of reverse-engineering the auth, we let the
browser do its thing and intercept the JSON responses we care about.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

from ..common import Fetcher, FetchError


SCORINGS_RE = re.compile(r"/v1/query/fsi_scorings(?:\?|$)")
JURIS_RE = re.compile(r"/v1/query/fsi_jurisdictions")


class TjnFsiFetcher(Fetcher):
    id = "tjn-fsi"
    name = "Tax Justice Network Financial Secrecy Index"
    url = "https://fsi.taxjustice.net/"
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
        scorings_payload: dict | None = None
        juris_payloads: list[dict] = []

        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"],
            )
            try:
                ctx = browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36"
                    ),
                    viewport={"width": 1440, "height": 900},
                )
                page = ctx.new_page()
                page.set_default_timeout(60_000)

                def on_response(r):
                    nonlocal scorings_payload
                    try:
                        if SCORINGS_RE.search(r.url) and r.ok:
                            scorings_payload = r.json()
                        elif JURIS_RE.search(r.url) and r.ok:
                            juris_payloads.append(r.json())
                    except Exception:
                        pass

                page.on("response", on_response)
                try:
                    page.goto(self.url, wait_until="networkidle", timeout=60_000)
                except PlaywrightTimeout:
                    pass  # we don't need full networkidle, just the API responses

                # Wait until at least one juris response arrives or 30s elapsed
                page.wait_for_timeout(2000)
                deadline = 30_000
                while not juris_payloads and deadline > 0:
                    page.wait_for_timeout(500)
                    deadline -= 500
            finally:
                browser.close()

        if not juris_payloads:
            raise FetchError(
                "TJN page rendered but no fsi_jurisdictions response captured. "
                "Endpoint or auth flow may have changed."
            )

        # Merge all juris payloads (paginated batches). The TJN API returns a
        # flat list, not wrapped in {data: ...}.
        merged: list[dict] = []
        for p in juris_payloads:
            if isinstance(p, list):
                merged.extend(p)
            elif isinstance(p, dict):
                inner = p.get("data") or p.get("results") or []
                if isinstance(inner, list):
                    merged.extend(inner)
        if not merged:
            raise FetchError("TJN juris payloads contained no rows")

        # Schema (FSI 2022 / 8.0):
        #   jurisdiction_id   "AD"  (ISO-2)
        #   jurisdiction_name "Andorra"
        #   index_score       secrecy score (0-100, higher = more secrecy)
        #   index_value       FSI value (composite)
        #   index_share       global share (0-1)
        #   rank              integer
        #   gsw               global scale weight
        rows: list[dict[str, Any]] = []
        for d in merged:
            if not isinstance(d, dict):
                continue
            country = d.get("jurisdiction_name") or d.get("jurisdiction") or ""
            if not country:
                continue
            rank = d.get("rank")
            try:
                rank = int(rank) if rank not in (None, "") else ""
            except (TypeError, ValueError):
                pass
            rows.append({
                "rank": rank,
                "country": country,
                "iso2": d.get("jurisdiction_id") or "",
                "fsi_value": d.get("index_value", ""),
                "secrecy_score": d.get("index_score", ""),
                "global_scale": (d.get("index_share", 0) * 100) if isinstance(d.get("index_share"), (int, float)) else "",
            })

        if not rows:
            raise FetchError("TJN payload merged but no jurisdiction rows usable")

        rows.sort(key=lambda r: r.get("rank") if isinstance(r.get("rank"), int) else 10**9)
        return rows
