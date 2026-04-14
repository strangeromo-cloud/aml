"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Fuse from "fuse.js";
import type { Company } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { CountryFlag } from "./country-flag";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

export function SearchBar({ companies, compact = false }: { companies: Company[]; compact?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(companies, {
        keys: ["name", "nameZh", "legalName", "industry", "hqCountry"],
        threshold: 0.35,
        distance: 80,
      }),
    [companies],
  );

  const hits = useMemo(() => {
    if (!query.trim()) return [];
    return fuse.search(query.trim()).slice(0, 8).map((r) => r.item);
  }, [fuse, query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function go(company: Company) {
    setOpen(false);
    setQuery("");
    router.push(`/company/${company.id}`);
  }

  return (
    <div ref={wrapRef} className={cn("relative w-full", compact ? "max-w-md" : "max-w-2xl")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
        <input
          className={cn(
            "w-full rounded-lg border bg-[hsl(var(--card))] pl-9 pr-4 text-sm shadow-sm",
            "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--foreground))]/20",
            compact ? "h-9" : "h-12 text-base",
          )}
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (hits[activeIdx]) go(hits[activeIdx]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-[hsl(var(--card))] shadow-lg">
          {hits.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
              {t("search.noResults")}
            </div>
          ) : (
            <ul role="listbox">
              {hits.map((c, i) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm",
                    i === activeIdx ? "bg-[hsl(var(--muted))]" : "",
                  )}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => go(c)}
                >
                  <CountryFlag code={c.hqCountry} className="text-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {locale === "zh" && c.nameZh ? c.nameZh : c.name}
                    </div>
                    <div className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {c.id} · {c.industry} · {c.relationship}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
