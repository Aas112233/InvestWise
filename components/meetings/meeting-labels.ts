import type { useLocale } from "@/lib/i18n";

type Translate = ReturnType<typeof useLocale>["t"];

function toCamelKey(raw: string): string {
  return raw
    .toLowerCase()
    .split("_")
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

function humanize(raw: string): string {
  return raw.replace(/_/g, " ");
}

function titleCase(raw: string): string {
  return raw
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Meeting types are tenant-configurable free text, so an unknown key must
// still render something instead of a missing-translation path.
export function meetingTypeLabel(t: Translate, typeKey?: string | null): string {
  if (!typeKey) return "";
  return t(`meetings.types.${toCamelKey(typeKey)}`, { defaultValue: "" }) || titleCase(typeKey);
}

export function meetingStatusLabel(t: Translate, status: string): string {
  return t(`meetings.statuses.${toCamelKey(status)}`, { defaultValue: "" }) || humanize(status);
}
