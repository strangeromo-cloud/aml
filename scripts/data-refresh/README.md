# Data refresh — list-source fetchers

This subsystem handles every public AML data source that has **no usable API**
(or whose API requires a paid subscription). For each, we download or scrape
the upstream artifact and emit a clean `.xlsx` snapshot to `public/downloads/`.

The orchestrator runs every fetcher in turn, captures status to
`public/downloads/_manifest.json`, and is wired up to a daily GitHub Actions
workflow at `.github/workflows/refresh-data.yml` that:

1. Runs all 8 fetchers
2. Commits any changed `.xlsx` files back to `main`
3. **Opens a GitHub issue tagged `data-refresh-failure`** if any fetcher fails

## Sources covered (8)

| ID | Name | Mode | Headless? | Records (last run) |
|---|---|---|---|---|
| `fatf-jurisdictions` | FATF High-Risk & Monitored Jurisdictions | Headless Chromium → Cloudflare bypass + scrape; Wayback fallback if Playwright fails | ✓ | ~25 |
| `ofac-country-programs` | OFAC Sanctions Programs by Country | HTML scrape | – | ~43 |
| `un-consolidated` | UN Security Council Consolidated List | XML parse | – | ~1009 |
| `eu-consolidated` | EU Consolidated Financial Sanctions | XML parse (token-gated) | – | ~6000 |
| `ti-cpi` | Transparency International CPI | Annual `.xlsx` (Strict OOXML, parsed via raw XML) | – | 180 |
| `wjp-rule-of-law` | WJP Rule of Law Index | Direct CSV (`/data/<year>.csv`) | – | 143 |
| `basel-aml-index` | Basel AML Index | Headless Chromium → table scrape | ✓ | 177 |
| `tjn-fsi` | Tax Justice Network FSI | Headless Chromium → network interception of `api.data.taxjustice.net/v1/query/fsi_jurisdictions` | ✓ | 141 |

The two `requires_headless` fetchers run real Chromium via Playwright. The
daily GitHub Actions run installs Chromium with cache and invokes the
orchestrator with `--include-headless`. Locally they're skipped by default
(so you don't need Playwright installed) — pass `--include-headless` to
run them.

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

public/downloads/               # outputs (committed daily by the workflow)
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

Every run rewrites `public/downloads/_manifest.json` with per-source status,
record count, and timestamps.

## Who gets the daily list email

Resolved in the workflow's "Email watched lists on change" step, most specific first:

| 来源 | 作用范围 | 取值 |
|---|---|---|
| `email_to` 输入 | 仅本次手动运行 | 任意地址，覆盖下面两者 |
| `send_to` 输入 | 仅本次手动运行 | 测试邮箱 / 正式邮箱 / 测试+正式 |
| `LIST_ALERT_MODE` 仓库变量 | **定时任务** | `test`（默认）/ `prod` / `both` |

地址本身也是仓库变量，改地址不用改代码：

- `LIST_ALERT_RECIPIENT_TEST` — 默认 `xujz4@lenovo.com`
- `LIST_ALERT_RECIPIENT_PROD` — 默认 `ecoafm@lenovo.com`

定时运行只看 `LIST_ALERT_MODE`，所以法务签字后把每日邮件切到正式，只需在
Settings → Secrets and variables → Actions → Variables 里把 `LIST_ALERT_MODE`
设成 `prod`，本文件和工作流都不用动。`both` 会同时发两个地址（收件人字段支持逗号分隔）。

`LIST_ALERT_MODE` 填成别的值会让这一步直接失败，而不是悄悄发到某个默认地址。

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
