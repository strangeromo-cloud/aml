"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Info, RefreshCw, Loader2 } from "lucide-react";
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

const REFRESH_COOLDOWN_MS = 60_000;
const STORAGE_KEY = "exports.lastRefresh";

type LastRefreshMap = Partial<Record<VendorKey, number>>;

function loadLastRefresh(): LastRefreshMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as LastRefreshMap;
  } catch {
    return {};
  }
}
function saveLastRefresh(m: LastRefreshMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
}

export function ExportsContent({
  nvidiaMeta,
  amdMeta,
}: {
  nvidiaMeta: NvidiaMeta;
  amdMeta: AmdMeta;
}) {
  const { t } = useI18n();
  const [vendor, setVendor] = useState<VendorKey>("nvidia");
  const [nvidia, setNvidia] = useState<NvidiaMeta>(nvidiaMeta);
  const [amd, setAmd] = useState<AmdMeta>(amdMeta);
  // null = none refreshed in session yet → use static /<vendor>-eccn.xlsx
  const [downloadVersion, setDownloadVersion] = useState<Partial<Record<VendorKey, number>>>({});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("exports.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          {t("exports.sub")}
        </p>
      </div>

      <div className="inline-flex overflow-hidden rounded-md border text-sm">
        <VendorTab
          active={vendor === "nvidia"}
          onClick={() => setVendor("nvidia")}
          label="NVIDIA"
          count={nvidia.total}
        />
        <VendorTab
          active={vendor === "amd"}
          onClick={() => setVendor("amd")}
          label="AMD"
          count={amd.total}
        />
      </div>

      {vendor === "nvidia" ? (
        <NvidiaPanel
          meta={nvidia}
          downloadVersion={downloadVersion.nvidia}
          onRefreshed={(m, version) => {
            setNvidia(m);
            setDownloadVersion((d) => ({ ...d, nvidia: version }));
          }}
        />
      ) : (
        <AmdPanel
          meta={amd}
          downloadVersion={downloadVersion.amd}
          onRefreshed={(m, version) => {
            setAmd(m);
            setDownloadVersion((d) => ({ ...d, amd: version }));
          }}
        />
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
function NvidiaPanel({
  meta,
  downloadVersion,
  onRefreshed,
}: {
  meta: NvidiaMeta;
  downloadVersion?: number;
  onRefreshed: (meta: NvidiaMeta, version: number) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      <VendorHeader
        vendor="nvidia"
        downloadHref={
          downloadVersion
            ? `/api/refresh/nvidia?type=xlsx&t=${downloadVersion}`
            : "/nvidia-eccn.xlsx"
        }
        sourceHref={meta.sourcePage}
        sourceShort="nvidia.com/…/export-regulations"
        snapshot={fmtTime(meta.fetchedAt, locale)}
        note={t("exports.nvidiaApiNote")}
        onRefreshed={(m, version) => onRefreshed(m as NvidiaMeta, version)}
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
function AmdPanel({
  meta,
  downloadVersion,
  onRefreshed,
}: {
  meta: AmdMeta;
  downloadVersion?: number;
  onRefreshed: (meta: AmdMeta, version: number) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      <VendorHeader
        vendor="amd"
        downloadHref={
          downloadVersion
            ? `/api/refresh/amd?type=xlsx&t=${downloadVersion}`
            : "/amd-eccn.xlsx"
        }
        sourceHref={meta.sourcePage}
        sourceShort="amd.com/…/trade-compliance"
        snapshot={fmtTime(meta.fetchedAt, locale)}
        note={t("exports.amdPdfNote").replace("{date}", meta.classificationDate ?? "—")}
        onRefreshed={(m, version) => onRefreshed(m as AmdMeta, version)}
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

function fmtTime(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

// =========================================================================
// Vendor header (download + source + refresh)
// =========================================================================
function VendorHeader({
  vendor,
  downloadHref,
  sourceHref,
  sourceShort,
  snapshot,
  note,
  onRefreshed,
}: {
  vendor: VendorKey;
  downloadHref: string;
  sourceHref: string;
  sourceShort: string;
  snapshot: string;
  note: string;
  onRefreshed: (meta: NvidiaMeta | AmdMeta, version: number) => void;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const [lastRefresh, setLastRefresh] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate last refresh from localStorage (avoid SSR mismatch)
  useEffect(() => {
    const map = loadLastRefresh();
    setLastRefresh(map[vendor]);
  }, [vendor]);

  // Tick every second so the cooldown countdown updates live
  useEffect(() => {
    if (!lastRefresh) return;
    const remaining = REFRESH_COOLDOWN_MS - (Date.now() - lastRefresh);
    if (remaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastRefresh]);

  const cooldownRemaining = useMemo(() => {
    if (!lastRefresh) return 0;
    return Math.max(0, REFRESH_COOLDOWN_MS - (now - lastRefresh));
  }, [lastRefresh, now]);
  const cooldownActive = cooldownRemaining > 0;

  async function onRefresh() {
    if (cooldownActive || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/refresh/${vendor}?type=meta&t=${Date.now()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { meta: NvidiaMeta | AmdMeta };
      const ts = Date.now();
      onRefreshed(body.meta, ts);
      const map = loadLastRefresh();
      map[vendor] = ts;
      saveLastRefresh(map);
      setLastRefresh(ts);
      setNow(ts);
    } catch (e: any) {
      setError(e?.message ?? "Refresh failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody className="flex flex-wrap items-start gap-3">
        <a
          href={downloadHref}
          download
          className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--foreground))] px-4 py-2 text-sm font-semibold text-[hsl(var(--background))] shadow-sm transition-opacity hover:opacity-90"
        >
          <Download className="h-4 w-4" />
          {t("exports.downloadXlsx")}
        </a>
        <button
          onClick={onRefresh}
          disabled={cooldownActive || loading}
          title={
            cooldownActive
              ? t("exports.refreshCooldown").replace(
                  "{seconds}",
                  Math.ceil(cooldownRemaining / 1000).toString(),
                )
              : t("exports.refreshTip")
          }
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-60",
            !cooldownActive && !loading && "hover:bg-[hsl(var(--muted))]",
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className={cn("h-4 w-4", cooldownActive && "opacity-60")} />
          )}
          <span>
            {loading
              ? t("exports.refreshing")
              : cooldownActive
                ? t("exports.refreshCooldown").replace(
                    "{seconds}",
                    Math.ceil(cooldownRemaining / 1000).toString(),
                  )
                : t("exports.refreshNow")}
          </span>
        </button>
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
            {error && (
              <div className="text-xs text-rose-600 dark:text-rose-400">
                {t("exports.refreshError").replace("{error}", error)}
              </div>
            )}
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
