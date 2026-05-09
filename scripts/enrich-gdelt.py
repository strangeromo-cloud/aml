"""Enrich data/companies.json with real GDELT adverse-media counts.

For each of the 200 companies, queries GDELT's free DOC 2.0 API for articles
mentioning the company name with AML-related keywords, in the last 24 months.
The fetched count replaces `adverseMediaCount` (previously a mock value).
The top 3 article titles + URLs are stored in `adverseMediaSamples` so the
detail page can cite real evidence.

Synthetic companies (170 of 200) will return 0 from GDELT — that's the
correct, honest answer (they don't really exist). Their compliance scores
are still driven by sanctions / country risk dimensions.

Run:
  python3 scripts/enrich-gdelt.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
COMPANIES_JSON = REPO_ROOT / "data" / "companies.json"
KEYWORDS = "(laundering OR fraud OR sanctions OR corruption OR bribery OR \"money-laundering\" OR investigation)"
MONTHS = 24
GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc"
USER_AGENT = "Mozilla/5.0 (compatible; aml-risk-watch/1.0)"
THROTTLE_SECONDS = 0.6  # GDELT is generous but kind to ourselves


def fetch_gdelt(name: str) -> tuple[int, list[dict]]:
    """Return (count, [{title, url, source, seendate}, ...])."""
    q = f'"{name}" {KEYWORDS}'
    qs = urllib.parse.urlencode({
        "query": q,
        "mode": "ArtList",
        "format": "json",
        "timespan": f"{MONTHS}m",
        "maxrecords": 100,
        "sort": "DateDesc",
    })
    url = f"{GDELT_BASE}?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as e:
        print(f"    ! GDELT error for {name!r}: {type(e).__name__}: {e}", file=sys.stderr)
        return 0, []
    arts = data.get("articles") or []
    samples = []
    for a in arts[:3]:
        samples.append({
            "title": a.get("title", ""),
            "url": a.get("url", ""),
            "source": a.get("domain", ""),
            "date": a.get("seendate", ""),
        })
    return len(arts), samples


def main() -> int:
    if not COMPANIES_JSON.exists():
        print(f"Missing {COMPANIES_JSON}; run `npm run data:gen` first.", file=sys.stderr)
        return 1

    companies = json.loads(COMPANIES_JSON.read_text())
    print(f"Enriching {len(companies)} companies via GDELT (≈ {len(companies) * THROTTLE_SECONDS / 60:.1f} min)…")

    updated = 0
    real_with_news = 0
    started = datetime.now(timezone.utc)
    for i, c in enumerate(companies, 1):
        name = c.get("name", "").strip()
        if not name:
            continue
        count, samples = fetch_gdelt(name)
        prev = c.get("adverseMediaCount", 0)
        c["adverseMediaCount"] = count
        c["adverseMediaSamples"] = samples
        c["adverseMediaFetchedAt"] = started.isoformat(timespec="seconds")
        c["adverseMediaSource"] = "gdelt-doc-v2"
        if c.get("isReal") and count > 0:
            real_with_news += 1
        updated += 1
        if i % 20 == 0:
            print(f"  {i:3d}/{len(companies)}  last: {name[:30]:32}  {prev:>3} → {count:>3}")
        time.sleep(THROTTLE_SECONDS)

    COMPANIES_JSON.write_text(json.dumps(companies, indent=2, ensure_ascii=False))
    print(f"\nDone in {(datetime.now(timezone.utc) - started).total_seconds():.0f}s.")
    print(f"  Updated:   {updated}")
    print(f"  Real companies with non-zero adverse media: {real_with_news}")
    print(f"  Wrote:     {COMPANIES_JSON.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
