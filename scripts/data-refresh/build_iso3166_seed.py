"""Generate seeds/iso3166.json — normalised country name → ISO 3166-1 alpha-2.

Alpha-2 rather than alpha-3 on purpose: it is the code the rest of the pipeline
already speaks. SAP's vendor_master.land1 is a 2-char country key and D&B returns
countryISOAlpha2Code, so a sheet carrying alpha-2 joins straight onto our own data.

Built from /usr/share/zoneinfo/iso3166.tab (public domain, ships with macOS and most
Linux distros) plus the ISO codes the offshore fetcher already parses, plus the
aliases below for the handful of names our sources spell differently. The result is
committed so CI never depends on a file being present on the runner.

Run: python3 scripts/data-refresh/build_iso3166_seed.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from importlib import import_module

vf = import_module("data-refresh.verify_fatf")

TAB = Path("/usr/share/zoneinfo/iso3166.tab")
SEED = Path(__file__).resolve().parent / "seeds" / "iso3166.json"
SNAPSHOTS = Path(__file__).resolve().parents[2] / "public" / "downloads" / "_snapshots"

# Names our sources use that the zoneinfo table spells differently. Every entry here
# was produced by the coverage check at the bottom of this file — none are guesses.
ALIASES = {
    "united kingdom": "GB",
    "united states of america": "US",
    "brunei darussalam": "BN",
    "cabo verde": "CV",
    "czechia": "CZ",
    "sao tome and principe": "ST",
    "timor leste": "TL",
    "trinidad and tobago": "TT",
    "bosnia and herzegovina": "BA",
    "central african republic": "CF",
    "democratic republic of the congo": "CD",
    # Kosovo has no official ISO 3166-1 entry; XK is the user-assigned code the EU,
    # IMF and SWIFT all use, so it is what a downstream join will expect.
    "kosovo": "XK",
}


def build() -> dict[str, str]:
    table: dict[str, str] = {}
    for line in TAB.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        code, name = line.split("\t", 1)
        table[vf.norm(name)] = code
        # Index the parenthetical forms too: "Congo (Dem. Rep.)" should also answer to
        # "congo" and to both orderings of the qualifier.
        base = re.sub(r"\s*\(.*?\)", "", name).strip()
        table.setdefault(vf.norm(base), code)
        for inner in re.findall(r"\((.*?)\)", name):
            table.setdefault(vf.norm(f"{inner} {base}"), code)
            table.setdefault(vf.norm(f"{base} {inner}"), code)
    # The offshore fetcher resolves its own ISO codes; trust them over any guess.
    off = SNAPSHOTS / "eu-offshore-centres.json"
    if off.exists():
        for r in json.loads(off.read_text()):
            if r.get("iso2"):
                table.setdefault(vf.norm(r["jurisdiction"]), r["iso2"])
    table.update(ALIASES)
    return dict(sorted(table.items()))


def coverage(table: dict[str, str]) -> list[tuple[str, str]]:
    missing = []
    for sid, field in (("ti-cpi", "country"), ("fatf-jurisdictions", "country"),
                       ("eu-offshore-centres", "jurisdiction")):
        p = SNAPSHOTS / f"{sid}.json"
        if not p.exists():
            continue
        for r in json.loads(p.read_text()):
            if vf.norm(r[field]) not in table:
                missing.append((sid, r[field]))
    return missing


if __name__ == "__main__":
    table = build()
    missing = coverage(table)
    SEED.write_text(json.dumps(table, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {SEED.relative_to(Path(__file__).resolve().parents[2])} — {len(table)} 条")
    if missing:
        print(f"::warning::{len(missing)} 个名称仍无 ISO 代码：")
        for sid, name in missing:
            print(f"  {sid}: {name}")
        sys.exit(1)
    print("三个快照的国家/地区全部匹配到 ISO 代码")
