/**
 * Money math — integer-cents core. NEVER use float arithmetic for money.
 *
 * Every monetary value crossing the DB boundary is a `decimal(15,2)` string.
 * Internally we always compute in integer cents; all helpers here round
 * half-away-from-zero at 2dp and reject non-finite input.
 *
 * Server-side the same discipline is enforced by Postgres `decimal(15,2)`
 * columns and numeric SQL updates; client-side totals are display-only.
 */

const CENTS = 100;
/**
 * Money-module ceiling, exported so EVERY write path enforces the same one.
 * It used to be private here and re-declared inside POST /api/deposits, which
 * is how POST /api/deposits/request ended up with no ceiling at all: a request
 * for more than the cap can be filed and then approved into the ledger without
 * ever passing the check a direct deposit would have failed.
 */
export const MAX_AMOUNT = 10_000_000; // matches server validation ceiling
const DEC15_2 = /^-?\d{1,13}(\.\d{1,2})?$/;

export class MoneyError extends Error {
  code: string;
  constructor(message: string, code = "MONEY_ERROR") {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

/** Parse a decimal(15,2) string (or finite number) into integer cents. */
export function toCents(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MoneyError("Non-finite amount");
    // Guard the float path: only accept values that are already safe at 2dp
    const rounded = Math.round(value * CENTS);
    if (Math.abs(value * CENTS - rounded) > 1e-6) {
      throw new MoneyError("Amount has more than 2 decimal places", "PRECISION_LOSS");
    }
    return rounded;
  }
  const trimmed = value.trim();
  if (!DEC15_2.test(trimmed)) {
    throw new MoneyError(`Invalid decimal(15,2) value: "${value}"`, "INVALID_DECIMAL");
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const fracCents = Number(fracPart.padEnd(2, "0").slice(0, 2) || "0");
  const cents = Number(intPart) * CENTS + fracCents;
  return negative ? -cents : cents;
}

/** Format integer cents back to a decimal(15,2) string. */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new MoneyError("Cents value must be an integer");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const intPart = String(Math.floor(abs / CENTS));
  const frac = String(abs % CENTS).padStart(2, "0");
  return `${negative ? "-" : ""}${intPart}.${frac}`;
}

/** Round any finite number to integer cents, half-away-from-zero. */
export function roundToCents(value: number): number {
  if (!Number.isFinite(value)) throw new MoneyError("Non-finite amount");
  return value >= 0
    ? Math.floor(value * CENTS + 0.5)
    : Math.ceil(value * CENTS - 0.5);
}

/** Sum integer cents exactly. */
export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => {
    if (!Number.isInteger(v)) throw new MoneyError("sumCents expects integer cents");
    return acc + v;
  }, 0);
}

/**
 * Validate a transaction amount server-side: must be > 0, at most 2dp,
 * within the configured ceiling. Returns integer cents.
 */
export function parsePositiveAmount(
  value: string | number,
  { minCents = 1, maxCents = MAX_AMOUNT * CENTS, field = "amount" } = {},
): number {
  const cents = toCents(value);
  if (!Number.isInteger(cents)) throw new MoneyError(`${field} precision error`, "PRECISION_LOSS");
  if (cents < minCents) throw new MoneyError(`${field} must be greater than zero`, "INVALID_AMOUNT");
  if (cents > maxCents) throw new MoneyError(`${field} exceeds the maximum allowed`, "AMOUNT_TOO_LARGE");
  return cents;
}

/**
 * Shares-weighted dividend split in exact cents.
 * Deterministic largest-remainder method: every recipient gets floor-based
 * cents, leftovers are handed out one cent at a time to the highest
 * fractional remainder (ties broken by lower member id for determinism).
 * Guarantees sum(payouts) <= totalCents and residual >= 0.
 */
