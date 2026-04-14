// Generates 200 mock companies (100 customers + 100 suppliers) and writes
// to data/companies.json. Uses a seeded PRNG for reproducibility.
import fs from "node:fs";
import path from "node:path";
import type { Company, Country } from "../lib/types";

const COUNTRIES: Country[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data/countries.json"), "utf8"),
);

// Mulberry32 seeded PRNG
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260414);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const pickN = <T>(arr: T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  }
  return out;
};

// ===== Real (benign) companies — all low risk =====
// We only use widely-known tier-1 names to illustrate "how clean companies look".
// None of these are given risk signals; they're expected to land Low.
const REAL_CUSTOMERS: Array<Partial<Company> & { name: string; hqCountry: string; industry: string }> = [
  { name: "Bank of America", hqCountry: "US", industry: "Banking" },
  { name: "JPMorgan Chase", hqCountry: "US", industry: "Banking" },
  { name: "Deutsche Bank", hqCountry: "DE", industry: "Banking" },
  { name: "HSBC Holdings", hqCountry: "GB", industry: "Banking" },
  { name: "Mitsubishi UFJ Financial Group", hqCountry: "JP", industry: "Banking" },
  { name: "Toyota Motor", hqCountry: "JP", industry: "Automotive" },
  { name: "Samsung Electronics", hqCountry: "KR", industry: "Electronics" },
  { name: "Siemens", hqCountry: "DE", industry: "Industrial" },
  { name: "Airbus", hqCountry: "FR", industry: "Aerospace" },
  { name: "University of Oxford", hqCountry: "GB", industry: "Education" },
  { name: "Stanford University", hqCountry: "US", industry: "Education" },
  { name: "Ping An Insurance", hqCountry: "CN", industry: "Insurance" },
  { name: "Telstra", hqCountry: "AU", industry: "Telecom" },
  { name: "Orange", hqCountry: "FR", industry: "Telecom" },
  { name: "BHP Group", hqCountry: "AU", industry: "Mining" },
];
const REAL_SUPPLIERS: Array<Partial<Company> & { name: string; hqCountry: string; industry: string }> = [
  { name: "Intel Corporation", hqCountry: "US", industry: "Semiconductor" },
  { name: "Advanced Micro Devices", hqCountry: "US", industry: "Semiconductor" },
  { name: "Qualcomm", hqCountry: "US", industry: "Semiconductor" },
  { name: "NVIDIA", hqCountry: "US", industry: "Semiconductor" },
  { name: "TSMC", hqCountry: "TW", industry: "Semiconductor Foundry" },
  { name: "SK hynix", hqCountry: "KR", industry: "Memory" },
  { name: "Micron Technology", hqCountry: "US", industry: "Memory" },
  { name: "Foxconn", hqCountry: "TW", industry: "Contract Manufacturing" },
  { name: "BOE Technology", hqCountry: "CN", industry: "Display Panel" },
  { name: "LG Display", hqCountry: "KR", industry: "Display Panel" },
  { name: "Corning", hqCountry: "US", industry: "Glass & Optics" },
  { name: "TDK", hqCountry: "JP", industry: "Electronic Components" },
  { name: "Murata Manufacturing", hqCountry: "JP", industry: "Electronic Components" },
  { name: "DHL", hqCountry: "DE", industry: "Logistics" },
  { name: "ASML", hqCountry: "NL", industry: "Semiconductor Equipment" },
];

// ===== Synthetic name pools =====
const PREFIXES = ["Pacific", "Atlantic", "Nordic", "Adriatic", "Meridian", "Vanguard", "Pinnacle", "Zenith",
  "Horizon", "Crescent", "Aurora", "Summit", "Silverline", "Evergreen", "Cascade", "Helio", "Baltic",
  "Continental", "Delta", "Phoenix", "Orion", "Solstice", "Monarch", "Ironclad", "Globex", "Sterling",
  "Crimson", "Capitol", "Meridian", "Keystone", "Riverstone", "Oakridge", "Highgate", "Westline",
  "Northwind", "Fairhaven", "Summit", "Maplewood", "Crescent", "Elanor", "Zephyr", "Opal"];
