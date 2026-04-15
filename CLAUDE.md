# CLAUDE.md

This file briefs future Claude sessions working on this repo. Read this before making changes.

## What this is

Lenovo AML Risk Watch — a static Next.js 14 demo that scores 200 synthetic customers/suppliers across 6 AML compliance dimensions and cites the authoritative public source behind every factor.

**Not production**. Company data is synthetic; country data is a real public-source snapshot. Every user-facing surface carries a disclaimer.

## Critical constraints (do not violate)

1. **Real company names must stay Low risk.** The 30 real names (Intel, TSMC, Bank of America, etc. in `scripts/generate-companies.ts`) are legally safe only because they are hardcoded to Low risk. If you touch the generator, preserve: `if (band === "low" && realIdx < reals.length) { realSlot = reals[realIdx++]; }`. Any change that can land a real company in Medium+ is a legal risk.

2. **Disclaimers are non-negotiable.** Footer + detail-page warnings + README section about "illustrative demo" must stay. If you redesign, carry them forward.

3. **Every factor must cite a source.** The whole pitch is "each score is explainable and citable." Any new factor needs `sourceIds: string[]` pointing to `data/sources.json`. Don't invent sources.

4. **Country data is a snapshot.** `data/countries.json` values (FATF status, Basel AML Index, CPI, WGI) are real as of the snapshot dates in `data/sources.json`. Don't fabricate — if you need to add a country, look up real values or mark the field clearly.

## Architecture at a glance

```
app/                    Next.js App Router pages (all server components; hand off to client via prop drilling)
  page.tsx              Home: search + stats + Top 10 + charts
  company/[id]/page.tsx Detail page — uses generateStaticParams for full prerender
  companies/page.tsx    List with filters
  methodology/page.tsx
  sources/page.tsx
  layout.tsx            Wraps everything in I18nProvider + Header + Footer

components/             "use client" components (everything interactive)
  home-content.tsx      Home main (needs client for Recharts)
  company-detail.tsx    Detail main
  companies-list.tsx    List with stateful filters
  dimension-card.tsx    Expandable dimension w/ factors and source badges
  search-bar.tsx        Fuse.js fuzzy search w/ keyboard nav
  risk-gauge.tsx        SVG radial score gauge
  ui.tsx                Card / Badge / RiskBadge / Button / Progress
  header.tsx / footer.tsx
  language-switcher.tsx country-flag.tsx

lib/
  types.ts              Single source of truth for types + DIMENSION_WEIGHTS + levelOf()
  data.ts               Loads JSON, memoizes assessments, exposes query helpers
  utils.ts              cn() only (Tailwind class merge)
  scoring/              One file per dimension — all follow identical shape
    index.ts            Orchestrates 6 dimension functions; returns RiskAssessment
    sanctions.ts        25% weight
    country-risk.ts     20%
    jurisdiction.ts     15%
    circumvention.ts    15%
    pep-media.ts        15%
    enrichment.ts       10%
  i18n/                 en.json + zh.json + Context; NOT next-intl
    context.tsx         useI18n() -> { locale, setLocale, t, tl }

data/
  sources.json          12 authoritative sources (FATF/OFAC/UN/EU/Basel/CPI/WGI/WJP/TJN/OpenSanctions/Control Risks)
  countries.json        55 countries with real snapshot values
  companies.json        200 synthetic companies — generated, committed to repo

scripts/
  generate-companies.ts Seeded PRNG generator (seed = 20260414). Run via `npm run data:gen`.
  sanity-check.ts       Dev-only: prints Top/Bottom risk + distribution
```

## Scoring model — cheat sheet

- **Overall** = Σ (dimension.score × dimension.weight) / Σ weights, on 0–100
- **Dimension** = Σ (factor.score × factor.weightWithinDimension), on 0–100
- **Risk levels**: Low <25, Medium 25–49, High 50–69, Critical ≥70
  - These thresholds in `lib/types.ts::levelOf` are calibrated to the synthetic distribution. If you change scoring math, expect to recalibrate thresholds OR adjust generator signals.

