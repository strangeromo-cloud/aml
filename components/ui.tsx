"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/lib/types";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-[hsl(var(--card))] shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pt-5", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold", className)} {...props} />;
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "outline" | "solid" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        variant === "default" && "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
        variant === "outline" && "border text-[hsl(var(--muted-foreground))]",
        variant === "solid" && "bg-[hsl(var(--foreground))] text-[hsl(var(--background))]",
        className,
      )}
      {...props}
    />
  );
}

const RISK_STYLE: Record<RiskLevel, string> = {
  low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  critical: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export function RiskBadge({ level, label }: { level: RiskLevel; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        RISK_STYLE[level],
      )}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full",
        level === "low" && "bg-emerald-500",
        level === "medium" && "bg-amber-500",
        level === "high" && "bg-orange-500",
        level === "critical" && "bg-rose-500",
      )} />
      {label}
    </span>
  );
}

export function Button({
  className,
  variant = "default",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "outline";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-4 text-sm",
        variant === "default" && "bg-[hsl(var(--foreground))] text-[hsl(var(--background))] hover:opacity-90",
        variant === "ghost" && "hover:bg-[hsl(var(--muted))]",
        variant === "outline" && "border hover:bg-[hsl(var(--muted))]",
        className,
      )}
      {...props}
    />
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? "bg-rose-500" : pct >= 50 ? "bg-orange-500" : pct >= 25 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]", className)}>
      <div className={cn("h-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
