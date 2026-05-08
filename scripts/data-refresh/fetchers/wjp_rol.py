"""World Justice Project Rule of Law Index — country page scrape."""
from __future__ import annotations

import json
import re
from typing import Any

from bs4 import BeautifulSoup

from ..common import Fetcher, FetchError, http_get


class WjpRolFetcher(Fetcher):
    id = "wjp-rule-of-law"
    name = "WJP Rule of Law Index"
    url = "https://worldjusticeproject.org/rule-of-law-index/global"
    out_filename = "wjp-rule-of-law.xlsx"
    # Page is fully client-rendered (initial HTML is ~5KB stub). No public JSON
    # endpoint discovered; data download requires email registration. Skipped
    # from daily auto-run.
    requires_headless = True

    def columns(self):
        return [
            ("rank", "Rank", 8),
            ("country", "Country", 36),
            ("region", "Region", 26),
            ("overall_score", "Overall Score (0-1)", 16),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        html = http_get(self.url).decode("utf-8", errors="replace")
        soup = BeautifulSoup(html, "html.parser")

        rows: list[dict[str, Any]] = []

        # Try common rank-table selectors
        for tr in soup.find_all("tr"):
            cells = tr.find_all(["td"])
            if len(cells) < 3:
                continue
            try:
                rank_text = cells[0].get_text(strip=True)
                if not re.match(r"^\d+$", rank_text):
                    continue
                country = cells[1].get_text(strip=True)
                m = None
                for c in cells[2:]:
                    txt = c.get_text(strip=True)
                    m = re.search(r"^(0\.\d+|\.\d+)$", txt)
                    if m:
                        break
                if not m:
                    continue
                rows.append({
                    "rank": int(rank_text),
                    "country": country,
                    "region": "",
                    "overall_score": float(m.group(1)),
                })
            except (ValueError, AttributeError):
                continue

        # Fallback: WJP sometimes inlines data as a JSON blob in <script>.
        if not rows:
            for script in soup.find_all("script"):
                t = script.string or ""
                m = re.search(r"\"countries\"\s*:\s*(\[[^\]]+\])", t, re.S)
                if m:
                    try:
                        data = json.loads(m.group(1))
                        for d in data:
                            if not isinstance(d, dict):
                                continue
                            country = d.get("name") or d.get("country") or ""
                            score = d.get("score") or d.get("overall")
                            rank = d.get("rank")
                            if country and isinstance(score, (int, float)):
                                rows.append({
                                    "rank": rank or "",
                                    "country": country,
                                    "region": d.get("region", ""),
                                    "overall_score": float(score),
                                })
                    except (ValueError, json.JSONDecodeError):
                        pass

        if not rows:
            raise FetchError("WJP page rendered but no rule-of-law rows extracted")
        return rows
