"use client";

import Link from "next/link";
import type { Company, RiskAssessment } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { CountryFlag } from "./country-flag";
import { RiskBadge, Progress } from "./ui";
import { ChevronRight } from "lucide-react";

export function TopRiskList({
  rows,
  countryName,
}: {
  rows: { company: Company; assessment: RiskAssessment }[];
  countryName: Record<string, { en: string; zh: string }>;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-[hsl(var(--muted))] text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <tr>
            <th className="w-10 px-3 py-2.5 text-left">#</th>
            <th className="px-3 py-2.5 text-left">{t("companies.columns.name")}</th>
            <th className="w-32 px-3 py-2.5 text-left">{t("companies.columns.hq")}</th>
            <th className="w-28 px-3 py-2.5 text-left">{t("companies.columns.type")}</th>
            <th className="w-56 px-3 py-2.5 text-left">{t("companies.columns.score")}</th>
            <th className="w-24 px-3 py-2.5 text-left">{t("companies.columns.level")}</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const countryDisp = countryName[r.company.hqCountry]?.[locale] ?? r.company.hqCountry;
            return (
              <tr
                key={r.company.id}
                className="border-t transition-colors hover:bg-[hsl(var(--muted))]/50"
              >
                <td className="px-3 py-3 text-[hsl(var(--muted-foreground))]">{i + 1}</td>
                <td className="px-3 py-3">
                  <Link href={`/company/${r.company.id}`} className="font-medium hover:underline">
                    {locale === "zh" && r.company.nameZh ? r.company.nameZh : r.company.name}
                  </Link>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">{r.company.industry}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <CountryFlag code={r.company.hqCountry} className="text-base" />
                    <span className="truncate text-xs">{countryDisp}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                  {r.company.relationship === "customer" ? t("company.customer") : t("company.supplier")}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-right font-mono text-sm font-semibold tabular-nums">
                      {r.assessment.overallScore}
                    </span>
                    <Progress value={r.assessment.overallScore} className="max-w-[180px]" />
                  </div>
                </td>
                <td className="px-3 py-3">
                  <RiskBadge level={r.assessment.riskLevel} label={t(`risk.${r.assessment.riskLevel}`)} />
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/company/${r.company.id}`}
                    className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
