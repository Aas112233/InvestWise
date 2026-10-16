/**
 * Transaction/ledger enum-value label localization (Rule §9/§10).
 *
 * Pure and dependency-free: usable from the server report pipeline
 * (`createServerT`) and from client components (`useLocale`) alike. The
 * report document assembles these labels in `buildReportDocument` so the
 * exported files (xlsx/pdf/csv) and the in-app viewer show the same
 * localized values the transactions screen does.
 *
 * The database stores canonical English values; each mapper below translates
 * the KNOWN values and returns unknown/legacy values verbatim — stored data
 * never renders blank.
 */

type LabelT = (k: string, vars?: Record<string, string | number>) => string;

/** Canonical project lifecycle values → their i18n keys (projects.statuses.*). */
export const PROJECT_STATUS_KEYS: Record<string, string> = {
  "in progress": "projects.statuses.inProgress",
  active: "projects.statuses.inProgress",
  review: "projects.statuses.review",
  "on hold": "projects.statuses.onHold",
  cancelled: "projects.statuses.cancelled",
  canceled: "projects.statuses.cancelled",
  completed: "projects.statuses.completed",
};

/** Ledger category values (transactions.category) → enums.category.* keys. */
const CATEGORY_KEYS: Record<string, string> = {
  "Deposit": "enums.category.deposit",
  "Deposit Request": "enums.category.depositRequest",
  "Dividend": "enums.category.dividend",
  "Dividend Payout": "enums.category.dividendPayout",
  "Emergency Fund Top-up": "enums.category.emergencyFundTopUp",
  "Governance Fine": "enums.category.governanceFine",
  "Investment": "enums.category.investment",
  "Member Deposit": "enums.category.memberDeposit",
  "Monthly Deposit": "enums.category.monthlyDeposit",
  "Operations": "enums.category.operations",
  "Penalty": "enums.category.penalty",
  "Project Expense": "enums.category.projectExpense",
  "Project Funding": "enums.category.projectFunding",
  "Project Income": "enums.category.projectIncome",
  "Project Investment": "enums.category.projectInvestment",
  "Project Revenue": "enums.category.projectRevenue",
  "Project Settlement": "enums.category.projectSettlement",
  "Project Yield": "enums.category.projectYield",
  "Reserve": "enums.category.reserve",
  "Share Capital": "enums.category.shareCapital",
  "Statutory Reserve": "enums.category.statutoryReserve",
  "Withdrawal": "enums.category.withdrawal",
};

/** Fund container types (funds.type) → enums.fundType.* keys. */
const FUND_TYPE_KEYS: Record<string, string> = {
  "DEPOSIT": "enums.fundType.deposit",
  "EMERGENCY": "enums.fundType.emergency",
  "OTHER": "enums.fundType.other",
  "PRIMARY": "enums.fundType.primary",
  "PROJECT": "enums.fundType.project",
  "RESERVE": "enums.fundType.reserve",
};

/** Member roles (members.role) → enums.role.* keys. */
const ROLE_KEYS: Record<string, string> = {
  "Admin": "enums.role.admin",
  "Associate Member": "enums.role.associateMember",
  "Board Member": "enums.role.boardMember",
  "Founding Member": "enums.role.foundingMember",
  "Investor": "enums.role.investor",
  "Member": "enums.role.member",
};

/** Penalty kinds (member_penalties.type) → enums.penaltyType.* keys. */
const PENALTY_TYPE_KEYS: Record<string, string> = {
  "FINE": "enums.penaltyType.fine",
  "FUND_DEDUCTION": "enums.penaltyType.fundDeduction",
  "SUSPENSION": "enums.penaltyType.suspension",
  "VERBAL_WARNING": "enums.penaltyType.verbalWarning",
  "WRITTEN_WARNING": "enums.penaltyType.writtenWarning",
};

