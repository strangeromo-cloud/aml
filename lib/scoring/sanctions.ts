import type { Company, Country, DimensionScore, Factor } from "../types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "../types";

export function scoreSanctions(company: Company, countries: Record<string, Country>): DimensionScore {
  const hq = countries[company.hqCountry];

  // Factor 1: Direct sanctions hit — company HQ in a fully sanctioned or blacklist jurisdiction
  const directHit =
    hq?.ofacComprehensive || hq?.fatfStatus === "blacklist" || hq?.unSanctioned || hq?.euSanctioned;
  const directScore = directHit ? 100 : hq?.ofacPartial ? 75 : 0;
  const directFactor: Factor = {
    id: "sanctions_direct_hit",
    name: { en: "Direct Sanctions Hit", zh: "直接制裁命中" },
    value: directHit ? "Hit" : hq?.ofacPartial ? "Partial" : "No Hit",
    displayValue: {
      en: directHit ? `Listed in ${[hq?.ofacComprehensive && "OFAC", hq?.fatfStatus === "blacklist" && "FATF", hq?.unSanctioned && "UN", hq?.euSanctioned && "EU"].filter(Boolean).join(", ")}`
        : hq?.ofacPartial ? "Sectoral/partial sanctions apply"
        : "No matching entries",
      zh: directHit ? `命中 ${[hq?.ofacComprehensive && "OFAC", hq?.fatfStatus === "blacklist" && "FATF", hq?.unSanctioned && "UN", hq?.euSanctioned && "EU"].filter(Boolean).join("、")} 制裁`
        : hq?.ofacPartial ? "适用部门/部分制裁"
        : "未匹配到任何名单",
    },
    score: directScore,
    weightWithinDimension: 0.6,
    rationale: {
      en: `HQ jurisdiction ${hq?.name.en} drives this factor: comprehensive sanctions => 100; partial => 75; no sanctions => 0.`,
      zh: `本因子由总部司法辖区 ${hq?.name.zh} 决定：全面制裁 = 100；部分制裁 = 75；无制裁 = 0。`,
    },
    sourceIds: ["ofac_sdn", "ofac_countries", "un_consolidated", "eu_consolidated", "fatf_lists"],
  };

  // Factor 2: UBO Hit — UBO resides in a sanctioned / blacklisted jurisdiction
  const uboHitCountries = company.ubos
    .map((u) => countries[u.country])
    .filter((c) => c?.ofacComprehensive || c?.fatfStatus === "blacklist" || c?.unSanctioned || c?.euSanctioned);
  const uboScore = uboHitCountries.length > 0 ? Math.min(100, uboHitCountries.length * 60) : 0;
  const uboFactor: Factor = {
    id: "sanctions_ubo_hit",
    name: { en: "UBO Sanctions Exposure", zh: "UBO 制裁暴露" },
    value: uboHitCountries.length,
    displayValue: {
      en: `${uboHitCountries.length} of ${company.ubos.length} UBO(s) reside in sanctioned jurisdictions`,
      zh: `${company.ubos.length} 位 UBO 中有 ${uboHitCountries.length} 位位于受制裁司法辖区`,
    },
    score: uboScore,
    weightWithinDimension: 0.3,
    rationale: {
      en: "Each UBO residing in a comprehensively sanctioned / FATF blacklist country contributes 60 to the score, capped at 100.",
      zh: "每位位于全面制裁 / FATF 黑名单国家的 UBO 贡献 60 分，上限 100。",
    },
    sourceIds: ["ofac_sdn", "open_sanctions"],
  };

  // Factor 3: Fuzzy watchlist match — mock value from generator
  const fuzzy = company.fuzzyWatchlistMatchPct ?? 0;
  const fuzzyScore = fuzzy; // already 0-100
  const fuzzyFactor: Factor = {
    id: "sanctions_fuzzy_match",
    name: { en: "Fuzzy Watchlist Match", zh: "模糊名单匹配" },
    value: fuzzy,
    displayValue: {
      en: `${fuzzy}% similarity to an entry on aggregated sanctions lists`,
      zh: `与综合制裁名单条目的相似度 ${fuzzy}%`,
    },
    score: fuzzyScore,
    weightWithinDimension: 0.1,
    rationale: {
      en: "Fuzzy name similarity against OFAC/UN/EU/OpenSanctions. Lower alone is not conclusive; this serves as an investigative trigger.",
      zh: "与 OFAC/UN/EU/OpenSanctions 的名称模糊相似度。单独值低不能定论，主要作为调查触发器。",
    },
    sourceIds: ["open_sanctions", "ofac_sdn"],
  };

  const factors = [directFactor, uboFactor, fuzzyFactor];
  const score = factors.reduce((acc, f) => acc + f.score * f.weightWithinDimension, 0);
  return {
    id: "sanctions",
    name: DIMENSION_NAMES.sanctions,
    weight: DIMENSION_WEIGHTS.sanctions,
    score: Math.round(score),
    factors,
  };
}
