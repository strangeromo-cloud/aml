import type { Company, Country, DimensionScore, Factor } from "../types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "../types";

export function scorePepMedia(company: Company, _countries: Record<string, Country>): DimensionScore {
  // Factor 1: UBO PEP status
  const peps = company.ubos.filter((u) => u.pep).length;
  const pepScore = peps === 0 ? 0 : Math.min(100, 45 + (peps - 1) * 25);
  const pepFactor: Factor = {
    id: "ubo_pep_status",
    name: { en: "UBO PEP Status", zh: "UBO 政治敏感人物状态" },
    value: peps,
    displayValue: {
      en: `${peps} of ${company.ubos.length} UBO(s) flagged as Politically Exposed Persons`,
      zh: `${company.ubos.length} 位 UBO 中有 ${peps} 位被标记为政治敏感人物`,
    },
    score: pepScore,
    weightWithinDimension: 0.5,
    rationale: {
      en: "Any UBO flagged as PEP triggers 45; each additional +25. Aligned with FATF Recommendations 12 & 22 on PEPs.",
      zh: "任一 UBO 为 PEP 触发 45 分；每增加一位 +25。对应 FATF 建议 12 与 22。",
    },
    sourceIds: ["open_sanctions"],
  };

  // Factor 2: Adverse media count (mock)
  const media = company.adverseMediaCount ?? 0;
  const mediaScore = Math.min(100, media * 8);
  const mediaFactor: Factor = {
    id: "adverse_media_count",
    name: { en: "Adverse Media Mentions", zh: "负面媒体报道" },
    value: media,
    displayValue: {
      en: `${media} negative news article(s) in the last 24 months`,
      zh: `过去 24 个月内的负面新闻数量：${media}`,
    },
    score: mediaScore,
    weightWithinDimension: 0.3,
    rationale: {
      en: "Count of adverse media hits mentioning AML/fraud/sanctions/corruption keywords. Each article adds 8, capped at 100.",
      zh: "涉及反洗钱 / 欺诈 / 制裁 / 腐败等关键词的负面新闻数量。每篇 +8 分，上限 100。",
    },
    sourceIds: ["open_sanctions"],
  };

  // Factor 3: Regulatory enforcement history
  const enforce = company.regulatoryEnforcementCount ?? 0;
  const enforceScore = enforce === 0 ? 0 : Math.min(100, 55 + (enforce - 1) * 25);
  const enforceFactor: Factor = {
    id: "regulatory_enforcement_history",
    name: { en: "Regulatory Enforcement History", zh: "监管处罚历史" },
    value: enforce,
    displayValue: {
      en: enforce === 0 ? "No prior regulatory enforcement actions" : `${enforce} prior regulatory action(s)`,
      zh: enforce === 0 ? "无监管处罚历史" : `历史监管处罚次数：${enforce}`,
    },
    score: enforceScore,
    weightWithinDimension: 0.2,
    rationale: {
      en: "Past enforcement by OFAC/FinCEN/EU/national regulators. Any prior action = 55; each additional +25.",
      zh: "过往受 OFAC / FinCEN / 欧盟 / 本国监管处罚。任一次历史处罚 = 55 分；每增加 +25。",
    },
    sourceIds: ["ofac_sdn", "open_sanctions"],
  };

  const factors = [pepFactor, mediaFactor, enforceFactor];
  const score = factors.reduce((acc, f) => acc + f.score * f.weightWithinDimension, 0);
  return {
    id: "pepMedia",
    name: DIMENSION_NAMES.pepMedia,
    weight: DIMENSION_WEIGHTS.pepMedia,
    score: Math.round(score),
    factors,
  };
}