const CUSTOMER_SECTORS = ["Capital", "Holdings", "Group", "International", "Commerce", "Partners", "Ventures",
  "Trading", "Enterprises", "Solutions", "Systems", "Industries", "Logistics", "Pharma", "Healthcare",
  "Telecom", "Energy", "Real Estate", "Retail", "Finance", "Aviation", "Media", "Infrastructure"];
const SUPPLIER_SECTORS = ["Components", "Semiconductors", "Materials", "Electronics", "Precision",
  "Microsystems", "Cables", "Displays", "Optics", "Batteries", "Metals", "Polymers", "Packaging",
  "Fasteners", "Connectors", "Sensors", "PCB", "Chemicals", "Cooling", "Robotics"];
const SUFFIXES = ["Co.", "Ltd.", "GmbH", "SA", "SAS", "BV", "Pte Ltd", "AG", "Holdings Ltd.",
  "International", "Group", "& Co.", "PLC", "LLC"];

// ===== Country pools by "risk archetype" =====
const CLEAN_HQ = ["US", "GB", "DE", "FR", "JP", "KR", "NL", "CA", "AU", "IT", "ES", "SE", "FI", "DK",
  "NO", "IE", "AT", "CH", "BE", "SG", "NZ", "PT", "PL", "CZ", "IL", "LU"];
const EMERGING_HQ = ["CN", "IN", "BR", "MX", "TW", "HK", "TH", "MY", "ID", "TR", "SA", "AE", "ZA", "EG",
  "RO", "HU", "CL", "AR", "CO", "PE"];
const RISKY_HQ = ["RU", "BY", "VE", "NG", "PK", "BD", "PH", "VN", "BG", "HR", "MC", "LB", "UA", "ML", "KE", "CD"];
const SANCTIONED_HQ = ["IR", "KP", "SY", "CU", "MM"]; // used rarely and only synthetic

const COUNTRY_BY_CODE: Record<string, Country> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

function synthName(kind: "customer" | "supplier"): string {
  const sectors = kind === "customer" ? CUSTOMER_SECTORS : SUPPLIER_SECTORS;
  const pattern = rand();
  if (pattern < 0.55) return `${pick(PREFIXES)} ${pick(sectors)} ${pick(SUFFIXES)}`;
  if (pattern < 0.85) return `${pick(PREFIXES)}${pick(sectors)} ${pick(SUFFIXES)}`;
  return `${pick(PREFIXES)} ${pick(sectors)}`;
}

function operatingCountriesFor(hq: string, riskBand: RiskBand): string[] {
  const n = 3 + Math.floor(rand() * 5);
  let pool: string[];
  if (riskBand === "critical" || riskBand === "high") {
    // Mix of clean + risky/sanctioned neighbors to produce circumvention signals
    pool = [...CLEAN_HQ, ...EMERGING_HQ, ...RISKY_HQ, ...SANCTIONED_HQ];
  } else if (riskBand === "medium") {
    pool = [...CLEAN_HQ, ...EMERGING_HQ, ...RISKY_HQ];
  } else {
    pool = [...CLEAN_HQ, ...EMERGING_HQ];
  }
  const picked = new Set<string>([hq]);
  while (picked.size < n + 1) picked.add(pick(pool));
  return Array.from(picked);
}

function subsidiariesFor(hq: string, riskBand: RiskBand): { name: string; country: string }[] {
  const n = 1 + Math.floor(rand() * 4);
  const subs: { name: string; country: string }[] = [];
  for (let i = 0; i < n; i++) {
    let country: string;
    if (riskBand === "critical") {
      country = rand() < 0.4 ? pick(SANCTIONED_HQ) : rand() < 0.6 ? pick(RISKY_HQ) : pick(EMERGING_HQ);
    } else if (riskBand === "high") {
      country = rand() < 0.35 ? pick(RISKY_HQ) : pick([...EMERGING_HQ, hq]);
    } else if (riskBand === "medium") {
      country = rand() < 0.25 ? pick(RISKY_HQ) : pick([...CLEAN_HQ, ...EMERGING_HQ]);
    } else {
      country = pick([...CLEAN_HQ, ...EMERGING_HQ, hq]);
    }
    subs.push({ name: `${pick(PREFIXES)} ${pick(SUPPLIER_SECTORS)} (${country})`, country });
  }
  return subs;
}

