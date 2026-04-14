import type { Company, Country, DimensionScore, Factor } from "../types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "../types";

// Derive proxy scores for Rule-of-Law and Financial-Secrecy from available
// country fields — we don't ship the full WJP / TJN datasets, but we cite them.
function ruleOfLawProxy(c: Country | undefined): number {
  if (!c) return 50;
  // Use WGI as a proxy, same scale
  const wgi = c.wgiControlOfCorruption; // -2.5..2.5
  // Transform: 2.5 → 10 (safe), -2.5 → 100 (risky)
  const score = ((2.5 - wgi) / 5) * 100;
  return Math.max(0, Math.min(100, score));
}
function financialSecrecyProxy(c: Country | undefined): number {
  if (!c) return 40;
  // High secrecy hubs (CH, SG, LU, HK, AE, MC, CY, VG, KY) — approximate with FSI bands
  const hubs: Record<string, number> = {
    CH: 65, SG: 70, LU: 65, HK: 62, AE: 78, MC: 70, MY: 58,
    US: 60, GB: 55, IE: 55, NL: 52, DE: 45, FR: 45, CA: 40,
    CN: 60, JP: 42, KR: 40, AU: 38, NZ: 35, SE: 30, NO: 30, DK: 28, FI: 28,
  };
  return hubs[c.code] ?? 50;
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

  // Factor 2: Rule of Law (proxy, citing WJP)
  const rolScore = ruleOfLawProxy(hq);
  const rolFactor: Factor = {
    id: "rule_of_law_index",
    name: { en: "Rule of Law Environment", zh: "法治环境" },
    value: rolScore,
    displayValue: {
      en: `Composite rule-of-law proxy score: ${Math.round(rolScore)} / 100`,
      zh: `法治综合代理评分：${Math.round(rolScore)} / 100`,
    },
    score: Math.round(rolScore),
    weightWithinDimension: 0.3,
    rationale: {
      en: "WJP Rule of Law dimensions mapped onto WGI; weak enforcement environments increase residual AML risk.",
      zh: "将 WJP 法治指数维度映射到 WGI；执法环境薄弱会增加剩余反洗钱风险。",
    },
    sourceIds: ["wjp_rol", "wb_wgi"],
  };

  // Factor 3: Financial Secrecy Index proxy
  const fsi = financialSecrecyProxy(hq);
  const fsiFactor: Factor = {
    id: "financial_transparency",
    name: { en: "Financial Secrecy", zh: "金融保密度" },
    value: fsi,
    displayValue: {
      en: `Secrecy score ${fsi} / 100 (lower = more transparent)`,
      zh: `保密评分 ${fsi} / 100（越低越透明）`,
    },
    score: Math.round(fsi),
    weightWithinDimension: 0.2,
    rationale: {
      en: "Derived from Tax Justice Network FSI bands. Secrecy hubs (UAE, HK, CH, LU, …) receive a higher weight.",
      zh: "源自 Tax Justice Network 金融保密指数等级。保密枢纽（阿联酋、香港、瑞士、卢森堡等）权重更高。",
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
