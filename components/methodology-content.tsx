"use client";

import { DatabaseZap, Layers, Shuffle, FlaskConical } from "lucide-react";
import type { DataSource } from "@/lib/types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "./ui";

// "real"   = computed from real public-source country snapshot (data/countries.json)
// "hybrid" = real reference data combined with synthetic entity data
// "proxy"  = approximated from a different real dataset or hand-curated dictionary
// "mock"   = factor signal is fully synthetic (no real-data backing)
type DataReality = "real" | "hybrid" | "proxy" | "mock";

type FactorMeta = {
  en: string;
  zh: string;
  weight: number;
  sourceIds: string[];
  dataReality: DataReality;
  /** Math expression in language-agnostic form, rendered in monospace */
  formula: string;
  /** Plain-language explanation of the formula */
  meaning: { en: string; zh: string };
  /** A concrete worked example */
  example: { en: string; zh: string };
};

// Static factor catalog for docs — mirrors each scoring file exactly.
const FACTOR_CATALOG: Record<keyof typeof DIMENSION_NAMES, FactorMeta[]> = {
  sanctions: [
    {
      en: "Direct Sanctions Hit (HQ listed on OFAC/UN/EU/FATF blacklist)",
      zh: "直接命中 (HQ 在 OFAC/UN/EU/FATF 黑名单)",
      weight: 0.6,
      sourceIds: ["ofac_sdn", "un_consolidated", "eu_consolidated", "fatf_lists"],
      dataReality: "real",
      formula: "Comprehensive → 100   ·   Sectoral → 75   ·   None → 0",
      meaning: {
        en: "Three-way mapping based on the HQ jurisdiction's sanctions status across OFAC, UN, EU, FATF. \"Comprehensive\" = OFAC full embargo OR FATF blacklist OR UN OR EU sanction.",
        zh: "基于 HQ 司法辖区在 OFAC/UN/EU/FATF 上的状态做三档映射。\"Comprehensive\" = OFAC 全面禁运 或 FATF 黑名单 或 UN 制裁 或 EU 制裁。",
      },
      example: {
        en: "HQ in Iran (FATF blacklist + OFAC + UN + EU)  →  100",
        zh: "HQ 在伊朗（FATF 黑名单 + OFAC + UN + EU） → 100",
      },
    },
    {
      en: "UBO Sanctions Exposure",
      zh: "UBO 制裁暴露",
      weight: 0.3,
      sourceIds: ["ofac_sdn", "open_sanctions"],
      dataReality: "hybrid",
      formula: "min(100,  60 × n)",
      meaning: {
        en: "Each Ultimate Beneficial Owner residing in a comprehensively-sanctioned or FATF-blacklist jurisdiction adds 60 points; capped at 100.",
        zh: "每位居住在全面制裁或 FATF 黑名单辖区的 UBO 加 60 分；上限 100。",
      },
      example: {
        en: "2 sanctioned-jurisdiction UBOs  →  min(100, 120) = 100",
        zh: "2 位 UBO 在受制裁辖区 → min(100, 120) = 100",
      },
    },
    {
      en: "Fuzzy Watchlist Similarity",
      zh: "模糊名单相似度",
      weight: 0.1,
      sourceIds: ["open_sanctions", "ofac_sdn"],
      dataReality: "mock",
      formula: "similarity_pct  (0 – 100)",
      meaning: {
        en: "Best name-similarity score (Jaro-Winkler / Levenshtein) against aggregated watchlists, used directly as a 0–100 score. An investigative trigger, not a definitive hit.",
        zh: "对综合制裁名单的最高名称相似度（Jaro-Winkler / Levenshtein），直接作为 0-100 分。调查触发器，不构成定论。",
      },
      example: {
        en: "Name 87 % similar to a SDN entry  →  87",
        zh: "名称与某 SDN 条目相似度 87% → 87",
      },
    },
  ],
  countryRisk: [
    {
      en: "HQ FATF Status",
      zh: "总部 FATF 状态",
      weight: 0.4,
      sourceIds: ["fatf_lists"],
      dataReality: "real",
      formula: "Blacklist → 100   ·   Greylist → 65   ·   Compliant → 10",
      meaning: {
        en: "Direct lookup of HQ country in FATF's most recent public statement (3× per year).",
        zh: "在 FATF 最新公开声明中直接查找 HQ 国家（每年 3 次更新）。",
      },
      example: {
        en: "HQ in Vietnam (greylist)  →  65",
        zh: "HQ 在越南（灰名单） → 65",
      },
    },
    {
      en: "Basel AML Index of HQ",
      zh: "总部 Basel AML Index",
      weight: 0.3,
      sourceIds: ["basel_aml"],
      dataReality: "real",
      formula: "Basel × 10   (clamped to 0 – 100)",
      meaning: {
        en: "Linear mapping of Basel Institute's annual ML/TF risk index (0–10 scale) onto our 0–100 risk scale.",
        zh: "线性映射:巴塞尔治理研究所年度洗钱/恐怖融资风险指数（0-10）到 0-100 分制。",
      },
      example: {
        en: "Pakistan, Basel = 6.28  →  62.8",
        zh: "巴基斯坦 Basel = 6.28 → 62.8",
      },
    },
    {
      en: "HQ CPI (inverse)",
      zh: "总部 CPI (反向)",
      weight: 0.3,
      sourceIds: ["ti_cpi"],
      dataReality: "real",
      formula: "100 − CPI",
      meaning: {
        en: "Transparency International CPI runs 0 (corrupt) to 100 (clean) — the opposite direction to our risk score, so we invert.",
        zh: "透明国际清廉指数: 0(腐败) – 100(清廉),方向与风险分相反,所以做反向映射。",
      },
      example: {
        en: "Russia, CPI = 22  →  100 − 22 = 78",
        zh: "俄罗斯 CPI = 22 → 100 − 22 = 78",
      },
    },
  ],
  jurisdiction: [
    {
      en: "High-Risk Operating Footprint",
      zh: "高风险运营足迹",
      weight: 0.4,
      sourceIds: ["fatf_lists", "ofac_countries"],
      dataReality: "hybrid",
      formula: "(n_high_risk  /  n_total)  ×  100",
      meaning: {
        en: "Share of the entity's operating jurisdictions that are FATF black/grey-listed or OFAC-sanctioned.",
        zh: "实体运营辖区中被 FATF 黑/灰名单 或 OFAC 制裁的占比。",
      },
      example: {
        en: "Operates in 5 countries, 2 are high-risk  →  (2 / 5) × 100 = 40",
        zh: "在 5 个国家运营,2 个高风险 → (2 / 5) × 100 = 40",
      },
    },
    {
      en: "Subsidiaries in Sanctioned Jurisdictions",
      zh: "受制裁辖区子公司",
      weight: 0.4,
      sourceIds: ["ofac_countries", "fatf_lists"],
      dataReality: "hybrid",
      formula: "n = 0  →  0  ;  n ≥ 1  →  min(100,  40 + 25 × n)",
      meaning: {
        en: "Any subsidiary in OFAC-comprehensive or FATF-blacklist jurisdiction triggers a 40-point base; each additional adds 25, capped at 100.",
        zh: "在 OFAC 全面制裁 或 FATF 黑名单辖区有任一子公司,基础 40 分;每多一个 +25,上限 100。",
      },
      example: {
        en: "1 subsidiary in Iran  →  40 + 25 × 1 = 65   ·   3 subs  →  min(100, 115) = 100",
        zh: "1 个子公司在伊朗 → 40 + 25 × 1 = 65   ·   3 个 → min(100, 115) = 100",
      },
    },
    {
      en: "Recent High-Risk Expansion",
      zh: "近期高风险扩张",
      weight: 0.2,
      sourceIds: ["control_risks_geo"],
      dataReality: "mock",
      formula: "flag = true  →  85  ;  false  →  0",
      meaning: {
        en: "Boolean flag: did the entity start operating in a FATF-listed or OFAC-sanctioned jurisdiction in the last 6 months? Captures dynamic monitoring vs static onboarding.",
        zh: "布尔标志:实体过去 6 个月是否新进入 FATF 名单或 OFAC 制裁辖区?用于动态监控（区别于一次性准入筛查）。",
      },
      example: {
        en: "Newly opened a Türkiye office last quarter  →  85",
        zh: "上季度刚在土耳其设办公室 → 85",
      },
    },
  ],
  circumvention: [
    {
      en: "Transit Hub + Sanctioned Co-occurrence",
      zh: "中转枢纽 + 制裁地并存",
      weight: 0.5,
      sourceIds: ["control_risks_geo", "open_sanctions"],
      dataReality: "hybrid",
      formula: "both → 85   ·   one → 35   ·   neither → 0",
      meaning: {
        en: "Transit hubs hardcoded as AE / TR / HK / SG / MC / CY / VG / KY / LU / CH (per FinCEN advisories). Score depends on whether the entity simultaneously touches a hub AND a sanctioned country.",
        zh: "中转枢纽硬编码为 AE / TR / HK / SG / MC / CY / VG / KY / LU / CH（按 FinCEN 公告）。分数取决于实体是否同时触碰枢纽 + 受制裁国。",
      },
      example: {
        en: "Operates in UAE + Iran  →  85   ·   only UAE  →  35",
        zh: "同时在阿联酋和伊朗运营 → 85   ·   只在阿联酋 → 35",
      },
    },
    {
      en: "Sanctioned-Neighbor Exposure",
      zh: "制裁国周边暴露",
      weight: 0.3,
      sourceIds: ["control_risks_geo"],
      dataReality: "hybrid",
      formula: "n = 0  →  0  ;  n ≥ 1  →  min(100,  25 + 20 × n)",
      meaning: {
        en: "Operating presence in a country bordering a comprehensively-sanctioned one (AM/AZ/KZ/UZ/TJ/TM/GE/IQ/AF/CN/KR/RU/LB/JO). Base 25 + 20 per neighbor, capped 100.",
        zh: "在与全面制裁国接壤的国家运营（AM/AZ/KZ/UZ/TJ/TM/GE/IQ/AF/CN/KR/RU/LB/JO）。基础 25 + 每多一个 +20，上限 100。",
      },
      example: {
        en: "Active in Kazakhstan + Armenia (2 RU/IR neighbors)  →  25 + 20 × 2 = 65",
        zh: "在哈萨克斯坦 + 亚美尼亚活跃（2 个俄/伊朗邻国）→ 25 + 20 × 2 = 65",
      },
    },
    {
      en: "Opaque Ownership Chain",
      zh: "不透明所有权链",
      weight: 0.2,
      sourceIds: ["tjn_fsi", "open_sanctions"],
      dataReality: "hybrid",
      formula: "min(100,  15 × n_subs_in_secrecy + 25 × n_ubos_in_secrecy)",
      meaning: {
        en: "Counts subsidiaries and UBOs domiciled in financial-secrecy hubs. UBOs weighted higher because they hide control more than subsidiaries hide capital.",
        zh: "统计位于金融保密枢纽的子公司和 UBO 数量。UBO 权重更高 —— 隐藏控制权比隐藏资本更具规避意图。",
      },
      example: {
        en: "2 subs + 1 UBO in BVI/KY  →  15 × 2 + 25 × 1 = 55",
        zh: "BVI/开曼 2 个子公司 + 1 位 UBO → 15 × 2 + 25 × 1 = 55",
      },
    },
  ],
  pepMedia: [
    {
      en: "UBO PEP Status",
      zh: "UBO PEP 状态",
      weight: 0.5,
      sourceIds: ["open_sanctions"],
      dataReality: "mock",
      formula: "n = 0  →  0  ;  n ≥ 1  →  min(100,  45 + 25 × (n − 1))",
      meaning: {
        en: "Number of UBOs flagged as Politically Exposed Persons. First PEP triggers a 45-point base; each additional adds 25, capped 100.",
        zh: "受益人中政治敏感人物（PEP）数量。首位 PEP 触发 45 分基础;每多一位 +25,上限 100。",
      },
      example: {
        en: "1 PEP UBO  →  45   ·   3 PEP UBOs  →  45 + 25 × 2 = 95",
        zh: "1 位 PEP → 45   ·   3 位 PEP → 45 + 25 × 2 = 95",
      },
    },
    {
      en: "Adverse Media Count",
      zh: "负面媒体数量",
      weight: 0.3,
      sourceIds: ["open_sanctions"],
      dataReality: "mock",
      formula: "min(100,  8 × n)",
      meaning: {
        en: "Articles in the last 24 months mentioning the entity in connection with AML/fraud/sanctions/corruption keywords. Each article adds 8 points.",
        zh: "过去 24 个月内涉及反洗钱/欺诈/制裁/腐败关键词的负面新闻数量。每篇文章 +8 分。",
      },
      example: {
        en: "5 negative articles  →  40   ·   13+ articles  →  100 (capped)",
        zh: "5 篇负面 → 40   ·   13 篇及以上 → 100（封顶）",
      },
    },
    {
      en: "Regulatory Enforcement History",
      zh: "监管处罚历史",
      weight: 0.2,
      sourceIds: ["ofac_sdn", "open_sanctions"],
      dataReality: "mock",
      formula: "n = 0  →  0  ;  n ≥ 1  →  min(100,  55 + 25 × (n − 1))",
      meaning: {
        en: "Past OFAC / FinCEN / EU / national-regulator enforcement actions. First action triggers a 55-point base; each additional adds 25, capped 100.",
        zh: "过去受 OFAC / FinCEN / 欧盟 / 本国监管机构的处罚记录。首次处罚触发 55 分基础;每多一次 +25,上限 100。",
      },
      example: {
        en: "1 prior OFAC settlement  →  55   ·   3 actions  →  55 + 50 = 100 (capped)",
        zh: "1 次 OFAC 和解 → 55   ·   3 次 → 55 + 50 = 100（封顶）",
      },
    },
  ],
  enrichment: [
    {
      en: "WGI Control of Corruption",
      zh: "WGI 腐败控制",
      weight: 0.5,
      sourceIds: ["wb_wgi"],
      dataReality: "real",
      formula: "((2.5 − wgi)  /  5)  ×  100",
      meaning: {
        en: "World Bank WGI Control of Corruption indicator (range −2.5 to 2.5, higher = better governance) standardized to a 0–100 risk score.",
        zh: "世界银行 WGI 腐败控制指标（范围 −2.5 到 2.5，越高治理越强）标准化到 0-100 分。",
      },
      example: {
        en: "Denmark, WGI = 2.31  →  ((2.5 − 2.31) / 5) × 100 = 3.8     China, WGI = −0.27  →  55.4",
        zh: "丹麦 WGI = 2.31 → 3.8   ·   中国 WGI = −0.27 → 55.4",
      },
    },
    {
      en: "Rule of Law Environment",
      zh: "法治环境",
      weight: 0.3,
      sourceIds: ["wjp_rol", "wb_wgi"],
      dataReality: "proxy",
      formula: "((2.5 − wgi)  /  5)  ×  100   (WGI as proxy for WJP)",
      meaning: {
        en: "Cited as WJP Rule-of-Law Index, but currently approximated using WGI Control of Corruption as a proxy. The two indicators are highly correlated; precise WJP CSV not yet bundled.",
        zh: "引用 WJP 法治指数,但当前用 WGI 腐败控制作为代理近似（两者高度相关；WJP CSV 暂未打包）。",
      },
      example: {
        en: "Same as WGI factor above (until WJP data is loaded)",
        zh: "与上方 WGI 因子取值相同（直到 WJP 数据接入为止）",
      },
    },
    {
      en: "Financial Secrecy",
      zh: "金融保密度",
      weight: 0.2,
      sourceIds: ["tjn_fsi"],
      dataReality: "proxy",
      formula: "secrecy_score  (lookup, 0 – 100, default 50)",
      meaning: {
        en: "Tax Justice Network Financial Secrecy Index, currently approximated as a hand-curated dictionary of ~20 hubs (UAE 78, MC 70, SG 70, CH 65, HK 62, FI 28, …). Higher = more secrecy.",
        zh: "Tax Justice Network 金融保密指数,当前用手工字典近似约 20 个枢纽（UAE 78、MC 70、SG 70、CH 65、HK 62、FI 28…）。越高越保密。",
      },
      example: {
        en: "HQ in UAE  →  78   ·   HQ in Finland  →  28",
        zh: "HQ 在阿联酋 → 78   ·   HQ 在芬兰 → 28",
      },
    },
  ],
};

