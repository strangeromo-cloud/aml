import fs from "node:fs";
import path from "node:path";
import { assessCompany } from "../lib/scoring";
import type { Company, Country } from "../lib/types";

const companies: Company[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/companies.json"), "utf8"));
const countries: Country[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/countries.json"), "utf8"));
const countryMap = Object.fromEntries(countries.map((c) => [c.code, c]));

const rows = companies.map((c) => ({ company: c, a: assessCompany(c, countryMap) }));
rows.sort((a, b) => b.a.overallScore - a.a.overallScore);

console.log("\n=== TOP 15 RISK ===");
for (const r of rows.slice(0, 15)) {
  console.log(
    `${r.a.overallScore.toString().padStart(3)} | ${r.a.riskLevel.padEnd(8)} | ${r.company.relationship.padEnd(9)} | ${r.company.hqCountry} | ${r.company.name}`,
  );
}

console.log("\n=== BOTTOM 5 RISK ===");
for (const r of rows.slice(-5)) {
  console.log(
    `${r.a.overallScore.toString().padStart(3)} | ${r.a.riskLevel.padEnd(8)} | ${r.company.relationship.padEnd(9)} | ${r.company.hqCountry} | ${r.company.name}`,
  );
}

const byLevel = { low: 0, medium: 0, high: 0, critical: 0 };
for (const r of rows) byLevel[r.a.riskLevel]++;
console.log("\n=== DISTRIBUTION ===");
console.log(byLevel);

const realRisky = rows.filter((r) => r.company.isReal && r.a.riskLevel !== "low");
console.log(`\nReal companies that are NOT low risk: ${realRisky.length}`);
for (const r of realRisky) {
  console.log(`  ${r.a.overallScore} | ${r.a.riskLevel} | ${r.company.name} (${r.company.hqCountry})`);
}
