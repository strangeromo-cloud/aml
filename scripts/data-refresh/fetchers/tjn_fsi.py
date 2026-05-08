"""Tax Justice Network Financial Secrecy Index — public ranking page scrape.

The full dataset spreadsheet is on https://fsi.taxjustice.net/database. The main
ranking page lists all jurisdictions with secrecy score + global scale weight.
"""
from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

from ..common import Fetcher, FetchError, http_get


class TjnFsiFetcher(Fetcher):
    id = "tjn-fsi"
    name = "Tax Justice Network Financial Secrecy Index"
    url = "https://fsi.taxjustice.net/"
    out_filename = "tjn-fsi.xlsx"
    # Ranking page renders the table client-side from a JSON blob inlined late
    # in the document body. Static fetch returns empty table rows. Skipped from
    # daily auto-run.
    requires_headless = True

    def columns(self):
        return [
            ("rank", "Rank", 8),
            ("country", "Jurisdiction", 36),
            ("fsi_value", "FSI Value", 14),
            ("secrecy_score", "Secrecy Score (0-100)", 22),
            ("global_scale", "Global Scale Weight (%)", 22),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        html = http_get(self.url).decode("utf-8", errors="replace")
        soup = BeautifulSoup(html, "html.parser")

        rows: list[dict[str, Any]] = []

        for tr in soup.find_all("tr"):
            cells = tr.find_all(["td", "th"])
            if len(cells) < 4:
                continue
            try:
                rank_text = cells[0].get_text(strip=True)
                if not re.match(r"^\d+$", rank_text):
                    continue
                country = cells[1].get_text(strip=True)
                # Extract numbers from later cells
                nums = []
                for c in cells[2:]:
                    txt = c.get_text(strip=True).replace(",", "").replace("%", "")
                    m = re.search(r"-?\d+\.?\d*", txt)
                    if m:
                        try:
                            nums.append(float(m.group(0)))
                        except ValueError:
                            pass
                if len(nums) < 2:
                    continue
                # Conventional column order on FSI page: rank, country, fsi_value, secrecy_score, global_scale
                rows.append({
                    "rank": int(rank_text),
                    "country": country,
                    "fsi_value": nums[0],
                    "secrecy_score": nums[1] if len(nums) > 1 else "",
                    "global_scale": nums[2] if len(nums) > 2 else "",
                })
            except (ValueError, AttributeError):
                continue

        if not rows:
            raise FetchError("TJN FSI page parsed but no jurisdiction rows extracted")
        return rows
