"""Basel AML Index — JS-rendered ranking page, scraped via headless browser."""
from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

from ..common import Fetcher, FetchError
from ..headless import HeadlessError, fetch_rendered_html


class BaselAmlFetcher(Fetcher):
    id = "basel-aml-index"
    name = "Basel AML Index"
    url = "https://index.baselgovernance.org/ranking"
    out_filename = "basel-aml-index.xlsx"
    requires_headless = True

    def columns(self):
        return [
            ("rank", "Rank", 8),
            ("country", "Jurisdiction", 36),
            ("overall_score", "Overall Score (0-10)", 22),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        try:
            html = fetch_rendered_html(
                self.url,
                wait_selector="table tbody tr",
                extra_settle_ms=1000,
                timeout_ms=60_000,
                debug_slug="basel",
            )
        except HeadlessError as e:
            raise FetchError(f"{e}")

        soup = BeautifulSoup(html, "html.parser")
        rows: list[dict[str, Any]] = []
        for tbl in soup.find_all("table"):
            head = tbl.find("thead")
            if not head:
                continue
            head_text = head.get_text(" ", strip=True).lower()
            if "rank" not in head_text or "score" not in head_text:
                continue
            for tr in tbl.find_all("tr"):
                cells = tr.find_all(["td"])
                if len(cells) < 3:
                    continue
                rank_text = cells[0].get_text(strip=True)
                if not re.match(r"^\d+$", rank_text):
                    continue
                country = cells[1].get_text(strip=True)
                score_text = cells[-1].get_text(strip=True)
                m = re.search(r"(\d+\.\d+)", score_text)
                if not m:
                    continue
                rows.append({
                    "rank": int(rank_text),
                    "country": country,
                    "overall_score": float(m.group(1)),
                })
            if rows:
                break

        if not rows:
            raise FetchError("Basel ranking table rendered but no scored rows extracted")
        return rows
