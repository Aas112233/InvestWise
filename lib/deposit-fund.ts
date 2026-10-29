/**
 * Which fund containers accept member deposits.
 *
 * `funds.type` is only constrained by the DB's funds_type_check, and until now
 * nothing on the deposit write path looked at it: every fund the tenant owns
 * appeared in the deposit / request-deposit pickers, so a member deposit could
 * be posted straight into a PROJECT or RESERVE fund and be counted as that
 * container's own money. The pickers now offer DEPOSIT funds only (§4), and
 * this predicate is the rule behind that (§6/§8 — the client filter is
 * convenience, the server check is the enforcement).
 */

/** The only fund type a member deposit may be recorded against. */
export const DEPOSIT_FUND_TYPE = 'DEPOSIT';

/**
 * Canonical ledger category (`transactions.category`) for deposit money.
 *
 * Declared here rather than inline at each write because the value had become
 * uncontrolled free text: the direct record path wrote `'Deposit'`, the bulk
 * service wrote nothing at all (so the column stayed NULL), the request paths
 * wrote `'Deposit Request'` and approval never rewrote it, and legacy seeds had
 * `'Member Deposit'` / `'Monthly Deposit'`. Roughly 2,000 of ~2,050 deposit rows
 * therefore failed to read as deposits in the report's Category column.
 *
 * Ledger *totals* were never wrong — every report filter keys on
 * `type` + `status` (`SETTLED_DEPOSIT_STATUSES`), not category — but the
 * pending-request exclusion in GET /api/deposits and the month-release rule in
 * the finance service DO test category, so a settled row still labelled as a
 * request is a live inconsistency, not just cosmetics.
 */
export const DEPOSIT_CATEGORY = 'Deposit';

/** Category of an unsettled, member-submitted deposit slip. */
export const DEPOSIT_REQUEST_CATEGORY = 'Deposit Request';

/** §11-formatted message shared by every write path that rejects the fund. */
export const DEPOSIT_FUND_REQUIRED_MESSAGE =
  "[Field 'fundId', Code: INVALID_FUND_TYPE] Member deposits can only be recorded against a DEPOSIT-type fund.";

export function isDepositFund(fund: { type?: string | null } | null | undefined): boolean {
  return String(fund?.type ?? '').toUpperCase() === DEPOSIT_FUND_TYPE;
}
