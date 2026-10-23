"use client";

import { useLocale } from "@/lib/i18n";

const SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/** Formats a YYYY-MM period key (deposit month, arrears period) in the app language. */
export function useMonthLabel() {
  const { t } = useLocale();
  return (key: string): string => {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return key;
    const short = SHORT[Number(m[2]) - 1] ?? "jan";
    return `${t(`common.months.${short}`)} ${m[1]}`;
  };
}
