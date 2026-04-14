import type { Company, Country, DimensionScore, Factor } from "../types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "../types";

function isHighRisk(c: Country | undefined): boolean {
  if (!c) return false;
  return c.fatfStatus === "blacklist" || c.fatfStatus === "greylist" || c.ofacComprehensive || c.ofacPartial;
}

export function scoreJurisdiction(company: Company, countries: Record<string, Country>): DimensionScore {
  // Factor 1: % of operating countries that are high risk
  const highRiskOps = company.operatingCountries.filter((code) => isHighRisk(countries[code]));
  const pct = company.operatingCountries.length === 0 ? 0 : highRiskOps.length / company.operatingCountries.length;
  const pctScore = Math.round(pct * 100);
  const pctFactor: Factor = {
    id: "operating_in_high_risk_pct",
    name: { en: "High-Risk Operating Footprint", zh: "高风险运营足迹" },
    value: `${highRiskOps.length} / ${company.operatingCountries.length}`,
    displayValue: {
      en: `${highRiskOps.length} of ${company.operatingCountries.length} operating jurisdictions are high-risk (${Math.round(pct * 100)}%)`,
      zh: `${company.operatingCountries.length} 个运营辖区中有 ${highRiskOps.length} 个高风险（${Math.round(pct * 100)}%）`,
    },
    score: pctScore,
    weightWithinDimension: 0.4,
    rationale: {
      en: "Counts jurisdictions classified as FATF blacklist/greylist or under OFAC sanctions as high-risk, divided by total footprint.",
      zh: "将被归为 FATF 黑/灰名单或 OFAC 制裁下的辖区视为高风险，再除以总运营辖区数。",
    },
    sourceIds: ["fatf_lists", "ofac_countries"],
  };

  // Factor 2: Subsidiaries in sanctioned countries
  const sanctionedSubs = company.subsidiaries.filter((s) => {
    const c = countries[s.country];
    return c?.ofacComprehensive || c?.fatfStatus === "blacklist";
  });
  const subScore = sanctionedSubs.length === 0 ? 0 : Math.min(100, 40 + sanctionedSubs.length * 25);
  const subFactor: Factor = {
    id: "subsidiaries_in_sanctioned_countries",
    name: { en: "Subsidiaries in Sanctioned Jurisdictions", zh: "制裁辖区内的子公司" },
    value: sanctionedSubs.length,
    displayValue: {
      en: `${sanctionedSubs.length} subsidiary(ies) in OFAC-comprehensive / FATF-blacklist jurisdictions`,
      zh: `位于 OFAC 全面制裁 / FATF 黑名单辖区的子公司数量：${sanctionedSubs.length}`,
    },
    score: subScore,
    weightWithinDimension: 0.4,
    rationale: {
      en: "Any subsidiary presence triggers 40; each additional adds 25, capped at 100.",
      zh: "存在任一子公司触发 40 分；每增加一个 +25 分，上限 100。",
    },
    sourceIds: ["ofac_countries", "fatf_lists"],
  };

  // Factor 3: Sudden jurisdiction expansion (mock flag)
  const suddenScore = company.suddenJurisdictionExpansion ? 85 : 0;
  const suddenFactor: Factor = {
    id: "sudden_jurisdiction_expansion",
    name: { en: "Recent High-Risk Expansion", zh: "近期高风险扩张" },
    value: company.suddenJurisdictionExpansion ?? false,
    displayValue: {
      en: company.suddenJurisdictionExpansion
        ? "Entity entered a high-risk jurisdiction within the last 6 months"
        : "No recent high-risk jurisdiction expansion detected",
      zh: company.suddenJurisdictionExpansion
        ? "过去 6 个月内进入高风险辖区"
        : "未检测到近期高风险辖区扩张",
    },
    score: suddenScore,
    weightWithinDimension: 0.2,
    rationale: {
      en: "Dynamic monitoring signal — flag set if the entity began operating in a FATF blacklist/greylist jurisdiction within the last 6 months.",
      zh: "动态监控信号——若实体在过去 6 个月内开始在 FATF 黑/灰名单辖区运营，则触发标记。",
    },
    sourceIds: ["control_risks_geo"],
  };

  const factors = [pctFactor, subFactor, suddenFactor];
  const score = factors.reduce((acc, f) => acc + f.score * f.weightWithinDimension, 0);
  return {
    id: "jurisdiction",
    name: DIMENSION_NAMES.jurisdiction,
    weight: DIMENSION_WEIGHTS.jurisdiction,
    score: Math.round(score),
    factors,
  };
}
