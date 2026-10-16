/**
 * Locale-aware label mappers for DB-driven values on the Projects screen.
 *
 * The database stores canonical English values (e.g. "Real Estate",
 * "In Progress", "Profit Distribution"). These helpers map them to the
 * active locale's dictionary and fall back to the raw value for unknown
 * or legacy entries so nothing ever renders blank.
 */

export type TFunc = (
  path: string,
  vars?: Record<string, string | number> & { defaultValue?: string }
) => string;

// Number-formatting locale tag lives with the formatters; re-exported here so
// existing Projects-screen imports keep working.
export { intlLocaleFor } from "@/lib/formatters";

export const projectStatusLabel = (t: TFunc, status: string | null | undefined): string => {
  switch (status) {
    case "In Progress":
    case "ACTIVE":
      return t("projects.statuses.inProgress", { defaultValue: "In Progress" });
    case "Review":
      return t("projects.statuses.review", { defaultValue: "Review" });
    case "Completed":
      return t("projects.statuses.completed", { defaultValue: "Completed" });
    case "Cancelled":
      return t("projects.statuses.cancelled", { defaultValue: "Cancelled" });
    case "On Hold":
      return t("projects.statuses.onHold", { defaultValue: "On Hold" });
    default:
      return status || "-";
  }
};

export const projectSectorLabel = (t: TFunc, category: string | null | undefined): string => {
  switch (category) {
    case "Real Estate":
      return t("projects.sectors.realEstate", { defaultValue: category });
    case "Agriculture":
      return t("projects.sectors.agriculture", { defaultValue: category });
    case "Technology":
      return t("projects.sectors.technology", { defaultValue: category });
    case "Retail":
      return t("projects.sectors.retail", { defaultValue: category });
    case "Manufacturing":
      return t("projects.sectors.manufacturing", { defaultValue: category });
    case "Other":
      return t("projects.sectors.other", { defaultValue: category });
    default:
      return category || "-";
  }
};

export const projectHealthLabel = (t: TFunc, health: string | null | undefined): string => {
  const h = health || "Stable";
  switch (h) {
    case "Stable":
      return t("projects.health.stable", { defaultValue: h });
    case "At Risk":
      return t("projects.health.atRisk", { defaultValue: h });
    case "Critical":
      return t("projects.health.critical", { defaultValue: h });
    default:
      return h;
  }
};

export const projectTxLabel = (
  t: TFunc,
  category: string | null | undefined,
  type: string | null | undefined
): string => {
  const raw = category || type || "-";
  switch (raw) {
    case "Profit Distribution":
      return t("projects.txLabels.profitDistribution", { defaultValue: raw });
    case "Loss Allocation":
      return t("projects.txLabels.lossAllocation", { defaultValue: raw });
    case "Profit":
      return t("projects.txLabels.profit", { defaultValue: raw });
    case "Loss":
      return t("projects.txLabels.loss", { defaultValue: raw });
    case "Earning":
      return t("projects.txLabels.earning", { defaultValue: raw });
    case "Expense":
      return t("projects.txLabels.expense", { defaultValue: raw });
    default:
      return raw;
  }
};
