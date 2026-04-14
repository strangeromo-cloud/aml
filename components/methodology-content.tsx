"use client";

import type { DataSource, DimensionScore } from "@/lib/types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardBody, CardHeader, CardTitle } from "./ui";

// Static factor catalog for docs — mirrors each scoring file.
const FACTOR_CATALOG: Record<
  keyof typeof DIMENSION_NAMES,
  { en: string; zh: string; weight: number; sourceIds: string[] }[]
> = {
  sanctions: [
    { en: "Direct Sanctions Hit (HQ listed on OFAC/UN/EU/FATF blacklist)", zh: "直接命中 (HQ 在 OFAC/UN/EU/FATF 黑名单)", weight: 0.6, sourceIds: ["ofac_sdn", "un_consolidated", "eu_consolidated", "fatf_lists"] },
    { en: "UBO Sanctions Exposure", zh: "UBO 制裁暴露", weight: 0.3, sourceIds: ["ofac_sdn", "open_sanctions"] },
    { en: "Fuzzy Watchlist Similarity", zh: "模糊名单相似度", weight: 0.1, sourceIds: ["open_sanctions", "ofac_sdn"] },
  ],
  countryRisk: [
    { en: "HQ FATF Status", zh: "总部 FATF 状态", weight: 0.4, sourceIds: ["fatf_lists"] },
    { en: "Basel AML Index of HQ", zh: "总部 Basel AML Index", weight: 0.3, sourceIds: ["basel_aml"] },
    { en: "HQ CPI (inverse)", zh: "总部 CPI (反向)", weight: 0.3, sourceIds: ["ti_cpi"] },
  ],
  jurisdiction: [
    { en: "High-Risk Operating Footprint", zh: "高风险运营足迹", weight: 0.4, sourceIds: ["fatf_lists", "ofac_countries"] },
    { en: "Subsidiaries in Sanctioned Jurisdictions", zh: "受制裁辖区子公司", weight: 0.4, sourceIds: ["ofac_countries", "fatf_lists"] },
    { en: "Recent High-Risk Expansion", zh: "近期高风险扩张", weight: 0.2, sourceIds: ["control_risks_geo"] },
  ],
  circumvention: [
    { en: "Transit Hub + Sanctioned Co-occurrence", zh: "中转枢纽 + 制裁地并存", weight: 0.5, sourceIds: ["control_risks_geo", "open_sanctions"] },
    { en: "Sanctioned-Neighbor Exposure", zh: "制裁国周边暴露", weight: 0.3, sourceIds: ["control_risks_geo"] },
    { en: "Opaque Ownership Chain", zh: "不透明所有权链", weight: 0.2, sourceIds: ["tjn_fsi", "open_sanctions"] },
  ],
  pepMedia: [
    { en: "UBO PEP Status", zh: "UBO PEP 状态", weight: 0.5, sourceIds: ["open_sanctions"] },
    { en: "Adverse Media Count", zh: "负面媒体数量", weight: 0.3, sourceIds: ["open_sanctions"] },
    { en: "Regulatory Enforcement History", zh: "监管处罚历史", weight: 0.2, sourceIds: ["ofac_sdn", "open_sanctions"] },
  ],
  enrichment: [
    { en: "WGI Control of Corruption", zh: "WGI 腐败控制", weight: 0.5, sourceIds: ["wb_wgi"] },
    { en: "Rule of Law Environment", zh: "法治环境", weight: 0.3, sourceIds: ["wjp_rol", "wb_wgi"] },
    { en: "Financial Secrecy", zh: "金融保密度", weight: 0.2, sourceIds: ["tjn_fsi"] },
  ],
};

export function MethodologyContent({ sources }: { sources: Record<string, DataSource> }) {
  const { t, tl, locale } = useI18n();
  const dims = Object.keys(DIMENSION_NAMES) as (keyof typeof DIMENSION_NAMES)[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("methodology.title")}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("methodology.sub")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("methodology.weightTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex w-full overflow-hidden rounded-md">
            {dims.map((d) => {
              const w = DIMENSION_WEIGHTS[d];
              const pct = w * 100;
              const palette: Record<string, string> = {
                sanctions: "bg-rose-500",
                countryRisk: "bg-orange-500",
                jurisdiction: "bg-amber-500",
                circumvention: "bg-violet-500",
                pepMedia: "bg-sky-500",
                enrichment: "bg-emerald-500",
              };
              return (
                <div
                  key={d}
                  className={`${palette[d]} flex h-9 items-center justify-center text-xs font-medium text-white`}
                  style={{ width: `${pct}%` }}
                  title={`${tl(DIMENSION_NAMES[d])} · ${pct.toFixed(0)}%`}
                >
                  {pct.toFixed(0)}%
                </div>
              );
            })}
          </div>
          <ul className="mt-4 grid gap-2 text-sm md:grid-cols-2">
            {dims.map((d) => (
              <li key={d} className="flex items-center justify-between rounded-md border px-3 py-2">
                <span>{tl(DIMENSION_NAMES[d])}</span>
                <span className="font-mono tabular-nums">{(DIMENSION_WEIGHTS[d] * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
            {locale === "en"
              ? "Composite score = Σ (dimension score × weight) ÷ Σ weights. All dimension scores and factor scores are on 0–100."
              : "综合评分 = Σ (维度得分 × 权重) ÷ Σ 权重。所有维度与因子得分均为 0–100。"}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("methodology.levelsTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="grid gap-2 text-sm md:grid-cols-4">
            <LevelCard color="bg-emerald-500" title={t("risk.low")} range="0 – 24" />
            <LevelCard color="bg-amber-500" title={t("risk.medium")} range="25 – 49" />
            <LevelCard color="bg-orange-500" title={t("risk.high")} range="50 – 69" />
            <LevelCard color="bg-rose-500" title={t("risk.critical")} range="70 – 100" />
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("methodology.factorTitle")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-6">
          {dims.map((d) => (
            <div key={d}>
              <div className="mb-2 flex items-baseline gap-3">
                <h3 className="font-semibold">{tl(DIMENSION_NAMES[d])}</h3>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {(DIMENSION_WEIGHTS[d] * 100).toFixed(0)}%
                </span>
              </div>
              <ul className="space-y-2 text-sm">
                {FACTOR_CATALOG[d].map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                    <span className="flex-1">{locale === "zh" ? f.zh : f.en}</span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {(f.weight * 100).toFixed(0)}%
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {f.sourceIds.map((sid) => {
                        const s = sources[sid];
                        if (!s) return null;
                        return (
                          <a
                            key={sid}
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-[hsl(var(--muted))]"
                          >
                            {s.authority}
                          </a>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function LevelCard({ color, title, range }: { color: string; title: string; range: string }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className={`${color} h-1.5`} />
      <div className="px-3 py-2">
        <div className="font-medium">{title}</div>
        <div className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{range}</div>
      </div>
    </div>
  );
}
