import type { Company, Country, DimensionScore, Factor } from "../types";
import { DIMENSION_NAMES, DIMENSION_WEIGHTS } from "../types";

// Typical transit / hub jurisdictions flagged by regulators (FinCEN, EU, OFAC advisories)
const TRANSIT_HUBS = new Set(["AE", "TR", "HK", "SG", "MC", "CY", "VG", "KY", "LU", "CH"]);
// Countries neighboring / adjacent to comprehensively-sanctioned ones
const SANCTIONED_ADJACENT = new Set(["AM", "AZ", "KZ", "UZ", "TJ", "TM", "GE", "IQ", "AF", "CN", "KR", "RU", "LB", "JO"]);

export function scoreCircumvention(company: Company, countries: Record<string, Country>): DimensionScore {
  // Factor 1: Transit country pattern — co-occurrence of a transit hub + a
  // partially/fully sanctioned jurisdiction in operating countries
  const hasTransit = company.operatingCountries.some((c) => TRANSIT_HUBS.has(c));
  const hasSanctioned = company.operatingCountries.some((c) => {
    const country = countries[c];
    return country?.ofacComprehensive || country?.ofacPartial || country?.fatfStatus === "blacklist";
  });
  const transitScore = hasTransit && hasSanctioned ? 85 : hasTransit || hasSanctioned ? 35 : 0;
  const transitFactor: Factor = {
    id: "transit_country_pattern",
    name: { en: "Transit Country Pattern", zh: "中转国家模式" },
    value: hasTransit && hasSanctioned ? "Pattern Detected" : "None",
    displayValue: {
      en: hasTransit && hasSanctioned
        ? "Entity operates in a known transit hub AND a sanctioned jurisdiction"
        : hasTransit
          ? "Entity operates in a known transit hub only"
          : hasSanctioned
            ? "Entity operates in a sanctioned jurisdiction only"
            : "No transit/sanctioned co-occurrence",
      zh: hasTransit && hasSanctioned
        ? "实体同时在已知中转枢纽和受制裁辖区运营"
        : hasTransit
          ? "仅在已知中转枢纽运营"
          : hasSanctioned
            ? "仅在受制裁辖区运营"
            : "未发现中转/制裁并存",
    },
    score: transitScore,
    weightWithinDimension: 0.5,
    rationale: {
      en: "Combining a transit hub (AE/TR/HK/SG/CY/VG/KY/…) with a sanctioned jurisdiction in the operating footprint is a documented circumvention signal.",
      zh: "运营足迹同时包含中转枢纽（AE/TR/HK/SG/CY/VG/KY 等）与受制裁辖区，是已记录的规避信号。",
    },
    sourceIds: ["control_risks_geo", "open_sanctions"],
  };

  // Factor 2: Neighboring sanctioned exposure
  const adjacentExposure = company.operatingCountries.filter((c) => SANCTIONED_ADJACENT.has(c)).length;
  const adjScore = adjacentExposure === 0 ? 0 : Math.min(100, 25 + adjacentExposure * 20);
  const adjFactor: Factor = {
    id: "neighboring_sanctioned_exposure",
    name: { en: "Sanctioned-Neighbor Exposure", zh: "制裁国周边暴露" },
    value: adjacentExposure,
    displayValue: {
      en: `Operates in ${adjacentExposure} jurisdiction(s) bordering comprehensively-sanctioned countries`,
      zh: `在 ${adjacentExposure} 个与全面制裁国接壤的辖区运营`,
    },
    score: adjScore,
    weightWithinDimension: 0.3,
    rationale: {
      en: "Each sanctioned-adjacent country in the footprint adds 20 (base 25 for presence), capped at 100.",
      zh: "运营足迹中每多一个制裁国邻国 +20 分（存在时基础 25 分），上限 100。",
    },
    sourceIds: ["control_risks_geo"],
  };

  // Factor 3: Opaque ownership chain — many UBOs and subsidiaries spanning secrecy-prone places
  const subsSecrecy = company.subsidiaries.filter((s) => TRANSIT_HUBS.has(s.country)).length;
  const uboSecrecy = company.ubos.filter((u) => TRANSIT_HUBS.has(u.country)).length;
  const opaqueRaw = subsSecrecy * 15 + uboSecrecy * 25;
  const opaqueScore = Math.min(100, opaqueRaw);
  const opaqueFactor: Factor = {
    id: "opaque_ownership_chain",
    name: { en: "Opaque Ownership Chain", zh: "不透明所有权链路" },
    value: `${subsSecrecy} sub / ${uboSecrecy} ubo`,
    displayValue: {
      en: `${subsSecrecy} subsidiary(ies) and ${uboSecrecy} UBO(s) domiciled in financial-secrecy hubs`,
      zh: `${subsSecrecy} 个子公司与 ${uboSecrecy} 位 UBO 位于金融保密枢纽`,
    },
    score: opaqueScore,
    weightWithinDimension: 0.2,
    rationale: {
      en: "Secrecy-prone domiciles (Tax Justice Network FSI top tier) on UBOs/subsidiaries amplify ownership opacity.",
      zh: "Tax Justice Network 金融保密指数前列的辖区出现在 UBO/子公司中，放大所有权不透明度。",
    },
    sourceIds: ["tjn_fsi", "open_sanctions"],
  };

  const factors = [transitFactor, adjFactor, opaqueFactor];
  const score = factors.reduce((acc, f) => acc + f.score * f.weightWithinDimension, 0);
  return {
    id: "circumvention",
    name: DIMENSION_NAMES.circumvention,
    weight: DIMENSION_WEIGHTS.circumvention,
    score: Math.round(score),
    factors,
  };
}
