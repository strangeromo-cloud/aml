"use client";

import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { Company, Country, DataSource, RiskAssessment } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardBody, CardHeader, CardTitle } from "./ui";
import { SearchBar } from "./search-bar";
import { TopRiskList } from "./top-risk-list";
import { ShieldAlert, Building2, Globe2, Database, FileSpreadsheet, ArrowRight } from "lucide-react";
import Link from "next/link";

type Props = {
  companies: Company[];
  countries: Country[];
  sources: DataSource[];
  top10: { company: Company; assessment: RiskAssessment }[];
  allAssessments: RiskAssessment[];
  stats: {
    totalCompanies: number;
    customers: number;
    suppliers: number;
    sanctionsHits: number;
    sources: number;
    countries: number;
    byLevel: { low: number; medium: number; high: number; critical: number };
  };
  nvidiaExportTotal?: number;
  amdExportTotal?: number;
};

const LEVEL_COLOR: Record<string, string> = {
  low: "#10b981",
  medium: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
};

export function HomeContent({ companies, countries, top10, allAssessments, stats, nvidiaExportTotal, amdExportTotal }: Props) {
  const { t, tl } = useI18n();

  const countryName = useMemo(
    () => Object.fromEntries(countries.map((c) => [c.code, c.name])),
    [countries],
  );

  const distData = useMemo(
    () => [
      { name: t("risk.low"), level: "low", value: stats.byLevel.low },
      { name: t("risk.medium"), level: "medium", value: stats.byLevel.medium },
      { name: t("risk.high"), level: "high", value: stats.byLevel.high },
      { name: t("risk.critical"), level: "critical", value: stats.byLevel.critical },
    ],
    [stats.byLevel, t],
  );

  const geoData = useMemo(() => {
    const byCountry: Record<string, { total: number; count: number }> = {};
    for (let i = 0; i < companies.length; i++) {
      const hq = companies[i].hqCountry;
      const sc = allAssessments[i].overallScore;
      if (!byCountry[hq]) byCountry[hq] = { total: 0, count: 0 };
      byCountry[hq].total += sc;
      byCountry[hq].count++;
    }
    return Object.entries(byCountry)
      .map(([code, { total, count }]) => ({
        code,
        name: countryName[code] ? tl(countryName[code]) : code,
        avg: Math.round(total / count),
        count,
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10);
  }, [companies, allAssessments, countryName, tl]);

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="pt-4">
        <div className="mb-6 max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("home.heroTitle")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))] md:text-base">
            {t("home.heroSub")}
          </p>
        </div>
        <SearchBar companies={companies} />
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label={t("home.stat.companies")}
          value={stats.totalCompanies}
          sub={`${stats.customers} ${t("company.customer")} · ${stats.suppliers} ${t("company.supplier")}`}
        />
        <StatCard
          icon={<ShieldAlert className="h-4 w-4 text-rose-500" />}
          label={t("home.stat.highRisk")}
          value={stats.byLevel.high + stats.byLevel.critical}
          sub={`${stats.byLevel.critical} critical · ${stats.byLevel.high} high`}
        />
        <StatCard
          icon={<Globe2 className="h-4 w-4 text-amber-500" />}
          label={t("home.stat.sanctionsHits")}
          value={stats.sanctionsHits}
        />
        <StatCard
          icon={<Database className="h-4 w-4" />}
          label={t("home.stat.sources")}
          value={stats.sources}
          sub={`${stats.countries} countries`}
        />
      </section>

      {/* Top 10 */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t("home.top10Title")}</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("home.top10Sub")}</p>
          </div>
          <Link href="/companies" className="text-sm text-[hsl(var(--muted-foreground))] hover:underline">
            {t("search.viewAll")}
          </Link>
        </div>
        <TopRiskList rows={top10} countryName={countryName} />
      </section>

      {/* Vendor Export Reference entry */}
      {(typeof nvidiaExportTotal === "number" || typeof amdExportTotal === "number") && (
        <section>
          <Link
            href="/exports"
            className="group flex flex-wrap items-center gap-4 rounded-lg border bg-[hsl(var(--card))] px-5 py-4 shadow-sm transition-colors hover:bg-[hsl(var(--muted))]/50"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t("exports.homeCardTitle")}</div>
              <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                {t("exports.homeCardSub")
                  .replace("{nvidia}", (nvidiaExportTotal ?? 0).toLocaleString())
                  .replace("{amd}", (amdExportTotal ?? 0).toLocaleString())}
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--foreground))] transition-transform group-hover:translate-x-0.5">
              {t("exports.homeCardCta")}
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </section>
      )}

      {/* Charts */}
      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("home.distributionTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex items-center gap-6">
              <div className="h-64 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={distData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {distData.map((d) => (
                        <Cell key={d.level} fill={LEVEL_COLOR[d.level]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2.5 text-sm">
                {distData.map((d) => (
                  <li key={d.level} className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded"
                      style={{ background: LEVEL_COLOR[d.level] }}
                    />
                    <span className="w-16">{d.name}</span>
                    <span className="font-mono font-medium">{d.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("home.geoTitle")}</CardTitle>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{t("home.geoSub")}</p>
          </CardHeader>
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={geoData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} fontSize={11} />
                  <YAxis type="category" dataKey="name" fontSize={11} width={100} />
                  <Tooltip />
                  <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
                    {geoData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          d.avg >= 70 ? "#ef4444"
                            : d.avg >= 50 ? "#f97316"
                            : d.avg >= 25 ? "#f59e0b"
                            : "#10b981"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <Card>
      <CardBody className="!py-5">
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          {icon}
          <span className="uppercase tracking-wider">{label}</span>
        </div>
        <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{sub}</div>}
      </CardBody>
    </Card>
  );
}
