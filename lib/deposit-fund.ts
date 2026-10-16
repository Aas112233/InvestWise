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

/** §11-formatted message shared by every write path that rejects the fund. */
export const DEPOSIT_FUND_REQUIRED_MESSAGE =
  "[Field 'fundId', Code: INVALID_FUND_TYPE] Member deposits can only be recorded against a DEPOSIT-type fund.";

export function isDepositFund(fund: { type?: string | null } | null | undefined): boolean {
  return String(fund?.type ?? '').toUpperCase() === DEPOSIT_FUND_TYPE;
}
