"""EU Consolidated Financial Sanctions List — XML download.

The EU FSF endpoint requires a token query string. The documented public token
"dG9rZW4tMjAxNw" works for read-only access to the consolidated XML.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

from ..common import Fetcher, FetchError, http_get


class EuConsolidatedFetcher(Fetcher):
    id = "eu-consolidated"
    name = "EU Consolidated Financial Sanctions List"
    url = (
        "https://webgate.ec.europa.eu/fsd/fsf/public/files/"
        "xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
    )
    out_filename = "eu-consolidated.xlsx"

    def columns(self):
        return [
            ("kind", "Kind", 12),
            ("logical_id", "Logical ID", 12),
            ("listed_on", "Listed On", 14),
            ("name", "Name", 50),
            ("aliases", "Aliases", 60),
            ("countries", "Countries", 30),
            ("regulation", "Regulation", 26),
            ("remarks", "Remarks", 60),
        ]

    def fetch(self) -> list[dict[str, Any]]:
        raw = http_get(self.url, timeout=120)
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as e:
            raise FetchError(f"EU XML parse failed: {e}")

        # Strip default namespaces so XPath stays simple
        for el in root.iter():
            if isinstance(el.tag, str) and "}" in el.tag:
                el.tag = el.tag.split("}", 1)[1]

        rows: list[dict[str, Any]] = []
        for entity in root.findall(".//sanctionEntity"):
            kind = entity.attrib.get("euReferenceNumber", "")
            sub = entity.find("subjectType")
            kind_code = sub.get("code") if sub is not None else ""
            kind_label = "Person" if (kind_code or "").upper().startswith("P") else "Entity"

            names = []
            primary_name = ""
            for n in entity.findall(".//nameAlias"):
                wholeName = n.attrib.get("wholeName") or ""
                if not wholeName:
                    parts = [n.attrib.get(k, "") for k in ("firstName", "middleName", "lastName")]
                    wholeName = " ".join(p for p in parts if p).strip()
                if wholeName:
                    if not primary_name:
                        primary_name = wholeName
                    else:
                        names.append(wholeName)

            countries = []
            for c in entity.findall(".//citizenship"):
                cc = c.attrib.get("countryDescription") or c.attrib.get("country") or ""
                if cc:
                    countries.append(cc)
            for a in entity.findall(".//address"):
                cc = a.attrib.get("countryDescription") or ""
                if cc:
                    countries.append(cc)

            regulation = ""
            reg = entity.find("regulation")
            if reg is not None:
                regulation = reg.attrib.get("publicationTitle") or reg.attrib.get("numberTitle") or ""

            listed_on = ""
            for r in entity.findall("regulation"):
                d = r.attrib.get("entryIntoForceDate")
                if d:
                    listed_on = d
                    break

            remarks = (entity.findtext("remark") or "").strip()

            rows.append({
                "kind": kind_label,
                "logical_id": kind,
                "listed_on": listed_on,
                "name": primary_name,
                "aliases": " ; ".join(names),
                "countries": " ; ".join(sorted(set(countries))),
                "regulation": regulation,
                "remarks": remarks,
            })

        if not rows:
            raise FetchError("EU XML parsed but no sanctionEntity elements found")
        return rows
