"""Basel AML Index — public ranking page scrape.

The full report is a PDF behind email registration; the public ranking page
exposes per-country scores in the page DOM, which we scrape.
"""
from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

from ..common import Fetcher, FetchError, http_get


class BaselAmlFetcher(Fetcher):
    id = "basel-aml-index"
    name = "Basel AML Index"
    url = "https://index.baselgovernance.org/ranking"
    out_filename = "basel-aml-index.xlsx"
    # Page is JS-rendered (Nuxt + Directus). Public Directus collections expose
    # country metadata only; per-country scores require auth or a headless
    # browser. Skipped from daily auto-run.
    requires_headless = True

    def columns(self):
        return [
            ("rank", "Rank", 8),
            ("country", "Country", 32),
            ("region", "Region", 26),
            ("overall_score", "Overall Risk Score (0-10)", 18),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        html = http_get(self.url).decode("utf-8", errors="replace")
        soup = BeautifulSoup(html, "html.parser")
        rows: list[dict[str, Any]] = []

        # The ranking page renders a table; rows have: rank, country, region, score.
        # Try multiple selectors because the page DOM has shifted year-on-year.
        for tr in soup.find_all("tr"):
            cells = tr.find_all(["td"])
            if len(cells) < 4:
                continue
            try:
                rank_text = cells[0].get_text(strip=True)
                if not re.match(r"^\d+$", rank_text):
                    continue
                country = cells[1].get_text(strip=True)
                region = cells[2].get_text(strip=True)
                score_text = cells[-1].get_text(strip=True)
                m = re.search(r"(\d+\.?\d*)", score_text)
                if not m:
                    continue
                rows.append({
                    "rank": int(rank_text),
                    "country": country,
                    "region": region,
                    "overall_score": float(m.group(1)),
                })
            except (ValueError, AttributeError):
                continue

        if not rows:
            raise FetchError("Basel ranking page parsed but no scored rows found")
        return rows

    def extra_about_rows(self):
        return [
            ("Note",
             "Public Basel AML Index ranking page. Full report (with sub-indicators) is "
             "released annually as a PDF that requires email registration."),
        ]
