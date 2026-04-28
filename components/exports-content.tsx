"use client";

import { useState } from "react";
import { Download, ExternalLink, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "./ui";

type NvidiaMeta = {
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
type AmdMeta = {
  total: number;
  fetchedAt: string;
  classificationDate: string | null;
  sourcePage: string;
  pdfUrl: string;
  distinctEccn: number;
  distinctHs: number;
  distinctCcats: number;
  topEccn: { eccn: string; count: number }[];
  topHs: { hs: string; count: number }[];
  meets3A090: { meets: string; count: number }[];
};

type VendorKey = "nvidia" | "amd";

export function ExportsContent({
  nvidiaMeta,
  amdMeta,
}: {
  nvidiaMeta: NvidiaMeta;
  amdMeta: AmdMeta;
}) {
  const { t } = useI18n();
  const [vendor, setVendor] = useState<VendorKey>("nvidia");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("exports.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          {t("exports.sub")}
        </p>
      </div>

      {/* Tab switcher */}
      <div className="inline-flex overflow-hidden rounded-md border text-sm">
        <VendorTab
          active={vendor === "nvidia"}
          onClick={() => setVendor("nvidia")}
          label="NVIDIA"
          count={nvidiaMeta.total}
        />
        <VendorTab
          active={vendor === "amd"}
          onClick={() => setVendor("amd")}
          label="AMD"
          count={amdMeta.total}
        />
      </div>

      {vendor === "nvidia" ? (
        <NvidiaPanel meta={nvidiaMeta} />
      ) : (
        <AmdPanel meta={amdMeta} />
      )}
    </div>
  );
}

function VendorTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 font-medium transition-colors",
        active
          ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))]"
          : "hover:bg-[hsl(var(--muted))]",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[11px] font-mono",
          active ? "bg-white/20" : "bg-[hsl(var(--muted))]",
        )}
      >
        {count.toLocaleString()}
      </span>
    </button>
  );
}

// =========================================================================
// NVIDIA PANEL
// =========================================================================
function NvidiaPanel({ meta }: { meta: NvidiaMeta }) {
  const { t, locale } = useI18n();
  return (
    <>
      <VendorHeader
        downloadHref="/nvidia-eccn.xlsx"
        sourceHref={meta.sourcePage}
        sourceShort="nvidia.com/…/export-regulations"
        snapshot={new Date(meta.fetchedAt).toLocaleString(
          locale === "zh" ? "zh-CN" : "en-US",
          { timeZone: "UTC", timeZoneName: "short" },
        )}
        note={t("exports.nvidiaApiNote")}
      />
      <DistributionPair
        titleLeft={t("exports.eccnDistTitle")}
        leftBars={meta.topEccn.map((r) => ({ label: r.eccn, count: r.count, total: meta.total }))}
        titleRight={t("exports.htsDistTitle")}
        rightBars={meta.topHts.map((r) => ({ label: r.hts, count: r.count, total: meta.total }))}
      />
    </>
  );
}

// =========================================================================
// AMD PANEL
// =========================================================================
function AmdPanel({ meta }: { meta: AmdMeta }) {
  const { t, locale } = useI18n();
  return (
    <>
      <VendorHeader
        downloadHref="/amd-eccn.xlsx"
        sourceHref={meta.sourcePage}
        sourceShort="amd.com/…/trade-compliance"
        snapshot={new Date(meta.fetchedAt).toLocaleString(
          locale === "zh" ? "zh-CN" : "en-US",
          { timeZone: "UTC", timeZoneName: "short" },
        )}
        note={t("exports.amdPdfNote").replace("{date}", meta.classificationDate ?? "—")}
      />
      <DistributionPair
        titleLeft={t("exports.eccnDistTitle")}
        leftBars={meta.topEccn.map((r) => ({ label: r.eccn, count: r.count, total: meta.total }))}
        titleRight={t("exports.htsDistTitle")}
        rightBars={meta.topHs.map((r) => ({ label: r.hs, count: r.count, total: meta.total }))}
      />
    </>
  );
}

// =========================================================================
// Shared sub-components
// =========================================================================
function VendorHeader({
  downloadHref,
  sourceHref,
  sourceShort,
  snapshot,
  note,
}: {
  downloadHref: string;
  sourceHref: string;
  sourceShort: string;
  snapshot: string;
  note: string;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardBody className="flex flex-wrap items-start gap-4">
        <a
          href={downloadHref}
          download
          className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--foreground))] px-4 py-2 text-sm font-semibold text-[hsl(var(--background))] shadow-sm transition-opacity hover:opacity-90"
        >
          <Download className="h-4 w-4" />
          {t("exports.downloadXlsx")}
        </a>
        <div className="flex flex-1 items-start gap-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <div className="flex-1 space-y-1">
            <div>
              <span className="text-[hsl(var(--muted-foreground))]">
                {t("exports.sourceLabel")}:{" "}
              </span>
              <a
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                {sourceShort}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="text-xs text-[hsl(var(--muted-foreground))]">
              {t("exports.snapshotAt")}: {snapshot} · {note}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function DistributionPair({
  titleLeft,
  leftBars,
  titleRight,
  rightBars,
}: {
  titleLeft: string;
  leftBars: { label: string; count: number; total: number }[];
  titleRight: string;
  rightBars: { label: string; count: number; total: number }[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{titleLeft}</CardTitle>
        </CardHeader>
        <CardBody>
          <BarList rows={leftBars} colorClass="bg-sky-500/40" />
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{titleRight}</CardTitle>
        </CardHeader>
        <CardBody>
          <BarList rows={rightBars} colorClass="bg-violet-500/40" />
        </CardBody>
      </Card>
    </div>
  );
}

function BarList({
  rows,
  colorClass,
}: {
  rows: { label: string; count: number; total: number }[];
  colorClass: string;
}) {
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => {
        const pct = (r.count / r.total) * 100;
        return (
          <li key={r.label} className="flex items-center gap-3">
            <span className="w-28 font-mono text-xs">{r.label}</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-[hsl(var(--muted))]">
              <div className={colorClass + " h-full"} style={{ width: `${pct}%` }} />
              <span className="absolute inset-0 flex items-center justify-end pr-2 font-mono text-[11px]">
                {r.count.toLocaleString()} ({pct.toFixed(1)}%)
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

