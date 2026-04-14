"use client";

import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="inline-flex overflow-hidden rounded-md border text-xs">
      {(["en", "zh"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={cn(
            "px-2.5 py-1 font-medium transition-colors",
            locale === l
              ? "bg-[hsl(var(--foreground))] text-[hsl(var(--background))]"
              : "hover:bg-[hsl(var(--muted))]",
          )}
        >
          {l === "en" ? "EN" : "中文"}
        </button>
      ))}
    </div>
  );
}
