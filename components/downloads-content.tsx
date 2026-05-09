"use client";

import Link from "next/link";
import { Download, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "./ui";

type SourceEntry = {
  name: string;
  url: string;
  outputFile: string;
  startedAt: string;
  status: "success" | "error";
  records?: number;
  error?: string;
  finishedAt: string;
};

type Manifest = {
  updatedAt: string | null;
  totalFetchers: number;
  successCount: number;
  failureCount: number;
  sources: Record<string, SourceEntry>;
};

const SIZE_HINTS: Record<string, string> = {
  "fatf-jurisdictions.xlsx": "~10 KB",
  "ofac-country-programs.xlsx": "~10 KB",
  "un-consolidated.xlsx": "~150 KB",
  "eu-consolidated.xlsx": "~750 KB",
  "basel-aml-index.xlsx": "~10 KB",
  "ti-cpi.xlsx": "~12 KB",
  "wjp-rule-of-law.xlsx": "~22 KB",
  "tjn-fsi.xlsx": "~15 KB",
};

function fmtTime(iso: string | null, locale: "en" | "zh") {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function publicHref(outputFile: string): string {
  // outputFile looks like "public/downloads/foo.xlsx" — strip leading "public/"
  return "/" + outputFile.replace(/^public\//, "");
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

export function DownloadsContent({ manifest }: { manifest: Manifest }) {
  const { t, locale } = useI18n();

  const sourceList = Object.entries(manifest.sources);
  const successList = sourceList.filter(([, v]) => v.status === "success");
  const errorList = sourceList.filter(([, v]) => v.status !== "success");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("downloads.title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
            {t("downloads.sub")}
          </p>
        </div>
        <div className="text-sm text-right">
          <div className="font-medium">
            {t("downloads.lastRun")}: {fmtTime(manifest.updatedAt, locale)}
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            {t("downloads.successOf")
              .replace("{success}", String(manifest.successCount))
              .replace("{total}", String(manifest.totalFetchers))}
          </div>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          color="emerald"
          icon={<CheckCircle2 className="h-4 w-4" />}
          label={t("downloads.stat.success")}
          value={manifest.successCount}
        />
        <StatCard
          color={manifest.failureCount > 0 ? "rose" : "muted"}
          icon={<AlertCircle className="h-4 w-4" />}
          label={t("downloads.stat.failures")}
          value={manifest.failureCount}
        />
        <StatCard
          color="sky"
          icon={<Download className="h-4 w-4" />}
          label={t("downloads.stat.total")}
          value={manifest.totalFetchers}
        />
      </div>

      {/* Success list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {t("downloads.availableTitle")}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {successList.map(([id, src]) => {
            const file = basename(src.outputFile);
            const href = publicHref(src.outputFile);
            const sizeHint = SIZE_HINTS[file] ?? "";
            return (
              <Card key={id}>
                <CardBody className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{src.name}</div>
                      <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        <span className="font-mono">{id}</span>
                        {" · "}
                        {src.records?.toLocaleString() ?? "—"}{" "}
                        {t("downloads.records")}
                        {sizeHint && (
                          <span className="text-[hsl(var(--muted-foreground))]"> · {sizeHint}</span>
                        )}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      {t("downloads.fresh")}
                    </span>
                  </div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">
                    {t("downloads.fetchedAt")}: {fmtTime(src.finishedAt, locale)}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={href}
                      download
                      className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--foreground))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--background))] shadow-sm transition-opacity hover:opacity-90"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t("downloads.downloadXlsx")}
                    </a>
                    {src.url && (
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t("downloads.upstream")}
                      </a>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Error list (only if any) */}
      {errorList.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            {t("downloads.failuresTitle")}
          </h2>
          <div className="space-y-2">
            {errorList.map(([id, src]) => (
              <Card key={id} className="border-rose-500/30 bg-rose-500/5">
                <CardBody>
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{src.name}</div>
                      <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        <span className="font-mono">{id}</span>
                        {" · "}
                        {t("downloads.failedAt")}: {fmtTime(src.finishedAt, locale)}
                      </div>
                      <div className="mt-2 rounded-md border bg-[hsl(var(--card))] px-2 py-1 font-mono text-[11px] text-rose-700 dark:text-rose-300">
                        {src.error}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardBody className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
          {t("downloads.howItWorks")}
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({
  color,
  icon,
  label,
  value,
}: {
  color: "emerald" | "rose" | "sky" | "muted";
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const colorClass = {
    emerald: "text-emerald-700 dark:text-emerald-300",
    rose: "text-rose-700 dark:text-rose-300",
    sky: "text-sky-700 dark:text-sky-300",
    muted: "text-[hsl(var(--muted-foreground))]",
  }[color];
  return (
    <Card>
      <CardBody className="!py-4">
        <div className={cn("flex items-center gap-1.5 text-xs uppercase tracking-wider", colorClass)}>
          {icon}
          <span>{label}</span>
        </div>
        <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      </CardBody>
    </Card>
  );
}
