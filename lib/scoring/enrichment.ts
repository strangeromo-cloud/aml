import type { Company, Country, DimensionScore, Factor } from "../types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "../types";

// Rule of Law: prefer the real WJP score (data/countries.json::wjpRoLScore,
// 0..1 where 1 = strong rule of law). If a country is missing from the WJP
// dataset (e.g. some sanctioned jurisdictions), fall back to a WGI-derived
// proxy on the same scale.
function ruleOfLawScore(c: Country | undefined): { score: number; isReal: boolean } {
  if (!c) return { score: 50, isReal: false };
  const real = c.wjpRoLScore;
  if (typeof real === "number") {
    // WJP 0..1 (higher = better) → 0..100 risk (higher = worse)
    return { score: Math.round((1 - real) * 100), isReal: true };
  }
  // Proxy: WGI on -2.5..2.5
  const wgi = c.wgiControlOfCorruption;
  return {
    score: Math.round(Math.max(0, Math.min(100, ((2.5 - wgi) / 5) * 100))),
    isReal: false,
  };
}

// Financial Secrecy: prefer the real TJN secrecy score
// (data/countries.json::tjnSecrecyScore, 0..100 where 100 = most secret).
// Fall back to a hand-curated dictionary for the few countries TJN doesn't
// cover (mostly heavily sanctioned states).
function financialSecrecyScore(c: Country | undefined): { score: number; isReal: boolean } {
  if (!c) return { score: 40, isReal: false };
  const real = c.tjnSecrecyScore;
  if (typeof real === "number") {
    return { score: Math.round(real), isReal: true };
  }
  const fallback: Record<string, number> = {
    CH: 65, SG: 70, LU: 65, HK: 62, AE: 78, MC: 70, MY: 58,
    US: 60, GB: 55, IE: 55, NL: 52, DE: 45, FR: 45, CA: 40,
    CN: 60, JP: 42, KR: 40, AU: 38, NZ: 35, SE: 30, NO: 30, DK: 28, FI: 28,
  };
  return { score: fallback[c.code] ?? 50, isReal: false };
}

export function scoreEnrichment(company: Company, countries: Record<string, Country>): DimensionScore {
  const hq = countries[company.hqCountry];

  // Factor 1: WGI Control of Corruption (direct value from data)
  const wgi = hq?.wgiControlOfCorruption ?? 0;
  const wgiScore = Math.max(0, Math.min(100, ((2.5 - wgi) / 5) * 100));
  const wgiFactor: Factor = {
    id: "wgi_control_of_corruption",
    name: { en: "WGI Control of Corruption", zh: "WGI 腐败控制指数" },
    value: wgi,
    displayValue: {
      en: `${wgi.toFixed(2)} on -2.5..2.5 (higher = stronger governance)`,
      zh: `${wgi.toFixed(2)}，取值 -2.5..2.5（越高治理越强）`,
    },
    score: Math.round(wgiScore),
    weightWithinDimension: 0.5,
    rationale: {
      en: "World Bank WGI Control of Corruption standardized to a 0-100 risk score. Strong governance lowers risk.",
      zh: "世界银行 WGI 腐败控制指数标准化到 0-100 风险分值。治理越强风险越低。",
    },
    sourceIds: ["wb_wgi"],
  };

  // Factor 2: Rule of Law (real WJP score when available; WGI proxy otherwise)
  const rol = ruleOfLawScore(hq);
  const rolFactor: Factor = {
    id: "rule_of_law_index",
    name: { en: "Rule of Law Environment", zh: "法治环境" },
    value: hq?.wjpRoLScore ?? rol.score,
    displayValue: rol.isReal
      ? {
          en: `WJP score ${(hq!.wjpRoLScore!).toFixed(3)} / 1.000  →  risk ${rol.score}`,
          zh: `WJP 得分 ${(hq!.wjpRoLScore!).toFixed(3)} / 1.000  →  风险分 ${rol.score}`,
        }
      : {
          en: `Proxy ${rol.score} / 100 (WJP not available for this jurisdiction; using WGI)`,
          zh: `代理近似 ${rol.score} / 100（此辖区无 WJP 数据，用 WGI 替代）`,
        },
    score: rol.score,
    weightWithinDimension: 0.3,
    rationale: rol.isReal
      ? {
          en: "WJP Rule of Law Index 2025 — overall score on 0..1 (higher = stronger rule of law) inverted to a 0..100 risk score.",
          zh: "WJP 法治指数 2025 综合得分（0-1，越高法治越强），反向映射为 0-100 风险分值。",
        }
      : {
          en: "WJP doesn't publish a score for this jurisdiction (typically heavily-sanctioned states). Falls back to WGI Control of Corruption mapped onto the same scale.",
          zh: "WJP 未公布该辖区评分（通常是受重制裁国家），回退到 WGI 腐败控制指标按同样比例映射。",
        },
    sourceIds: rol.isReal ? ["wjp_rol"] : ["wjp_rol", "wb_wgi"],
  };

  // Factor 3: Financial Secrecy (real TJN FSI score when available; hand-curated fallback)
  const fsi = financialSecrecyScore(hq);
  const fsiFactor: Factor = {
    id: "financial_transparency",
    name: { en: "Financial Secrecy", zh: "金融保密度" },
    value: hq?.tjnSecrecyScore ?? fsi.score,
    displayValue: fsi.isReal
      ? {
          en: `TJN secrecy score ${fsi.score} / 100 (higher = more opaque)`,
          zh: `TJN 保密评分 ${fsi.score} / 100（越高越不透明）`,
        }
      : {
          en: `Estimate ${fsi.score} / 100 (TJN not available for this jurisdiction)`,
          zh: `估值 ${fsi.score} / 100（此辖区无 TJN 数据）`,
        },
    score: fsi.score,
    weightWithinDimension: 0.2,
    rationale: fsi.isReal
      ? {
          en: "Tax Justice Network Financial Secrecy Index 2022 — secrecy score on 0..100 (higher = more opaque).",
          zh: "Tax Justice Network 金融保密指数 2022 —— 保密评分 0-100（越高越不透明）。",
        }
      : {
          en: "TJN doesn't cover this jurisdiction. Hand-curated estimate aligned with FSI bands of comparable countries.",
          zh: "TJN 未覆盖该辖区，使用与同档国家对齐的人工估值。",
        },
    sourceIds: ["tjn_fsi"],
  };

  const factors = [wgiFactor, rolFactor, fsiFactor];
  const score = factors.reduce((acc, f) => acc + f.score * f.weightWithinDimension, 0);
  return {
    id: "enrichment",
    name: DIMENSION_NAMES.enrichment,
    weight: DIMENSION_WEIGHTS.enrichment,
    score: Math.round(score),
    factors,
  };
}
