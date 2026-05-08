"""WJP Rule of Law Index — direct CSV download.

The /rule-of-law-index/global page is JS-rendered, but the underlying data
is served as plain CSV from /rule-of-law-index/data/<year>.csv. The CSV is
transposed (rows = indicators, columns = countries) so we pivot it back into
one row per country.
"""
from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any

from ..common import Fetcher, FetchError, http_get


CSV_TEMPLATE = "https://worldjusticeproject.org/rule-of-law-index/data/{year}.csv"


class WjpRolFetcher(Fetcher):
    id = "wjp-rule-of-law"
    name = "WJP Rule of Law Index"
    url = ""  # set dynamically once we know which year resolves
    out_filename = "wjp-rule-of-law.xlsx"

    def columns(self):
        return [
            ("country", "Country", 32),
            ("iso3", "ISO Code", 10),
            ("region", "Region", 36),
            ("income_group", "Income Group", 18),
            ("overall_score", "Overall Score (0-1)", 18),
            ("factor_1", "F1: Constraints on Government Powers", 36),
            ("factor_2", "F2: Absence of Corruption", 28),
            ("factor_3", "F3: Open Government", 22),
            ("factor_4", "F4: Fundamental Rights", 24),
            ("factor_5", "F5: Order and Security", 24),
            ("factor_6", "F6: Regulatory Enforcement", 28),
            ("factor_7", "F7: Civil Justice", 20),
            ("factor_8", "F8: Criminal Justice", 22),
        ]

    def _fetch_year(self, year: int) -> bytes | None:
        url = CSV_TEMPLATE.format(year=year)
        try:
            data = http_get(url, timeout=45, retries=2)
        except FetchError:
            return None
        # The site returns a 200 HTML SPA shell for unknown paths. Only accept
        # responses whose first line looks like the CSV header.
        head = data[:300].decode("utf-8-sig", errors="replace").lower()
        if not (head.startswith("country,") or "country code" in head[:200]):
            return None
        self.url = url
        return data

    def fetch(self) -> list[dict[str, Any]]:
        # Walk back up to 4 years to find the most recent published CSV
        data: bytes | None = None
        for y in range(date.today().year, date.today().year - 4, -1):
            data = self._fetch_year(y)
            if data:
                break
        if not data:
            raise FetchError("No recent WJP CSV found")

        # Parse: each row is one indicator across all countries
        text = data.decode("utf-8-sig", errors="replace")
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
        if len(rows) < 5:
            raise FetchError("WJP CSV has too few rows")

        # rows[0] = ["Country", country1, country2, ...]
        countries = rows[0][1:]

        def find(label: str) -> list[str]:
            for r in rows:
                if r and r[0].strip().startswith(label):
                    return r[1:]
            return [""] * len(countries)

        codes = find("Country Code")
        regions = find("Region")
        income = find("Income Group")
        overall = find("WJP Rule of Law Index: Overall Score")
        f1 = find("Factor 1:")
        f2 = find("Factor 2:")
        f3 = find("Factor 3:")
        f4 = find("Factor 4:")
        f5 = find("Factor 5:")
        f6 = find("Factor 6:")
        f7 = find("Factor 7:")
        f8 = find("Factor 8:")

        def f(s: str) -> float | str:
            try:
                return float(s)
            except (ValueError, TypeError):
                return ""

        out: list[dict[str, Any]] = []
        for i, name in enumerate(countries):
            if not name:
                continue
            out.append({
                "country": name,
                "iso3": codes[i] if i < len(codes) else "",
                "region": regions[i] if i < len(regions) else "",
                "income_group": income[i] if i < len(income) else "",
                "overall_score": f(overall[i]) if i < len(overall) else "",
                "factor_1": f(f1[i]) if i < len(f1) else "",
                "factor_2": f(f2[i]) if i < len(f2) else "",
                "factor_3": f(f3[i]) if i < len(f3) else "",
                "factor_4": f(f4[i]) if i < len(f4) else "",
                "factor_5": f(f5[i]) if i < len(f5) else "",
                "factor_6": f(f6[i]) if i < len(f6) else "",
                "factor_7": f(f7[i]) if i < len(f7) else "",
                "factor_8": f(f8[i]) if i < len(f8) else "",
            })
        if not out:
            raise FetchError("WJP CSV parsed but no country rows extracted")
        return out