export function splitDividendByShares(
  totalCents: number,
  members: Array<{ id: string; shares: number }>,
): Array<{ id: string; shares: number; payoutCents: number }> {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new MoneyError("Total dividend must be a positive integer-cent amount", "INVALID_AMOUNT");
  }
  const eligible = members
    .filter((m) => Number.isInteger(m.shares) && m.shares > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const totalShares = eligible.reduce((sum, m) => sum + m.shares, 0);
  if (totalShares <= 0) {
    throw new MoneyError("No active shares available for distribution", "NO_SHARES");
  }

  const base = eligible.map((m) => ({
    ...m,
    exact: (totalCents * m.shares) / totalShares,
    payoutCents: Math.floor((totalCents * m.shares) / totalShares),
  }));

  let distributed = base.reduce((sum, m) => sum + m.payoutCents, 0);
  const residual = totalCents - distributed;
  const order = base
    .map((m, i) => ({ i, frac: m.exact - m.payoutCents }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; k < residual; k++) {
    const target = order[k % order.length];
    if (target !== undefined) {
      const entry = base[target.i];
      if (entry !== undefined) {
        entry.payoutCents += 1;
        distributed += 1;
      }
    }
  }

  return base.map(({ id, shares, payoutCents }) => ({ id, shares, payoutCents }));
}

/**
 * Split a total into EQUAL integer-cent parts — the residue dealt one cent at a
 * time in ascending id order, so the result is deterministic and conserves the
 * total exactly (`Σ parts === totalCents` by construction).
 *
 * This is the one weight a percentage split cannot express: several members
 * sharing a single contract carve-out equally (docs/PROJECT-TYPES_PLAN.md D4 —
 * the Project Level Members of one Extra Investor project). Ids are deduped and
 * id-sorted, the same determinism contract as `splitDividendByShares`; ties go
 * to the lowest id because with equal weights every remainder is equal.
 */
export function splitEvenlyCents(totalCents: number, ids: string[]): Map<string, number> {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new MoneyError("Total must be a non-negative integer-cent amount", "INVALID_AMOUNT");
  }
  const unique = [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (unique.length === 0) {
    if (totalCents > 0) {
      throw new MoneyError("No participants to split the amount across", "NO_ENTRIES");
    }
    return new Map();
  }

  const base = Math.floor(totalCents / unique.length);
  let residue = totalCents - base * unique.length;

  const out = new Map<string, number>();
  for (const id of unique) {
    if (residue > 0) {
      out.set(id, base + 1);
      residue -= 1;
    } else {
      out.set(id, base);
    }
  }
  return out;
}

/**
 * Parse a percentage (0 < p <= 100, at most 2 decimal places) into integer
 * basis points (1% = 100 bp, 100% = 10_000 bp). Uses the same 2dp decimal
 * discipline as money — "20.5" -> 2050, "0" / "100.01" -> MoneyError.
 */
export function parsePercentBp(value: string | number, field = "percent"): number {
  const bp = toCents(typeof value === "number" ? String(value) : value);
  if (!Number.isInteger(bp)) throw new MoneyError(`${field} precision error`, "PRECISION_LOSS");
  if (bp <= 0) throw new MoneyError(`${field} must be greater than zero`, "INVALID_PERCENT");
  if (bp > 10_000) throw new MoneyError(`${field} must be at most 100`, "INVALID_PERCENT");
  return bp;
}

/**
 * Exact inverse of `parsePercentBp`: integer basis points → fixed-2dp percent
 * string for storage/display ("2050" -> "20.50"). The integer→string step
 * keeps every producer of percent decimals on the same no-float path — the
 * caller never hand-writes `bp / 100` and risks a 1e-13 tail in a decimal
 * column (the same reason `fromCents` owns money formatting).
 */
export function formatPercentBp(bp: number): string {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) {
    throw new MoneyError("Percent basis points must be an integer in [0, 10000]", "INVALID_PERCENT");
  }
  const whole = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

/**
 * Percentage-weighted split in exact cents, the percent twin of
 * `splitDividendByShares`.
 *
 * `weights` are integer basis points (20.50% -> 2050). The block for this
 * weight set is `round(totalCents * sumWeights / 10000)` (half-up), then each
 * entry gets floor(blockCents * w_i / sumWeights) with the leftover cents
 * dealt one at a time by largest fractional remainder, ties broken by lower
 * id — identical determinism contract to the shares split:
 * `sum(payouts) === blockCents` and entries are id-sorted.
 */
export function splitByPercent(
  totalCents: number,
  weights: Array<{ id: string; bp: number }>,
): Array<{ id: string; bp: number; payoutCents: number }> {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new MoneyError("Total must be a positive integer-cent amount", "INVALID_AMOUNT");
  }
  if (weights.length === 0) {
    throw new MoneyError("No weighted entries to split", "NO_ENTRIES");
  }
  for (const w of weights) {
    if (!Number.isInteger(w.bp) || w.bp <= 0 || w.bp > 10_000) {
      throw new MoneyError("Each weight must be an integer basis-point percent in (0, 10000]", "INVALID_PERCENT");
    }
  }
  const sumBp = weights.reduce((acc, w) => acc + w.bp, 0);
  if (sumBp > 10_000) {
    throw new MoneyError("Percentages must not exceed 100% in total", "PERCENT_SUM_EXCEEDED");
  }

  // Block this weight set claims from the total (exact for sumBp = 10000).
  const blockCents = Math.floor((totalCents * sumBp) / 10_000 + 0.5);

  const sorted = [...weights].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const base = sorted.map((w) => {
    const exact = (blockCents * w.bp) / sumBp;
    return { ...w, exact, payoutCents: Math.floor(exact) };
  });

  let distributed = base.reduce((acc, e) => acc + e.payoutCents, 0);
  const residual = blockCents - distributed;
  const order = base
    .map((e, i) => ({ i, frac: e.exact - e.payoutCents }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; k < residual; k++) {
    const target = order[k % order.length];
    if (target !== undefined) {
      const entry = base[target.i];
      if (entry !== undefined) {
        entry.payoutCents += 1;
        distributed += 1;
      }
    }
  }

  if (distributed !== blockCents) {
    throw new MoneyError("Percent split does not reconcile", "SPLIT_UNBALANCED");
  }

  return base.map(({ id, bp, payoutCents }) => ({ id, bp, payoutCents }));
}

/**
 * Category-weighted split in exact cents: the member pool of a profit/loss leg
 * (or the net of a dividend run) is carved into per-category blocks, and inside
 * each category the money splits pro-rata by share number.
 * `docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md` owns the semantics; this is the ONE
 * place they are computed, so server runs and modal previews cannot drift.
 *
 * Chain (all integer cents, deterministic like `splitDividendByShares`):
 *  1. eligible = members with integer shares > 0 (0-share members can neither be
 *     paid nor absorb loss — unchanged behavior);
 *  2. empty rules, or no configured category present in `members`, reduces to
 *     `splitDividendByShares` exactly — backward compatibility by construction;
 *  3. each configured category PRESENT in the pool gets
 *     `round(pool × bp / 10000)` via `splitByPercent` (largest remainder across
 *     categories, so the blocks reconcile); a configured category with no
 *     members here (e.g. Project Member in a club dividend) claims nothing and
 *     its percent falls into the remainder;
 *  4. inside a category: `splitDividendByShares(block, membersOfCategory)`;
 *     a 0-cent block pays its members 0 (never throws NO_SHARES);
 *  5. remainder = pool − Σblocks goes pro-rata by shares among the eligible
 *     members whose category is UNCONFIGURED; if every eligible member's
 *     category is configured, it goes pro-rata among ALL eligible members —
 *     conservation first: the caller debits the full leg, so no cent may go
 *     un-booked;
 *  6. Σ payouts === totalCents is asserted, like `splitByPercent` does.
 */
export interface TypeWeightedMember {
  id: string;
  shares: number;
  role: string;
}

export interface TypeSplitBlock {
  role: string;
  bp: number;
  amountCents: number;
  memberCount: number;
}

export interface TypeSplitOutcome {
  /** One entry per ELIGIBLE member (shares > 0), id-sorted; may pay 0. */
  payouts: Array<{ id: string; shares: number; payoutCents: number }>;
  /** Per present-and-configured category: what it claimed and who is inside it. */
  typeBlocks: TypeSplitBlock[];
  /** What the no-category carve-out distributed (invariant: total − Σ blocks). */
  remainderCents: number;
}

export interface LossClampOutcome {
  /** Applied debit per member id. Never exceeds that member's available equity. */
  appliedCents: Map<string, number>;
  /** Requested minus applied — the loss nobody had equity left to absorb. */
  unabsorbedCents: number;
}

/**
 * Cap a loss distribution at each member's available equity, re-allocating any
 * shortfall to members that still have equity left.
 *
 * A member can never have more debited than their recorded equity, so the naive
 * pro-rata split has to be clamped: a member whose share exceeds their equity
 * absorbs only what they have, and the remainder is redistributed across the
 * rest. Each pass fully consumes at least one member's equity, so the loop is
 * bounded by the member count; the final clamp guarantees the invariant even if
 * the re-allocation engine disagrees.
 *
 * `requestedCents` is the pro-rata result. `equityCents` is the RUNNING equity
 * per member — in a Both run it already includes the profit just credited.
 * `reallocate` is injected so this stays a pure function of its inputs: the
 * caller passes `splitByTypeAndShares`-backed re-splitting, tests pass a plain
 * pro-rata. It receives the shortfall and the members that still have equity.
 */
export function clampLossToEquity(
  requestedCents: Map<string, number>,
  equityCents: Map<string, number>,
  reallocate: (
    shortfallCents: number,
    candidates: Array<{ id: string; shares: number }>,
  ) => Array<{ id: string; payoutCents: number }>,
  sharesOf: Map<string, number>,
): LossClampOutcome {
  const applied = new Map(requestedCents);
  const remaining = new Map(equityCents);
  // Members already clamped to their equity. They are excluded from later
  // over-cap passes: their remaining equity is 0 by definition, so testing
  // them again would read a correct debit as still over the cap and zero it.
  const settled = new Set<string>();
  // Shortfall that no remaining member had equity to absorb. Reported to the
  // caller instead of being silently dropped — §12 requires that the cents that
  // were not written down are known.
  let strandedCents = 0;

  for (let pass = 0; pass < sharesOf.size + 1; pass++) {
    const overCap = [...applied.entries()].filter(
      ([id, cents]) => !settled.has(id) && cents > (remaining.get(id) ?? 0),
    );
    if (overCap.length === 0) break;

    let shortfall = 0;
    for (const [id, cents] of overCap) {
      // Whatever this member was asked for beyond their equity moves to the
      // pool for re-allocation; they keep exactly what the equity backs.
      const cap = remaining.get(id) ?? 0;
      shortfall += cents - cap;
      applied.set(id, cap);
      remaining.set(id, 0);
      settled.add(id);
    }

    // Only members with BOTH unspent equity and shares can take the shortfall.
    const candidates = [...remaining.entries()]
      .filter(([id, cents]) => !settled.has(id) && cents > 0 && (sharesOf.get(id) ?? 0) > 0)
      .map(([id]) => ({ id, shares: sharesOf.get(id) ?? 0 }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (candidates.length === 0) {
      strandedCents += shortfall;
      break;
    }

    for (const p of reallocate(shortfall, candidates)) {
      applied.set(p.id, (applied.get(p.id) ?? 0) + p.payoutCents);
    }
  }

  // Final unconditional clamp: whatever the passes above produced, no debit may
  // exceed the member's original equity. This can only fire if the re-allocation
  // engine over-paid a member, in which case that excess is unabsorbed too.
  let unabsorbedCents = 0;
  for (const [id, cents] of applied) {
    const cap = equityCents.get(id) ?? 0;
    if (cents > cap) {
      unabsorbedCents += cents - cap;
      applied.set(id, cap);
    }
  }
  // Plus whatever shortfall no remaining member had equity to absorb: it was
  // clamped away above and is reported rather than silently dropped.
  unabsorbedCents += strandedCents;

  return { appliedCents: applied, unabsorbedCents };
}

/** Parse "Month YYYY" / localized month label into ISO date (1st, UTC). */
/**
 * Split a pool across members by category weight, then pro-rata by shares.
 */
export function splitByTypeAndShares(
  totalCents: number,
  members: TypeWeightedMember[],
  rulesBp: Map<string, number>,
): TypeSplitOutcome {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new MoneyError("Total must be a positive integer-cent amount", "INVALID_AMOUNT");
  }
  const eligible = members
    .filter((m) => Number.isInteger(m.shares) && m.shares > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (eligible.length === 0) {
    throw new MoneyError("No active shares available for distribution", "NO_SHARES");
  }

  const plain = (labelCents: number): TypeSplitOutcome => ({
    payouts: splitDividendByShares(labelCents, eligible),
    typeBlocks: [],
    remainderCents: labelCents,
  });

  if (rulesBp.size === 0) return plain(totalCents);

  // Deterministic category order (role name) — same tie-break discipline as ids.
  const byRole = new Map<string, TypeWeightedMember[]>();
  for (const m of eligible) {
    const list = byRole.get(m.role) ?? [];
    list.push(m);
    byRole.set(m.role, list);
  }
  const present: Array<{ id: string; bp: number }> = [];
  for (const [role, bp] of [...rulesBp.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!Number.isInteger(bp) || bp <= 0 || bp > 10_000) {
      throw new MoneyError("Each category weight must be an integer basis-point percent in (0, 10000]", "INVALID_PERCENT");
    }
    if (byRole.has(role)) present.push({ id: role, bp });
  }
  // Nothing configured is present (e.g. a club dividend with no Board Members):
  // behave exactly like the historical pro-rata split.
  if (present.length === 0) return plain(totalCents);

  const blocks = splitByPercent(totalCents, present);
  const blockCentsByRole = new Map(blocks.map((b) => [b.id, b.payoutCents]));

  const payoutCents = new Map<string, number>();
  for (const m of eligible) payoutCents.set(m.id, 0);

  for (const block of blocks) {
    const membersOfRole = byRole.get(block.id) ?? [];
    if (block.payoutCents > 0) {
      for (const p of splitDividendByShares(block.payoutCents, membersOfRole)) {
        payoutCents.set(p.id, (payoutCents.get(p.id) ?? 0) + p.payoutCents);
      }
    }
  }

  const blockTotalCents = blocks.reduce((acc, b) => acc + b.payoutCents, 0);
  const remainderCents = totalCents - blockTotalCents;
  if (remainderCents > 0) {
    const unconfigured = eligible.filter((m) => !rulesBp.has(m.role));
    const targets = unconfigured.length > 0 ? unconfigured : eligible;
    for (const p of splitDividendByShares(remainderCents, targets)) {
      payoutCents.set(p.id, (payoutCents.get(p.id) ?? 0) + p.payoutCents);
    }
  }

  const payouts = eligible.map((m) => ({
    id: m.id,
    shares: m.shares,
    payoutCents: payoutCents.get(m.id) ?? 0,
  }));
  const sum = payouts.reduce((acc, p) => acc + p.payoutCents, 0);
  if (sum !== totalCents) {
    throw new MoneyError("Category split does not reconcile", "SPLIT_UNBALANCED");
  }

  return {
    payouts,
    typeBlocks: blocks.map((b) => ({
      role: b.id,
      bp: b.bp,
      amountCents: b.payoutCents,
      memberCount: (byRole.get(b.id) ?? []).length,
    })),
    remainderCents,
  };
}

/** Parse "Month YYYY" / localized month label into ISO date (1st, UTC). */
const MONTH_NAMES_EN = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTH_NAMES_BN = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Convert Bengali digits (০-৯) to ASCII digits. */
export function normalizeBanglaDigits(value: string): string {
  return value.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
}

/**
 * Resolve a deposit month label like "January 2024", "Jan 2024",
 * "জানুয়ারি ২০২৪" or "2024-01" to an ISO `yyyy-mm-01` date string.
 * Returns null when unparseable.
 */
export function parseDepositMonthToIso(label: string | null | undefined): string | null {
  if (!label) return null;
  const normalized = normalizeBanglaDigits(label).trim();
  if (!normalized) return null;

  // ISO month "2024-01" / "2024-1"
  const isoMatch = /^(\d{4})-(\d{1,2})$/.exec(normalized);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12 && year >= 1900) {
      return `${year}-${String(month).padStart(2, "0")}-01`;
    }
    return null;
  }

  const parts = normalized.split(/\s+/);
  if (parts.length < 2) return null;
  const year = Number(parts[parts.length - 1]);
  if (!Number.isInteger(year) || year < 1900) return null;
  const monthLabel = parts.slice(0, -1).join(" ").toLowerCase().replace(/\.$/, "");

  const byFull = MONTH_NAMES_EN.indexOf(monthLabel);
  if (byFull >= 0) return `${year}-${String(byFull + 1).padStart(2, "0")}-01`;

  const byBn = MONTH_NAMES_BN.findIndex((m) => m === monthLabel);
  if (byBn >= 0) return `${year}-${String(byBn + 1).padStart(2, "0")}-01`;

  const abbr = MONTH_ABBR[monthLabel.slice(0, 3)];
  if (abbr !== undefined && monthLabel.length <= 4) {
    return `${year}-${String(abbr + 1).padStart(2, "0")}-01`;
  }
  return null;
}

/** First millisecond (UTC) of an ISO `yyyy-mm` period key. */
export function monthKeyToUtcStart(monthKey: string): Date | null {
  const iso = parseDepositMonthToIso(monthKey);
  if (!iso) return null;
  return new Date(`${iso}T00:00:00.000Z`);
}

