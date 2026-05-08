"""UN Security Council Consolidated Sanctions List — XML download."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

from ..common import Fetcher, FetchError, http_get


class UnConsolidatedFetcher(Fetcher):
    id = "un-consolidated"
    name = "UN Security Council Consolidated Sanctions List"
    url = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
    out_filename = "un-consolidated.xlsx"

    def columns(self):
        return [
            ("kind", "Kind", 12),
            ("dataid", "DataID", 12),
            ("listed_on", "Listed On", 14),
            ("name", "Full name", 50),
            ("aliases", "Aliases", 60),
            ("nationalities", "Nationality / Country", 30),
            ("comment", "Comment", 60),
            ("ref_number", "Ref Number", 18),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        raw = http_get(self.url, timeout=120)
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as e:
            raise FetchError(f"UN XML parse failed: {e}")

        rows: list[dict[str, Any]] = []
        for kind_tag, kind_label in [("INDIVIDUALS/INDIVIDUAL", "Individual"), ("ENTITIES/ENTITY", "Entity")]:
            for item in root.findall(kind_tag):
                def t(name: str) -> str:
                    el = item.find(name)
                    return (el.text or "").strip() if el is not None and el.text else ""

                name = " ".join(filter(None, [
                    t("FIRST_NAME"), t("SECOND_NAME"), t("THIRD_NAME"),
                    t("FOURTH_NAME"), t("FIFTH_NAME"),
                ])).strip()
                if not name:
                    name = t("FIRST_NAME") or "(unknown)"

                aliases = []
                for al in item.findall("INDIVIDUAL_ALIAS") + item.findall("ENTITY_ALIAS"):
                    a = al.find("ALIAS_NAME")
                    if a is not None and a.text:
                        aliases.append(a.text.strip())

                nationalities = []
                for n in item.findall("NATIONALITY/VALUE"):
                    if n.text:
                        nationalities.append(n.text.strip())

                rows.append({
                    "kind": kind_label,
                    "dataid": t("DATAID"),
                    "listed_on": t("LISTED_ON"),
                    "name": name,
                    "aliases": " ; ".join(aliases),
                    "nationalities": " ; ".join(nationalities),
                    "comment": t("COMMENTS1"),
                    "ref_number": t("REFERENCE_NUMBER"),
                })

        if not rows:
            raise FetchError("UN XML parsed but no INDIVIDUALS/ENTITIES found")
        return rows
