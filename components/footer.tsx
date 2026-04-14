"use client";

import { useI18n } from "@/lib/i18n/context";

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto max-w-7xl px-5 py-8 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        <p className="font-medium text-[hsl(var(--foreground))]">⚠︎ {t("disclaimer.short")}</p>
        <p className="mt-2 max-w-4xl">{t("disclaimer.full")}</p>
      </div>
    </footer>
  );
}