const FIRST_NAMES = ["Alex", "Daniel", "Sofia", "Nikolai", "Farid", "Ingrid", "Kenji", "Mei",
  "Rafael", "Leila", "Viktor", "Amara", "Dmitri", "Natalia", "Andre", "Yusuf", "Elena", "Javier", "Ming", "Priya"];
const LAST_NAMES = ["Kovalenko", "Petrov", "Nazarov", "Singh", "Silva", "Khan", "Demir", "Rossi",
  "Chen", "Novak", "Al-Hassan", "Tanaka", "Kim", "Müller", "Lefevre", "Okafor", "Hernandez", "Ivanov"];

function ubosFor(hq: string, riskBand: RiskBand): { name: string; country: string; pep: boolean }[] {
  const n = 1 + Math.floor(rand() * 3);
  const ubos: { name: string; country: string; pep: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    let country: string;
    if (riskBand === "critical") country = rand() < 0.5 ? pick(SANCTIONED_HQ) : pick(RISKY_HQ);
    else if (riskBand === "high") country = rand() < 0.5 ? pick(RISKY_HQ) : pick([...EMERGING_HQ, hq]);
    else if (riskBand === "medium") country = rand() < 0.3 ? pick(RISKY_HQ) : pick([...EMERGING_HQ, hq]);
    else country = pick([...CLEAN_HQ, ...EMERGING_HQ, hq]);
    const pepProb = riskBand === "critical" ? 0.85 : riskBand === "high" ? 0.6 : riskBand === "medium" ? 0.25 : 0.03;
    ubos.push({
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      country,
      pep: rand() < pepProb,
    });
  }
  return ubos;
}

type RiskBand = "low" | "medium" | "high" | "critical";

// Explicit rotation across sanctioned jurisdictions so every run includes
// representatives of KP/IR/SY/MM/CU rather than relying on RNG luck.
const CRITICAL_HQ_ROTATION = ["IR", "KP", "SY", "MM", "CU"];
let criticalIdx = 0;
const HIGH_RISK_HQ_ROTATION = ["RU", "BY", "VE", "NG", "PK", "ML", "CD", "LB", "BD", "HT", "YE", "PH", "VN", "BG", "HR", "MC"];
let highIdx = 0;

function hqFor(band: RiskBand, kind: "customer" | "supplier"): string {
  if (band === "critical") {
    const hq = CRITICAL_HQ_ROTATION[criticalIdx % CRITICAL_HQ_ROTATION.length];
    criticalIdx++;
    return hq;
  }
  if (band === "high") {
    const hq = HIGH_RISK_HQ_ROTATION[highIdx % HIGH_RISK_HQ_ROTATION.length];
    highIdx++;
    return hq;
  }
  if (band === "medium") return rand() < 0.5 ? pick(RISKY_HQ) : pick(EMERGING_HQ);
  // Low: supplier bias to APAC manufacturing
  if (kind === "supplier") {
    const supplierPool = ["CN", "TW", "KR", "JP", "TH", "MY", "VN", "SG", "US", "DE", "NL", "MX"];
    return pick(supplierPool);
  }
  return pick(CLEAN_HQ);
}

// ===== Target distribution =====
// Per side (100): 3 critical, 10 high, 20 medium, 67 low → 200 total: 6 crit / 20 high / 40 med / 134 low
function pickBand(index: number, _total: number): RiskBand {
  if (index < 3) return "critical";
  if (index < 13) return "high";
  if (index < 33) return "medium";
  return "low";
}