/** Project health (projects.health) → existing projects.health.* keys. */
const HEALTH_KEYS: Record<string, string> = {
  "Stable": "projects.health.stable",
  "At Risk": "projects.health.atRisk",
  "Critical": "projects.health.critical",
};

function mapLabel(value: string, keys: Record<string, string>, t: LabelT, keyOf?: (v: string) => string): string {
  const k = keyOf ? keyOf(value) : value;
  const path = keys[k];
  return path ? t(path, { defaultValue: value }) : value;
}

/** Ledger type values (transactions.type) → i18n keys. The five classic types
 *  reuse the transactions.type* keys the screen already uses; the rest live
 *  under enums.txType.*. Complete against the DB's distinct values. */
const TYPE_KEYS: Record<string, string> = {
  "deposit": "transactions.typeDeposit",
  "expense": "transactions.typeExpense",
  "dividend": "transactions.typeDividend",
  "dividend distribution": "enums.txType.dividendDistribution",
  "transfer": "transactions.typeTransfer",
  "transfer in": "enums.txType.transferIn",
  "transfer out": "enums.txType.transferOut",
  "earning": "transactions.typeEarning",
  "investment": "enums.txType.investment",
  "project investment": "enums.txType.projectInvestment",
  "statutory reserve": "enums.txType.statutoryReserve",
  "withdrawal": "enums.txType.withdrawal",
};

export function getTransactionTypeLabel(type: string | undefined | null, t: LabelT): string {
  if (!type) return "";
  const path = TYPE_KEYS[type.trim().toLowerCase()];
  return path ? t(path, { defaultValue: type }) : type;
}

export function getTransactionStatusLabel(status: string | undefined | null, t: LabelT): string {
  if (!status) return t("common.completed", { defaultValue: "Completed" });
  const norm = status.toLowerCase();
  // Project lifecycle values first (the generic statuses have no key for them).
  const projectKey = PROJECT_STATUS_KEYS[norm];
  if (projectKey) return t(projectKey);
  if (norm === "completed" || norm === "success" || norm === "verified") {
    return t("common.completed", { defaultValue: "Completed" });
  }
  if (norm === "pending" || norm === "processing") {
    return t("common.pending", { defaultValue: "Pending" });
  }
  if (norm === "cancelled" || norm === "canceled") {
    return t("common.cancelled", { defaultValue: "Cancelled" });
  }
  if (norm === "failed" || norm === "rejected") {
    return t("common.failed", { defaultValue: "Failed" });
  }
  if (norm === "active") {
    return t("enums.statusActive", { defaultValue: "Active" });
  }
  return status;
}

/** Ledger category (transactions.category) — "Project Revenue", "Deposit Request", … */
export function getCategoryLabel(category: string | undefined | null, t: LabelT): string {
  if (!category) return "";
  return mapLabel(category.trim(), CATEGORY_KEYS, t, (v) => v.trim());
}

/** Fund container type (funds.type) — DEPOSIT / RESERVE / … */
export function getFundTypeLabel(type: string | undefined | null, t: LabelT): string {
  if (!type) return "";
  return mapLabel(type.trim(), FUND_TYPE_KEYS, t, (v) => v.trim().toUpperCase());
}

/** Member role (members.role) — "Founding Member", "Investor", … */
export function getRoleLabel(role: string | undefined | null, t: LabelT): string {
  if (!role) return "";
  return mapLabel(role.trim(), ROLE_KEYS, t);
}

/** Penalty kind (member_penalties.type) — FINE / SUSPENSION / … */
export function getPenaltyTypeLabel(type: string | undefined | null, t: LabelT): string {
  if (!type) return "";
  return mapLabel(type.trim(), PENALTY_TYPE_KEYS, t, (v) => v.trim().toUpperCase());
}

/** Project health (projects.health) — Stable / At Risk / Critical */
export function getHealthLabel(health: string | undefined | null, t: LabelT): string {
  if (!health) return "";
  return mapLabel(health.trim(), HEALTH_KEYS, t, (v) => v.trim());
}
