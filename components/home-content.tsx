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
  LabelList,
} from "recharts";
import type { Company, Country, DataSource, RiskAssessment, RiskLevel } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardBody, CardHeader, CardTitle } from "./ui";
import { SearchBar } from "./search-bar";
import { TopRiskList } from "./top-risk-list";
import { ShieldAlert, Building2, Globe2, Database } from "lucide-react";
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
};

const LEVEL_COLOR: Record<string, string> = {
  low: "#10b981",
  medium: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
};

const LEVELS: RiskLevel[] = ["critical", "high", "medium", "low"];

const REGION_ZH: Record<string, string> = {
  "North America": "北美",
  "Latin America": "拉美",
  Europe: "欧洲",
  "Europe/Eurasia": "欧洲/欧亚",
  "Europe/Middle East": "欧洲/中东",
  "Asia-Pacific": "亚太",
  "Middle East": "中东",
  "Africa/Middle East": "非洲/中东",
  Africa: "非洲",
  Other: "其他",
};

// Stable, deterministic hash so quarter bucketing is identical on server and client.
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// Trailing `n` quarters ending at the quarter of `anchorISO` (a build-time constant),
// using UTC so the label set never differs between prerender and hydration.
function trailingQuarters(anchorISO: string, n: number) {
  const d = new Date(anchorISO);
  let y = d.getUTCFullYear();
  let q = Math.floor(d.getUTCMonth() / 3) + 1;
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ key: `${y}Q${q}`, label: `Q${q} '${String(y).slice(2)}` });
    q--;
    if (q === 0) {
      q = 4;
      y--;
    }
  }
  return out.reverse();
}

export function HomeContent({ companies, countries, top10, allAssessments, stats }: Props) {
  const { t, tl, locale } = useI18n();

  const countryName = useMemo(
    () => Object.fromEntries(countries.map((c) => [c.code, c.name])),
    [countries],
  );

  // 1 — Grade distribution (risk level → parts of a whole)
  const gradeData = useMemo(
    () => [
      { name: t("risk.low"), level: "low", value: stats.byLevel.low },
      { name: t("risk.medium"), level: "medium", value: stats.byLevel.medium },
      { name: t("risk.high"), level: "high", value: stats.byLevel.high },
      { name: t("risk.critical"), level: "critical", value: stats.byLevel.critical },
    ],
    [stats.byLevel, t],
  );

  // 2 — Regional distribution (companies per region, stacked by grade)
  const regionData = useMemo(() => {
    const regionOf: Record<string, string> = {};
    for (const c of countries) regionOf[c.code] = c.region;
    const acc: Record<
      string,
      { name: string; low: number; medium: number; high: number; critical: number; total: number }
    > = {};
    for (let i = 0; i < companies.length; i++) {
      const reg = regionOf[companies[i].hqCountry] || "Other";
      const name = locale === "zh" ? REGION_ZH[reg] ?? reg : reg;
      if (!acc[reg]) acc[reg] = { name, low: 0, medium: 0, high: 0, critical: 0, total: 0 };
      acc[reg][allAssessments[i].riskLevel]++;
      acc[reg].total++;
    }
    return Object.values(acc).sort((a, b) => b.total - a.total);
  }, [companies, countries, allAssessments, locale]);

  // 3 — Rule-based distribution (companies with an elevated score per risk dimension)
  const ruleData = useMemo(() => {
    const dims = allAssessments[0]?.dimensions ?? [];
    const counts = dims.map((d) => ({ id: d.id, name: tl(d.name), count: 0 }));
    for (const a of allAssessments) {
      a.dimensions.forEach((d, di) => {
        if (d.score >= 50) counts[di].count++;
      });
    }
    return counts.sort((a, b) => b.count - a.count);
  }, [allAssessments, tl]);

  // 4 — Quarterly distribution (screening volume per quarter, stacked by grade)
  const quarterData = useMemo(() => {
    const anchor = allAssessments[0]?.generatedAt ?? "2026-07-01T00:00:00Z";
    const quarters = trailingQuarters(anchor, 8);
    const rows = quarters.map((q) => ({
      label: q.label,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    }));
    for (let i = 0; i < companies.length; i++) {
      const idx = hashId(companies[i].id) % rows.length;
      rows[idx][allAssessments[i].riskLevel]++;
    }
    return rows;
  }, [companies, allAssessments]);

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

      {/* Charts — 2×2 distribution grid */}
      <section className="grid gap-5 lg:grid-cols-2">
        {/* Grade distribution — donut */}
        <ChartCard title={t("home.gradeTitle")} sub={t("home.gradeSub")}>
          <div className="flex items-center gap-6">
            <div className="h-56 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={gradeData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={86}
                    paddingAngle={2}
                    isAnimationActive={false}
                  >
                    {gradeData.map((d) => (
                      <Cell key={d.level} fill={LEVEL_COLOR[d.level]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2.5 text-sm">
              {gradeData.map((d) => (
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
        </ChartCard>

        {/* Regional distribution — stacked horizontal bar */}
        <ChartCard title={t("home.regionTitle")} sub={t("home.regionSub")}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={regionData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={11} />
                <YAxis type="category" dataKey="name" fontSize={11} width={96} />
                <Tooltip />
                {LEVELS.map((lvl, i) => (
                  <Bar
                    key={lvl}
                    dataKey={lvl}
                    stackId="r"
                    fill={LEVEL_COLOR[lvl]}
                    radius={i === 0 ? [0, 3, 3, 0] : undefined}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <RiskLegend t={t} />
        </ChartCard>

        {/* Rule-based distribution — ranked horizontal bar */}
        <ChartCard title={t("home.ruleTitle")} sub={t("home.ruleSub")}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ruleData} layout="vertical" margin={{ left: 8, right: 30, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={11} />
                <YAxis type="category" dataKey="name" fontSize={11} width={150} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 3, 3, 0]} name={t("home.chartCount")} isAnimationActive={false}>
                  {ruleData.map((d, i) => (
                    <Cell key={d.id} fill={`hsl(199 89% ${58 - i * 5}%)`} />
                  ))}
                  <LabelList dataKey="count" position="right" fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Quarterly distribution — stacked column trend */}
        <ChartCard title={t("home.quarterTitle")} sub={t("home.quarterSub")}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarterData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} width={28} />
                <Tooltip />
                {LEVELS.map((lvl, i) => (
                  <Bar
                    key={lvl}
                    dataKey={lvl}
                    stackId="q"
                    fill={LEVEL_COLOR[lvl]}
                    radius={i === 0 ? [3, 3, 0, 0] : undefined}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <RiskLegend t={t} />
        </ChartCard>
      </section>
    </div>
  );
}

function ChartCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {sub && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{sub}</p>}
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function RiskLegend({ t }: { t: (k: string) => string }) {
  const items: [RiskLevel, string][] = [
    ["low", "risk.low"],
    ["medium", "risk.medium"],
    ["high", "risk.high"],
    ["critical", "risk.critical"],
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
      {items.map(([lvl, key]) => (
        <span key={lvl} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: LEVEL_COLOR[lvl] }}
          />
          {t(key)}
        </span>
      ))}
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
