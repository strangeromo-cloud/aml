"""OFAC Sanctions Programs by Country — HTML scrape."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..common import Fetcher, FetchError, http_get


class OfacCountriesFetcher(Fetcher):
    id = "ofac-country-programs"
    name = "OFAC Sanctions Programs by Country"
    url = "https://ofac.treasury.gov/sanctions-programs-and-country-information"
    out_filename = "ofac-country-programs.xlsx"

    def columns(self):
        return [
            ("name", "Program / Country", 50),
            ("href", "Detail URL", 80),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        html = http_get(self.url).decode("utf-8", errors="replace")
        soup = BeautifulSoup(html, "html.parser")
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()

        # The page has a list of links pointing to /sanctions-programs-and-country-information/<slug>.
        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True)
            if not text or len(text) < 3:
                continue
            if "/sanctions-programs-and-country-information/" not in href:
                continue
            if text in seen:
                continue
            # Filter out generic nav like "View all" or empty anchors
            if re.match(r"^(View all|All programs|Sanctions programs?$)", text, re.I):
                continue
            seen.add(text)
            rows.append({"name": text, "href": urljoin(self.url, href)})

        if not rows:
            raise FetchError("No program / country links found on OFAC page")
        return rows