const REALITY_META: Record<
  DataReality,
  {
    Icon: typeof DatabaseZap;
    label: { en: string; zh: string };
    tip: { en: string; zh: string };
    cls: string;
    dotCls: string;
  }
> = {
  real: {
    Icon: DatabaseZap,
    label: { en: "Real snapshot", zh: "真实数据快照" },
    tip: {
      en: "Driven by real public data hand-curated into data/countries.json (FATF / OFAC / Basel / CPI / WGI snapshots).",
      zh: "由 data/countries.json 中手工录入的真实公开数据驱动（FATF / OFAC / Basel / CPI / WGI 快照）。",
    },
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    dotCls: "bg-emerald-500",
  },
  hybrid: {
    Icon: Layers,
    label: { en: "Hybrid", zh: "混合" },
    tip: {
      en: "Real reference data (country classifications or hardcoded regulator-cited lists) combined with synthetic entity data.",
      zh: "真实参考数据（国家分类或监管引用的硬编码清单）与合成实体数据的组合。",
    },
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    dotCls: "bg-amber-500",
  },
  proxy: {
    Icon: Shuffle,
    label: { en: "Proxy", zh: "代理近似" },
    tip: {
      en: "Approximated from a different real dataset (e.g., WGI used as a proxy for WJP) or a hand-curated dictionary (FSI hubs), because the precise source dataset is not bundled.",
      zh: "用另一个真实数据集近似替代（如用 WGI 代 WJP 法治），或用手工字典近似（如 FSI 保密枢纽）——精确源数据集未打包。",
    },
    cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
    dotCls: "bg-violet-500",
  },
  mock: {
    Icon: FlaskConical,
    label: { en: "Mock", zh: "完全模拟" },
    tip: {
      en: "Signal is fully synthetic — generated by scripts/generate-companies.ts with seeded PRNG, calibrated by company risk band.",
      zh: "信号完全模拟——由 scripts/generate-companies.ts 用种子 PRNG 生成，按公司风险等级标定。",
    },
    cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    dotCls: "bg-rose-500",
  },
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
          <CardTitle>{t("methodology.dataRealityTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(["real", "hybrid", "proxy", "mock"] as const).map((k) => {
              const meta = REALITY_META[k];
              const count = dims.flatMap((d) => FACTOR_CATALOG[d]).filter((f) => f.dataReality === k).length;
              return (
                <div key={k} className={cn("rounded-md border px-3 py-3", meta.cls)}>
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", meta.dotCls)} />
                    <meta.Icon className="h-4 w-4" />
                    <span className="font-semibold">{tl(meta.label)}</span>
                    <span className="ml-auto rounded-md border border-current/30 bg-white/40 px-1.5 py-0.5 text-[11px] font-mono dark:bg-black/20">
                      {count} / 18
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed">{tl(meta.tip)}</p>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("methodology.factorTitle")}</CardTitle>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            {locale === "en"
              ? "Each factor card shows the exact formula, plain-language meaning, and a worked example."
              : "每张因子卡展示精确公式、文字解释和一个实例计算。"}
          </p>
        </CardHeader>
        <CardBody className="space-y-7">
          {dims.map((d) => (
            <div key={d}>
              <div className="mb-3 flex items-baseline gap-3 border-b pb-2">
                <h3 className="font-semibold">{tl(DIMENSION_NAMES[d])}</h3>
                <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                  {locale === "en" ? "weight" : "权重"} {(DIMENSION_WEIGHTS[d] * 100).toFixed(0)}%
                </span>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {FACTOR_CATALOG[d].map((f, i) => {
                  const meta = REALITY_META[f.dataReality];
                  return (
                    <div
                      key={i}
                      className="flex flex-col gap-2 rounded-lg border bg-[hsl(var(--card))] p-4 shadow-sm"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={cn("mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full", meta.dotCls)}
                          title={`${tl(meta.label)} — ${tl(meta.tip)}`}
                          aria-label={tl(meta.label)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold leading-snug">
                            {locale === "zh" ? f.zh : f.en}
                          </div>
                          <div className="mt-0.5 text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                            {locale === "en" ? "factor weight" : "因子权重"} {(f.weight * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>

                      {/* Formula */}
                      <div className="rounded-md bg-[hsl(var(--muted))]/60 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                          {locale === "en" ? "Formula" : "公式"}
                        </div>
                        <div className="mt-0.5 break-words font-mono text-xs">{f.formula}</div>
                      </div>

                      {/* Plain-language meaning */}
                      <p className="text-xs leading-relaxed text-[hsl(var(--foreground))]">
                        {tl(f.meaning)}
                      </p>

                      {/* Worked example */}
                      <div className="rounded-md border-l-2 border-l-amber-500 bg-amber-500/10 px-3 py-1.5 text-[11px]">
                        <span className="font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                          {locale === "en" ? "Example" : "示例"}
                        </span>{" "}
                        <span className="font-mono">{tl(f.example)}</span>
                      </div>

                      {/* Sources */}
                      {f.sourceIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pt-1">
                          <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                            {locale === "en" ? "Sources" : "数据源"}
                          </span>
                          {f.sourceIds.map((sid) => {
                            const s = sources[sid];
                            if (!s) return null;
                            return (
                              <a
                                key={sid}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-md border px-1.5 py-0.5 text-[10px] hover:bg-[hsl(var(--muted))]"
                              >
                                {s.authority}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
