"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { LanguageSwitcher } from "./language-switcher";
import { cn } from "@/lib/utils";
import { Radar } from "lucide-react";

export function Header() {
  const { t } = useI18n();
  const path = usePathname() ?? "/";
  const links = [
    { href: "/", label: t("nav.home") },
    { href: "/companies", label: t("nav.companies") },
    { href: "/methodology", label: t("nav.methodology") },
    { href: "/sources", label: t("nav.sources") },
  ];
  return (
    <header className="sticky top-0 z-10 border-b bg-[hsl(var(--background))]/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Radar className="h-5 w-5" />
          <span className="text-sm">{t("appName")}</span>
        </Link>
        <nav className="hidden gap-1 text-sm sm:flex">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  active
                    ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
