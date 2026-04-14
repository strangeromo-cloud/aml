"use client";

import type { RiskLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLOR: Record<RiskLevel, string> = {
  low: "stroke-emerald-500",
  medium: "stroke-amber-500",
  high: "stroke-orange-500",
  critical: "stroke-rose-500",
};

export function RiskGauge({
  score,
  level,
  size = 180,
}: {
  score: number;
  level: RiskLevel;
  size?: number;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="stroke-[hsl(var(--muted))] fill-none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          className={cn(COLOR[level], "fill-none transition-all")}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-4xl font-bold tabular-nums">{score}</div>
        <div className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          / 100
        </div>
      </div>
    </div>
  );
}
