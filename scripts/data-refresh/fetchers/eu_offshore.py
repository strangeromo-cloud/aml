"""EU / Eurostat list of offshore financial centres — HTML scrape.

The page renders the whole list as a single comma-separated paragraph right
after the literal text "Offshore financial centres:", sourced from the ECB /
Eurostat Balance of Payments Vademecum appendix 7. There is no table and no
JS rendering, so a plain GET + regex over the parser output is enough.
"""
from __future__ import annotations

import html
import re
from typing import Any

from ..common import Fetcher, FetchError, http_get

# Jurisdiction name → ISO 3166-1 alpha-2, so the list can be joined against
# vendor_master.land1 / vendor_bank.bank_country without fuzzy matching.
ISO = {
    "Andorra": "AD", "Antigua and Barbuda": "AG", "Anguilla": "AI", "Aruba": "AW",
    "Barbados": "BB", "Bahrain": "BH", "Bermuda": "BM", "Bahamas": "BS",
    "Belize": "BZ", "Cook Islands": "CK", "Curaçao": "CW", "Cayman Islands": "KY",
    "Dominica": "DM", "Grenada": "GD", "Guernsey": "GG", "Gibraltar": "GI",
    "Hong Kong": "HK", "Isle of Man": "IM", "Jersey": "JE",
    "St Kitts and Nevis": "KN", "Lebanon": "LB", "Saint Lucia": "LC",
    "Liechtenstein": "LI", "Liberia": "LR", "Marshall Islands": "MH",
    "Montserrat": "MS", "Mauritius": "MU", "Nauru": "NR", "Niue": "NU",
    "Panama": "PA", "Philippines": "PH", "Seychelles": "SC", "Singapore": "SG",
    "Sint Maarten": "SX", "Turks and Caicos Islands": "TC",
    "Saint Vincent and the Grenadines": "VC", "Virgin Islands (British)": "VG",
    "Virgin Islands (U.S.)": "VI", "Vanuatu": "VU", "Samoa": "WS",
}


class EuOffshoreFetcher(Fetcher):
    id = "eu-offshore-centres"
    name = "EU / Eurostat List of Offshore Financial Centres"
    url = ("https://ec.europa.eu/eurostat/statistics-explained/index.php"
           "?title=Glossary:List_of_offshore_financial_centres")
    out_filename = "eu-offshore-centres.xlsx"

    def columns(self):
        return [
            ("jurisdiction", "Jurisdiction", 42),
            ("iso2", "ISO alpha-2", 14),
            ("matched", "ISO mapped", 14),
        ]

    def extra_about_rows(self):
        return [
            ("Upstream source",
             "Eurostat Statistics Explained glossary, derived from the "
             "Balance of Payments Vademecum, appendix 7."),
            ("Use in AML scoring",
             "Rule R4 (T2) — alert when the receiving-bank country is on this list."),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        raw = http_get(self.url).decode("utf-8", errors="replace")

        # Narrow to the MediaWiki parser output so page chrome can't leak in.
        body = raw
        m = re.search(r'class="[^"]*mw-parser-output[^"]*"[^>]*>(.*?)<h2', raw, re.S)
        if m:
            body = m.group(1)

        # The list lives in the paragraph following "Offshore financial centres:".
        m = re.search(r"Offshore financial centres\s*:\s*</p>\s*<p>(.*?)</p>", body, re.S | re.I)
        if not m:
            # Fall back to the first paragraph that mentions a known jurisdiction.
            for para in re.findall(r"<p>(.*?)</p>", body, re.S):
                if "Cayman Islands" in para:
                    m = re.match(r"(.*)", para, re.S)
                    break
        if not m:
            raise FetchError(
                "offshore list paragraph not found — page layout changed; "
                "check for 'Offshore financial centres:' on the Eurostat glossary page"
            )

        text = html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))
        names = [n.strip() for n in text.split(",") if n.strip()]

        rows: list[dict[str, Any]] = []
        for n in names:
            iso = ISO.get(n, "")
            rows.append({
                "jurisdiction": n,
                "iso2": iso,
                "matched": "yes" if iso else "NO — needs mapping",
            })

        if len(rows) < 20:
            raise FetchError(
                f"only {len(rows)} jurisdictions parsed (expected ~40) — "
                "the paragraph split is probably wrong"
            )
        return rows
