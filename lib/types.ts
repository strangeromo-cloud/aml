export type Locale = "en" | "zh";
export type LocalizedString = { en: string; zh: string };

export type DataSource = {
  id: string;
  name: LocalizedString;
  authority: string;
  url: string;
  snapshotDate: string;
  description: LocalizedString;
};

export type FatfStatus = "blacklist" | "greylist" | "compliant";

export type Country = {
  code: string;
  name: LocalizedString;
  region: string;
  fatfStatus: FatfStatus;
  ofacComprehensive: boolean;
  ofacPartial: boolean;
  unSanctioned: boolean;
  euSanctioned: boolean;
  baselAmlIndex: number; // 0-10, higher = riskier
  cpi: number; // 0-100, higher = cleaner
  wgiControlOfCorruption: number; // -2.5 ~ 2.5, higher = better
};

export type Subsidiary = { name: string; country: string };
export type UBO = { name: string; country: string; pep: boolean };

export type Company = {
  id: string;
  name: string;
  nameZh?: string;
  legalName: string;
  relationship: "customer" | "supplier";
  industry: string;
  hqCountry: string;
  operatingCountries: string[];
  subsidiaries: Subsidiary[];
  ubos: UBO[];
  tier: "tier1" | "tier2" | "tier3";
  annualVolumeUsd: number;
  yearEstablished: number;
  isReal: boolean;
  // Optional mock signals injected by generator to drive scoring
  adverseMediaCount?: number;
  regulatoryEnforcementCount?: number;
  suddenJurisdictionExpansion?: boolean;
  fuzzyWatchlistMatchPct?: number;
};

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type DimensionId =
  | "sanctions"
  | "countryRisk"
  | "jurisdiction"
  | "circumvention"
  | "pepMedia"
  | "enrichment";

export type Factor = {
  id: string;
  name: LocalizedString;
  value: string | number | boolean;
  displayValue: LocalizedString;
  score: number; // 0-100
  weightWithinDimension: number;
  rationale: LocalizedString;
  sourceIds: string[];
};

export type DimensionScore = {
  id: DimensionId;
  name: LocalizedString;
  weight: number; // portion of overall
  score: number; // 0-100
  factors: Factor[];
};

export type RiskAssessment = {
  companyId: string;
  overallScore: number;
  riskLevel: RiskLevel;
  dimensions: DimensionScore[];
  generatedAt: string;
};

export const DIMENSION_WEIGHTS: Record<DimensionId, number> = {
  sanctions: 0.25,
  countryRisk: 0.2,
  jurisdiction: 0.15,
  circumvention: 0.15,
  pepMedia: 0.15,
  enrichment: 0.1,
};

export const DIMENSION_NAMES: Record<DimensionId, LocalizedString> = {
  sanctions: { en: "Sanctions Screening", zh: "制裁名单筛查" },
  countryRisk: { en: "Country Risk Scoring", zh: "国家风险评分" },
  jurisdiction: { en: "High-Risk Jurisdiction Monitoring", zh: "高风险司法辖区监控" },
  circumvention: { en: "Sanctions Circumvention Risk", zh: "制裁规避风险" },
  pepMedia: { en: "PEP & Adverse Media", zh: "PEP 及负面媒体" },
  enrichment: { en: "Country Context Enrichment", zh: "国家背景增强" },
};

export function levelOf(score: number): RiskLevel {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}
