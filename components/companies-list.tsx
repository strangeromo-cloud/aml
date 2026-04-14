"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Company, Country, RiskAssessment, RiskLevel } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardBody, CardHeader, CardTitle, RiskBadge, Progress } from "./ui";
import { CountryFlag } from "./country-flag";
import { SearchBar } from "./search-bar";
import { cn } from "@/lib/utils";

type Row = { company: Company; assessment: RiskAssessment };

export function CompaniesList({
  rows,
  countries,
}: {
  rows: Row[];
  countries: Country[];
}) {
  const { t, tl, locale } = useI18n();
  const [rel, setRel] = useState<"all" | "customer" | "supplier">("all");
  const [level, setLevel] = useState<"all" | RiskLevel>("all");
  const [sort, setSort] = useState<"score" | "name">("score");

  const countryName = useMemo(
    () => Object.fromEntries(countries.map((c) => [c.code, c.name])),
    [countries],
  );

  const filtered = useMemo(() => {
    let out = rows.filter((r) => {
      if (rel !== "all" && r.company.relationship !== rel) return false;
      if (level !== "all" && r.assessment.riskLevel !== level) return false;
      return true;
    });
    if (sort === "score") out = [...out].sort((a, b) => b.assessment.overallScore - a.assessment.overallScore);
    else out = [...out].sort((a, b) => a.company.name.localeCompare(b.company.name));
    return out;
  }, [rows, rel, level, sort]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("companies.title")}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("companies.sub")}</p>
      </div>

      <SearchBar companies={rows.map((r) => r.company)} compact />

      <div className="flex flex-wrap gap-5 text-xs">
        <FilterGroup label={t("companies.filters.all")}>
          {([
            ["all", t("companies.filters.all")],
            ["customer", t("company.customer")],
            ["supplier", t("company.supplier")],
          ] as const).map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setRel(val as any)}
              className={chipCls(rel === val)}
            >
              {lbl}
            </button>
          ))}
        </FilterGroup>
        <FilterGroup label={t("companies.filters.level")}>
          {(["all", "low", "medium", "high", "critical"] as const).map((v) => (
            <button key={v} onClick={() => setLevel(v as any)} className={chipCls(level === v)}>
              {v === "all" ? t("companies.filters.all") : t(`risk.${v}`)}
            </button>
          ))}
        </FilterGroup>
        <FilterGroup label="Sort">
          {([
            ["score", "Score"],
            ["name", "Name"],
          ] as const).map(([v, lbl]) => (
            <button key={v} onClick={() => setSort(v as any)} className={chipCls(sort === v)}>
              {lbl}
            </button>
          ))}
        </FilterGroup>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
            {filtered.length} results
          </CardTitle>
        </CardHeader>
        <div className="overflow-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-[hsl(var(--muted))] text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="px-3 py-2.5 text-left">{t("companies.columns.name")}</th>
                <th className="px-3 py-2.5 text-left">{t("companies.columns.type")}</th>
                <th className="px-3 py-2.5 text-left">{t("companies.columns.hq")}</th>
                <th className="px-3 py-2.5 text-left">{t("companies.columns.industry")}</th>
                <th className="px-3 py-2.5 text-left">{t("companies.columns.tier")}</th>
                <th className="px-3 py-2.5 text-left">{t("companies.columns.score")}</th>
                <th className="px-3 py-2.5 text-left">{t("companies.columns.level")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.company.id} className="border-t hover:bg-[hsl(var(--muted))]/30">
                  <td className="px-3 py-2.5">
                    <Link href={`/company/${r.company.id}`} className="font-medium hover:underline">
                      {locale === "zh" && r.company.nameZh ? r.company.nameZh : r.company.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">
                    {r.company.relationship === "customer" ? t("company.customer") : t("company.supplier")}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <CountryFlag code={r.company.hqCountry} />
                      <span className="text-xs">
                        {countryName[r.company.hqCountry] ? tl(countryName[r.company.hqCountry]) : r.company.hqCountry}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">{r.company.industry}</td>
                  <td className="px-3 py-2.5 text-xs uppercase text-[hsl(var(--muted-foreground))]">{r.company.tier}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-8 text-right font-mono font-semibold tabular-nums">
                        {r.assessment.overallScore}
                      </span>
                      <Progress value={r.assessment.overallScore} className="max-w-[120px]" />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <RiskBadge level={r.assessment.riskLevel} label={t(`risk.${r.assessment.riskLevel}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[hsl(var(--muted-foreground))]">{label}:</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function chipCls(active: boolean) {
  return cn(
    "rounded-md px-2.5 py-1 transition-colors border",
    active
      ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))] border-[hsl(var(--foreground))]"
      : "hover:bg-[hsl(var(--muted))] border-transparent",
  );
}
