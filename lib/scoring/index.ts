import type { Company, Country, DimensionScore, RiskAssessment } from "../types";
import { DIMENSION_WEIGHTS, levelOf } from "../types";
import { scoreSanctions } from "./sanctions";
import { scoreCountryRisk } from "./country-risk";
import { scoreJurisdiction } from "./jurisdiction";
import { scoreCircumvention } from "./circumvention";
import { scorePepMedia } from "./pep-media";
import { scoreEnrichment } from "./enrichment";

export function assessCompany(company: Company, countries: Record<string, Country>): RiskAssessment {
  const dimensions: DimensionScore[] = [
    scoreSanctions(company, countries),
    scoreCountryRisk(company, countries),
    scoreJurisdiction(company, countries),
    scoreCircumvention(company, countries),
    scorePepMedia(company, countries),
    scoreEnrichment(company, countries),
  ];

  const totalWeight = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
  const weighted = dimensions.reduce((acc, d) => acc + d.score * d.weight, 0);
  const overall = Math.round(weighted / totalWeight);

  return {
    companyId: company.id,
    overallScore: overall,
    riskLevel: levelOf(overall),
    dimensions,
    generatedAt: new Date().toISOString(),
  };
}
