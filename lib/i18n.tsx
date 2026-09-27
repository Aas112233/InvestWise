"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en from "../messages/en.json";
import ur from "../messages/ur.json";
import hi from "../messages/hi.json";
import bn from "../messages/bn.json";

export type Locale = "en" | "ur" | "hi" | "bn";
export const LOCALES: Locale[] = ["en", "ur", "hi", "bn"];
export const DEFAULT_LOCALE: Locale = "en";

const dictionaries: Record<Locale, unknown> = { en, ur, hi, bn };

function lookup(dict: unknown, path: string): unknown {
  let current: unknown = dict;
  for (const key of path.split(".")) {
    if (current !== null && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : match,
  );
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (path: string, vars?: Record<string, string | number> & { defaultValue?: string }) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

const STORAGE_KEY = "investwise:locale";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "ur" || saved === "hi" || saved === "bn") {
        setLocaleState(saved);
      }
    } catch {
      // storage unavailable; keep default
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove("lang-en", "lang-ur", "lang-hi", "lang-bn");
    document.documentElement.classList.add(`lang-${locale}`);
    document.documentElement.setAttribute("lang", locale);
    document.documentElement.setAttribute("dir", locale === "ur" ? "rtl" : "ltr");
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // storage unavailable; keep in-memory only
    }
  }, []);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number> & { defaultValue?: string }): string => {
      const { defaultValue, ...placeholders } = vars ?? {};
      const value = lookup(dictionaries[locale], path) ?? lookup(dictionaries.en, path);
      if (typeof value !== "string") return defaultValue ?? path;
      return interpolate(value, placeholders);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