Each dimension file returns a `DimensionScore` with exactly 3 factors. **Adding a 4th factor requires:**
1. Update the scoring file
2. Update `FACTOR_CATALOG` in `components/methodology-content.tsx` (static mirror for the docs page)

## Data flow

1. Server component page imports from `lib/data.ts`
2. `lib/data.ts` reads static JSON, memoizes assessments via `allAssessments()` / `assessmentFor(id)`
3. Server component passes typed data to a `"use client"` component as props
4. Client component renders — no fetch, no API routes, no runtime DB

Everything is statically prerendered at build time (207 pages).

## Commands

```bash
npm run dev           # Next dev server
npm run data:gen      # Regenerate data/companies.json from scripts/generate-companies.ts
npm run build         # Triggers prebuild (data:gen) then next build
npm start             # Production start; respects $PORT
npx tsx scripts/sanity-check.ts   # Print risk distribution + top/bottom
```

## Deploy

Deployed on Zeabur via GitHub (`strangeromo-cloud/aml`, branch `main`). Pushing to `main` triggers auto-rebuild.

- `prebuild` hook runs `tsx scripts/generate-companies.ts` so the deploy always has fresh deterministic data
- `start` uses `next start -p ${PORT:-3000}` to respect Zeabur's injected `$PORT`
- Node ≥ 18.17 declared in `engines`
- `tsx` currently in `devDependencies` — Zeabur installs devDeps during build so this works. If build ever fails with `tsx: not found`, promote it to `dependencies`.

## Adding things — patterns to follow

### Add a new factor to an existing dimension
1. Push into the `factors` array in the matching `lib/scoring/<dim>.ts`
2. Update `FACTOR_CATALOG[<dim>]` in `components/methodology-content.tsx`
3. If the factor needs a new mock signal (e.g. `adverseMediaCount`-style), add it to `Company` in `lib/types.ts` and populate it in `scripts/generate-companies.ts::makeCompany`
4. Re-run `npm run data:gen`

### Add a new country
Append to `data/countries.json` with real FATF/Basel/CPI/WGI values. Add it to the appropriate pool (`CLEAN_HQ` / `EMERGING_HQ` / `RISKY_HQ` / `SANCTIONED_HQ` / `TRANSIT_HUBS` / `SANCTIONED_ADJACENT`) in `scripts/generate-companies.ts` so it gets picked up.

### Add a new data source
Append to `data/sources.json`. Use it in `sourceIds` arrays inside scoring files. Auto-renders on `/sources` page.

### Add a new UI string
Put it in BOTH `lib/i18n/en.json` and `lib/i18n/zh.json` at the same path. Use `t("path.to.key")` from `useI18n()`. For data-side localized strings (e.g. a country name), use the `LocalizedString` type `{ en, zh }` and render with `tl(value)`.

### Add a new page
1. Create `app/<route>/page.tsx` (server component, imports from `lib/data.ts`)
2. Create a matching `"use client"` component in `components/<route>-content.tsx`
3. Add to `components/header.tsx::links` and the `nav` dict in both i18n files

## Things to NOT do

- Don't add `"use client"` to page files in `app/`. Keep pages as server components that pass data to client components.
- Don't introduce `next-intl` or a heavier i18n library — the custom Context is intentional.
- Don't fetch data from external APIs at runtime. The whole app is static for a reason (predictable, cheap, no secrets, no rate limits).
- Don't reproduce lyrics, copyrighted text from FATF/OFAC publications, etc. Quote only short excerpts with citation.
- Don't delete `.claude/launch.json` from `.gitignore` — it's local preview config, not for commit.

## Open improvements worth doing (if asked)

- What-if mode: let users tweak dimension weights and see live recalc
- Sankey diagram of transit/circumvention paths on detail page
- Static export mode (`output: "export"` in next.config.mjs) for CDN-only hosting
- Mobile responsive polish (nav collapses to hamburger below `sm`)
- Unit tests for scoring functions (currently only sanity-check.ts covers them)
