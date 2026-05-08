# Data refresh — list-source fetchers

This subsystem handles every public AML data source that has **no usable API**
(or whose API requires a paid subscription). For each, we download or scrape
the upstream artifact and emit a clean `.xlsx` snapshot to `data/downloads/`.

The orchestrator runs every fetcher in turn, captures status to
`data/downloads/_manifest.json`, and is wired up to a daily GitHub Actions
workflow at `.github/workflows/refresh-data.yml` that:

1. Runs all 8 fetchers
2. Commits any changed `.xlsx` files back to `main`
3. **Opens a GitHub issue tagged `data-refresh-failure`** if any fetcher fails

## Sources covered (8)

### Daily auto-run (5)

| ID | Name | Mode | Records (last run) |
|---|---|---|---|
| `fatf-jurisdictions` | FATF High-Risk & Monitored Jurisdictions | Wayback Machine + CDX freshness check | ~25–35 |
| `ofac-country-programs` | OFAC Sanctions Programs by Country | HTML scrape | ~40 |
| `un-consolidated` | UN Security Council Consolidated List | XML parse | ~1000 |
| `eu-consolidated` | EU Consolidated Financial Sanctions | XML parse (token-gated) | ~6000 |
| `ti-cpi` | Transparency International CPI | Annual `.xlsx` (Strict OOXML, parsed via raw XML) | ~180 |

### Skipped — `requires_headless` (3)

These pages are React/Nuxt SPAs whose data only materializes in a real browser
runtime. They're skipped by the daily run to avoid noisy alerts.

| ID | Name | Why skipped | Manual workaround |
|---|---|---|---|
| `basel-aml-index` | Basel AML Index | Nuxt + Directus; per-country scores require auth | Email-register for the annual PDF and manually update the spec |
| `wjp-rule-of-law` | WJP Rule of Law Index | Initial HTML is ~5KB stub | Download the annual PDF from worldjusticeproject.org |
| `tjn-fsi` | Tax Justice Network FSI | Ranking table renders from late-loaded JSON blob | Use the Excel "FSI Database" download from fsi.taxjustice.net/database |

To run them anyway (e.g. once a quarter via Playwright):

```bash
python -m scripts.data-refresh.refresh_all --include-headless
```

> Sources **not** listed above (OFAC SDN, World Bank WGI, OpenSanctions, the
> commercial vendors) are accessed via their APIs at runtime — no daily
> download needed.

## Wayback freshness guard

FATF's official site is Cloudflare-protected, so we route through the Wayback
Machine. **Wayback can lag the live site by days or weeks.** The fetcher uses
the Wayback CDX API to get the actual capture timestamp and **fails the run
if the snapshot is older than 45 days** (FATF publishes 3× per year, so
45 days is well within the publication cycle). This converts "silent staleness"
into a loud, actionable alert.

## Layout

```
scripts/data-refresh/
├── README.md
├── requirements.txt          # openpyxl, beautifulsoup4, lxml
├── common.py                 # http_get, write_excel, Fetcher base class
├── refresh_all.py            # orchestrator entrypoint
└── fetchers/
    ├── __init__.py           # registers ALL_FETCHERS
    ├── fatf.py
    ├── ofac_countries.py
    ├── un_consolidated.py
    ├── eu_consolidated.py
    ├── basel_aml.py
    ├── ti_cpi.py
    ├── wjp_rol.py
    └── tjn_fsi.py

data/downloads/               # outputs (committed daily by the workflow)
├── _manifest.json
├── fatf-jurisdictions.xlsx
├── ofac-country-programs.xlsx
├── ...
```

## Running locally

```bash
pip install -r scripts/data-refresh/requirements.txt

# Run everything
python -m scripts.data-refresh.refresh_all

# Run only a subset (one or more --only)
python -m scripts.data-refresh.refresh_all --only fatf-jurisdictions --only un-consolidated

# Make any failure exit non-zero (used in CI)
python -m scripts.data-refresh.refresh_all --strict
```

Every run rewrites `data/downloads/_manifest.json` with per-source status,
record count, and timestamps.

## Adding a new fetcher

1. Create `fetchers/<name>.py` with a class that inherits `common.Fetcher`,
   sets `id`, `name`, `url`, `out_filename`, and implements `fetch()` +
   `columns()`.
2. Register it in `fetchers/__init__.py`.
3. The orchestrator + workflow pick it up automatically.

## When a fetcher breaks

Daily failures open a GitHub issue with label `data-refresh-failure`. The
issue body includes the failing source IDs and a link to the workflow run with
the full stack trace.

The most common breakage is **upstream HTML restructuring** — fix by:

1. Open the workflow run logs to see the exact traceback.
2. Open the source URL in a browser, inspect the new DOM structure.
3. Patch the fetcher's selector / regex.
4. Run locally with `--only <id>` to verify.
5. Commit + push; the next scheduled run picks up the fix.
