"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import en from "./en.json";
import zh from "./zh.json";
import type { Locale, LocalizedString } from "../types";

type Dict = typeof en;
const dicts: Record<Locale, Dict> = { en, zh };

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (path: string) => string;
  tl: (value: LocalizedString) => string;
};

const I18nContext = createContext<Ctx | null>(null);

function getByPath(obj: any, path: string): string {
  return path.split(".").reduce((a, k) => (a ? a[k] : undefined), obj) ?? path;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? (localStorage.getItem("locale") as Locale | null) : null;
    if (stored === "en" || stored === "zh") setLocaleState(stored);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") localStorage.setItem("locale", l);
  }, []);

  const t = useCallback((path: string) => getByPath(dicts[locale], path), [locale]);
  const tl = useCallback((v: LocalizedString) => v[locale] ?? v.en, [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t, tl }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
