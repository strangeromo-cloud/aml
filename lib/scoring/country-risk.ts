import type { Company, Country, DimensionScore, Factor } from "../types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "../types";

export function scoreCountryRisk(company: Company, countries: Record<string, Country>): DimensionScore {
  const hq = countries[company.hqCountry];

  // Factor 1: FATF status of HQ
  const fatfScore = hq?.fatfStatus === "blacklist" ? 100 : hq?.fatfStatus === "greylist" ? 65 : 10;
  const fatfFactor: Factor = {
    id: "hq_fatf_status",
    name: { en: "HQ FATF Status", zh: "总部 FATF 状态" },
    value: hq?.fatfStatus ?? "unknown",
    displayValue: {
      en: hq?.fatfStatus === "blacklist" ? "Blacklist — call for action"
        : hq?.fatfStatus === "greylist" ? "Greylist — under increased monitoring"
        : "Compliant",
      zh: hq?.fatfStatus === "blacklist" ? "黑名单 — 行动呼吁"
        : hq?.fatfStatus === "greylist" ? "灰名单 — 加强监控"
        : "合规",
    },
    score: fatfScore,
    weightWithinDimension: 0.4,
    rationale: {
      en: "Blacklist → 100; Greylist → 65; Compliant → 10. Drawn from the FATF Feb-2026 public statement snapshot.",
      zh: "黑名单 → 100；灰名单 → 65；合规 → 10。来源：FATF 2026 年 2 月公开声明快照。",
    },
    sourceIds: ["fatf_lists"],
  };

  // Factor 2: Basel AML Index (0-10) → 0-100
  const baselScore = Math.max(0, Math.min(100, (hq?.baselAmlIndex ?? 5) * 10));
  const baselFactor: Factor = {
    id: "hq_basel_aml_index",
    name: { en: "Basel AML Index", zh: "巴塞尔反洗钱指数" },
    value: hq?.baselAmlIndex ?? 0,
    displayValue: {
      en: `${hq?.baselAmlIndex?.toFixed(2) ?? "n/a"} / 10 (higher = higher ML/TF risk)`,
      zh: `${hq?.baselAmlIndex?.toFixed(2) ?? "n/a"} / 10（越高洗钱/恐怖融资风险越大）`,
    },
    score: baselScore,
    weightWithinDimension: 0.3,
    rationale: {
      en: "Linear mapping Basel AML Index × 10. Derived from the 2024 Basel Institute public report.",
      zh: "线性映射：Basel AML Index × 10。来自 2024 年巴塞尔治理研究所公开报告。",
    },
    sourceIds: ["basel_aml"],
  };

  // Factor 3: CPI — lower CPI means more corruption risk
  const cpiScore = Math.max(0, Math.min(100, 100 - (hq?.cpi ?? 50)));
  const cpiFactor: Factor = {
    id: "hq_cpi",
    name: { en: "Corruption Perceptions Index", zh: "清廉指数" },
    value: hq?.cpi ?? 0,
    displayValue: {
      en: `CPI ${hq?.cpi ?? "n/a"} / 100 (higher = cleaner)`,
      zh: `CPI ${hq?.cpi ?? "n/a"} / 100（越高越清廉）`,
    },
    score: cpiScore,
    weightWithinDimension: 0.3,
    rationale: {
      en: "Inverse CPI: 100 − CPI. Lower perceived public-sector integrity raises country risk weighting.",
      zh: "CPI 反向映射：100 − CPI。公共部门清廉度越低，国家风险权重越高。",
    },
    sourceIds: ["ti_cpi"],
  };

  const factors = [fatfFactor, baselFactor, cpiFactor];
  const score = factors.reduce((acc, f) => acc + f.score * f.weightWithinDimension, 0);
  return {
    id: "countryRisk",
    name: DIMENSION_NAMES.countryRisk,
    weight: DIMENSION_WEIGHTS.countryRisk,
    score: Math.round(score),
    factors,
  };
}
