"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, Search, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "./ui";

type Part = {
  id: number;
  part_number: string;
  part_description: string;
  part_type: string | null;
  tpp: string | null;
  nv_hts: string | null;
  nveccn: string | null;
  state: string | null;
  mx_legacy_Material: string | null;
};

type Meta = {
  total: number;
  fetchedAt: string;
  sourcePage: string;
  apiUrl: string;
  distinctEccn: number;
  distinctHts: number;
  topEccn: { eccn: string; count: number }[];
  topHts: { hts: string; count: number }[];
  states: { state: string; count: number }[];
  partTypes: { type: string; count: number }[];
};

export function ExportsContent({ parts, meta }: { parts: Part[]; meta: Meta }) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [eccnFilter, setEccnFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");

  const eccnOptions = useMemo(
    () => ["all", ...meta.topEccn.map((e) => e.eccn)],
    [meta.topEccn],
  );
  const stateOptions = useMemo(
    () => ["all", ...meta.states.map((s) => s.state)],
    [meta.states],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parts.filter((p) => {
      if (eccnFilter !== "all" && (p.nveccn ?? "") !== eccnFilter) return false;
      if (stateFilter !== "all" && (p.state ?? "") !== stateFilter) return false;
      if (!q) return true;
      return (
        p.part_number?.toLowerCase().includes(q) ||
        p.part_description?.toLowerCase().includes(q) ||
        (p.part_type ?? "").toLowerCase().includes(q) ||
        (p.nveccn ?? "").toLowerCase().includes(q) ||
        (p.nv_hts ?? "").toLowerCase().includes(q)
      );
    });
  }, [parts, query, eccnFilter, stateFilter]);

  const sampleCount = Math.min(filtered.length, 500);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("exports.title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
            {t("exports.sub")}
          </p>
        </div>
        <a
          href="/nvidia-eccn.xlsx"
          download
          className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--foreground))] px-4 py-2 text-sm font-semibold text-[hsl(var(--background))] shadow-sm transition-opacity hover:opacity-90"
        >
          <Download className="h-4 w-4" />
          {t("exports.downloadXlsx")}
        </a>
      </div>

      {/* Source attribution */}
      <Card>
        <CardBody className="flex flex-wrap items-start gap-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <div className="flex-1 space-y-1">
            <div>
              <span className="text-[hsl(var(--muted-foreground))]">
                {t("exports.sourceLabel")}:{" "}
              </span>
              <a
                href={meta.sourcePage}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                nvidia.com/…/export-regulations
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="text-xs text-[hsl(var(--muted-foreground))]">
              {t("exports.snapshotAt")}: {new Date(meta.fetchedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC", timeZoneName: "short" })}
              {" · "}
              {t("exports.apiNote")}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("exports.stat.total")} value={meta.total.toLocaleString()} />
        <Stat label={t("exports.stat.eccn")} value={meta.distinctEccn} />
        <Stat label={t("exports.stat.hts")} value={meta.distinctHts} />
        <Stat label={t("exports.stat.states")} value={meta.states.length} />
      </div>

      {/* Top ECCN / Top HTS */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("exports.eccnDistTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {meta.topEccn.map((row) => {
                const pct = (row.count / meta.total) * 100;
                return (
                  <li key={row.eccn} className="flex items-center gap-3">
                    <span className="w-28 font-mono text-xs">{row.eccn}</span>
                    <div className="relative h-5 flex-1 overflow-hidden rounded bg-[hsl(var(--muted))]">
                      <div
                        className="h-full bg-sky-500/40"
                        style={{ width: `${pct}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-end pr-2 font-mono text-[11px]">
                        {row.count} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("exports.htsDistTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {meta.topHts.map((row) => {
                const pct = (row.count / meta.total) * 100;
                return (
                  <li key={row.hts} className="flex items-center gap-3">
                    <span className="w-28 font-mono text-xs">{row.hts}</span>
                    <div className="relative h-5 flex-1 overflow-hidden rounded bg-[hsl(var(--muted))]">
                      <div
                        className="h-full bg-violet-500/40"
                        style={{ width: `${pct}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-end pr-2 font-mono text-[11px]">
                        {row.count} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>

      {/* Filters + Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-sm">{t("exports.tableTitle")}</CardTitle>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                className="h-8 w-full rounded-md border bg-[hsl(var(--card))] pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-[hsl(var(--foreground))]/20"
                placeholder={t("exports.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              value={eccnFilter}
              onChange={(e) => setEccnFilter(e.target.value)}
              className="h-8 rounded-md border bg-[hsl(var(--card))] px-2 text-xs focus:outline-none"
            >
              {eccnOptions.map((o) => (
                <option key={o} value={o}>
                  {o === "all" ? t("exports.filters.allEccn") : o}
                </option>
              ))}
            </select>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="h-8 rounded-md border bg-[hsl(var(--card))] px-2 text-xs focus:outline-none"
            >
              {stateOptions.map((o) => (
                <option key={o} value={o}>
                  {o === "all" ? t("exports.filters.allStates") : o}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
            {t("exports.showing")
              .replace("{shown}", sampleCount.toString())
              .replace("{total}", filtered.length.toString())}
            {filtered.length > 500 && (
              <span className="ml-1">{t("exports.truncatedHint")}</span>
            )}
          </div>
        </CardHeader>
        <div className="overflow-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-[hsl(var(--muted))] text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="px-3 py-2 text-left">{t("exports.cols.partNumber")}</th>
                <th className="px-3 py-2 text-left">{t("exports.cols.description")}</th>
                <th className="px-3 py-2 text-left">{t("exports.cols.type")}</th>
                <th className="px-3 py-2 text-left">{t("exports.cols.eccn")}</th>
                <th className="px-3 py-2 text-left">{t("exports.cols.hts")}</th>
                <th className="px-3 py-2 text-left">{t("exports.cols.tpp")}</th>
                <th className="px-3 py-2 text-left">{t("exports.cols.state")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((p) => (
                <tr key={p.id} className="border-t hover:bg-[hsl(var(--muted))]/30">
                  <td className="px-3 py-2 font-mono text-xs">{p.part_number}</td>
                  <td className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                    {p.part_description}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.part_type && p.part_type !== "NULL" ? p.part_type : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="font-mono">
                      {p.nveccn ?? "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.nv_hts ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.tpp && p.tpp !== "N/A" && p.tpp !== "NULL" ? p.tpp : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatePill state={p.state} />
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardBody className="!py-4">
        <div className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {label}
        </div>
        <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
          {value}
        </div>
      </CardBody>
    </Card>
  );
}

function StatePill({ state }: { state: string | null }) {
  if (!state || state === "NULL") return <span className="text-xs">—</span>;
  const colorMap: Record<string, string> = {
    PRODUCTION: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    RELEASED: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    P_RELEASE: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  };
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        colorMap[state] ?? "bg-[hsl(var(--muted))]",
      )}
    >
      {state}
    </span>
  );
}
