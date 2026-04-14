"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DataSource, DimensionScore } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { Progress } from "./ui";

const DIMENSION_BAR_COLOR = (score: number) =>
  score >= 70 ? "bg-rose-500" : score >= 50 ? "bg-orange-500" : score >= 25 ? "bg-amber-500" : "bg-emerald-500";

export function DimensionCard({
  dimension,
  sources,
  defaultOpen = false,
}: {
  dimension: DimensionScore;
  sources: Record<string, DataSource>;
  defaultOpen?: boolean;
}) {
  const { t, tl } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border bg-[hsl(var(--card))]">
      <button
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[hsl(var(--muted))]/50"
        onClick={() => setOpen((o) => !o)}
      >
        <div className={cn("h-10 w-1.5 rounded-full", DIMENSION_BAR_COLOR(dimension.score))} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <div className="font-semibold">{tl(dimension.name)}</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))]">
              {t("company.weight")} {(dimension.weight * 100).toFixed(0)}%
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="font-mono text-sm font-semibold tabular-nums">{dimension.score}</span>
            <Progress value={dimension.score} className="max-w-md" />
          </div>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="border-t bg-[hsl(var(--muted))]/30 px-5 py-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {t("company.factorsHeader")}
          </div>
          <div className="space-y-4">
            {dimension.factors.map((f) => (
              <div key={f.id} className="rounded-md border bg-[hsl(var(--card))] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{tl(f.name)}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{tl(f.displayValue)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-semibold tabular-nums">{f.score}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">
                      {t("company.weight")} {Math.round(f.weightWithinDimension * 100)}%
                    </div>
                  </div>
                </div>
                <Progress value={f.score} className="mt-2" />
                <div className="mt-3 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                  <span className="font-semibold text-[hsl(var(--foreground))]">
                    {t("company.rationale")}:
                  </span>{" "}
                  {tl(f.rationale)}
                </div>
                {f.sourceIds.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                      {t("company.sources")}:
                    </span>
                    {f.sourceIds.map((sid) => {
                      const s = sources[sid];
                      if (!s) return null;
                      return (
                        <a
                          key={sid}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors hover:border-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                          title={`${s.authority} · ${s.snapshotDate}`}
                        >
                          {s.authority}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
