import companiesRaw from "@/data/companies.json";
import countriesRaw from "@/data/countries.json";
import sourcesRaw from "@/data/sources.json";
import type { Company, Country, DataSource, RiskAssessment } from "./types";
import { assessCompany } from "./scoring";

export const companies: Company[] = companiesRaw as Company[];
export const countries: Country[] = countriesRaw as Country[];
export const sources: DataSource[] = sourcesRaw as DataSource[];

export const countryMap: Record<string, Country> = Object.fromEntries(
  countries.map((c) => [c.code, c]),
);
export const sourceMap: Record<string, DataSource> = Object.fromEntries(
  sources.map((s) => [s.id, s]),
);

let _assessments: RiskAssessment[] | null = null;
export function allAssessments(): RiskAssessment[] {
  if (!_assessments) {
    _assessments = companies.map((c) => assessCompany(c, countryMap));
  }
  return _assessments;
}

export function assessmentFor(id: string): { company: Company; assessment: RiskAssessment } | null {
  const company = companies.find((c) => c.id === id);
  if (!company) return null;
  return { company, assessment: assessCompany(company, countryMap) };
}

export function findCompanyByName(q: string): Company | undefined {
  const lower = q.toLowerCase();
  return companies.find((c) => c.name.toLowerCase() === lower);
}

export function topRisky(n: number = 10): { company: Company; assessment: RiskAssessment }[] {
  const rows = companies.map((c) => ({ company: c, assessment: assessCompany(c, countryMap) }));
  rows.sort((a, b) => b.assessment.overallScore - a.assessment.overallScore);
  return rows.slice(0, n);
}

export function summaryStats() {
  const rows = allAssessments();
  const byLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const a of rows) byLevel[a.riskLevel]++;
  const sanctionsHits = rows.filter((a) => {
    const d = a.dimensions.find((x) => x.id === "sanctions");
    return (d?.score ?? 0) >= 60;
  }).length;
  return {
    totalCompanies: companies.length,
    customers: companies.filter((c) => c.relationship === "customer").length,
    suppliers: companies.filter((c) => c.relationship === "supplier").length,
    sanctionsHits,
    sources: sources.length,
    countries: countries.length,
    byLevel,
  };
}