function makeCompany(
  id: string,
  kind: "customer" | "supplier",
  band: RiskBand,
  realSlot: Partial<Company> | null,
): Company {
  const isReal = !!realSlot;
  const name = realSlot?.name ?? synthName(kind);
  const hq = realSlot?.hqCountry ?? hqFor(band, kind);
  const industry = realSlot?.industry ?? (kind === "supplier" ? pick(SUPPLIER_SECTORS) : pick(CUSTOMER_SECTORS));

  // Real companies always low risk (no risky signals)
  const effectiveBand: RiskBand = isReal ? "low" : band;

  const operatingCountries = operatingCountriesFor(hq, effectiveBand);
  const subsidiaries = subsidiariesFor(hq, effectiveBand);
  const ubos = ubosFor(hq, effectiveBand);

  const tier: Company["tier"] = isReal
    ? "tier1"
    : rand() < 0.2
      ? "tier1"
      : rand() < 0.6
        ? "tier2"
        : "tier3";

  const annualVolumeUsd =
    tier === "tier1"
      ? Math.round(80_000_000 + rand() * 400_000_000)
      : tier === "tier2"
        ? Math.round(8_000_000 + rand() * 60_000_000)
        : Math.round(500_000 + rand() * 6_000_000);

  const yearEstablished = 1960 + Math.floor(rand() * 60);

  // Risk-aligned signals
  const adverseMediaCount =
    effectiveBand === "critical" ? 6 + Math.floor(rand() * 10)
      : effectiveBand === "high" ? 2 + Math.floor(rand() * 6)
      : effectiveBand === "medium" ? Math.floor(rand() * 3)
      : 0;
  const regulatoryEnforcementCount =
    effectiveBand === "critical" ? 1 + Math.floor(rand() * 3)
      : effectiveBand === "high" ? (rand() < 0.4 ? 1 : 0)
      : 0;
  const suddenJurisdictionExpansion =
    effectiveBand === "critical" ? true
      : effectiveBand === "high" ? rand() < 0.6
      : effectiveBand === "medium" ? rand() < 0.2
      : false;
  const fuzzyWatchlistMatchPct =
    effectiveBand === "critical" ? 70 + Math.floor(rand() * 30)
      : effectiveBand === "high" ? 40 + Math.floor(rand() * 30)
      : effectiveBand === "medium" ? 15 + Math.floor(rand() * 20)
      : Math.floor(rand() * 10);

  return {
    id,
    name,
    legalName: name + (isReal ? "" : ""),
    relationship: kind,
    industry,
    hqCountry: hq,
    operatingCountries,
    subsidiaries,
    ubos,
    tier,
    annualVolumeUsd,
    yearEstablished,
    isReal,
    adverseMediaCount,
    regulatoryEnforcementCount,
    suddenJurisdictionExpansion,
    fuzzyWatchlistMatchPct,
  };
}

function generateSide(kind: "customer" | "supplier", reals: typeof REAL_CUSTOMERS) {
  const total = 100;
  const realSlotsAssigned: boolean[] = new Array(total).fill(false);
  const companies: Company[] = [];
  let realIdx = 0;
  for (let i = 0; i < total; i++) {
    const band = pickBand(i, total);
    // Assign a real name if we have any left and this would be low risk
    let realSlot: Partial<Company> | null = null;
    if (band === "low" && realIdx < reals.length) {
      realSlot = reals[realIdx++];
      realSlotsAssigned[i] = true;
    }
    const id = `${kind === "customer" ? "CUST" : "SUPP"}-${String(i + 1).padStart(3, "0")}`;
    companies.push(makeCompany(id, kind, band, realSlot));
  }
  return companies;
}

function main() {
  const customers = generateSide("customer", REAL_CUSTOMERS);
  const suppliers = generateSide("supplier", REAL_SUPPLIERS);
  const all = [...customers, ...suppliers];
  const out = path.join(process.cwd(), "data/companies.json");
  fs.writeFileSync(out, JSON.stringify(all, null, 2));
  console.log(
    `Wrote ${all.length} companies (${customers.length} customers + ${suppliers.length} suppliers) to ${out}`,
  );
  const realCount = all.filter((c) => c.isReal).length;
  console.log(`  Real-name companies: ${realCount}`);
}

main();
