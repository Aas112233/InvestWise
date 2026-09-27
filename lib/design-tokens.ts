// ERP design tokens. Components must use these semantic classes,
// never hardcoded hex values (see .agents/rules/design-system.md).
export const designTokens = {
  canvas: "bg-[#F8F9FD] dark:bg-slate-950",
  card: "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl",
  hairline: "border-slate-200 dark:border-slate-800",
  tableHeader:
    "text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider",
  label: "text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400",
  primary: "#2563EB",
  indigo: { DEFAULT: "#6366F1", dark: "#4F46E5" },
} as const;
