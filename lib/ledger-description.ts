/**
 * Ledger narration localization (Rule §9/§10).
 *
 * A transaction `description` is stored as canonical English at write time and
 * is never rewritten afterwards — the books must not depend on whichever
 * language a row happened to be created in, and a stored string cannot be
 * re-translated retroactively. Reports and lists therefore translate the
 * canonical pattern at RENDER time, which is the only approach that also
 * localizes rows written before the user switched language.
 *
 * Only the machine-generated wrapper around a narration is translated; the
 * interpolated values (member names, fund names, project titles, reference
 * numbers, user-typed notes) are data and pass through untouched. Any string
 * that matches no known pattern — including free-text user narrations — is
 * returned verbatim, so this is safe to run over every ledger row.
 *
 * Pure and dependency-free: usable from the server report pipeline
 * (`createServerT`) and from client components (`useLocale`) alike.
 */

/** Any i18n lookup that returns the key itself when the key is missing. */
export type LedgerTranslator = (key: string) => string;

interface LedgerRule {
  pattern: RegExp;
  /** Message key, or a function of the match when the key depends on a value. */
  key: string | ((match: RegExpExecArray) => string);
  vars: (match: RegExpExecArray) => Record<string, string>;
}

/**
 * Ordered most-specific-first. Every pattern is anchored on both ends so a
 * free-text narration that merely contains a known phrase is not rewritten.
 */
const RULES: LedgerRule[] = [
  {
    pattern: /^Equity Migration: Received from (.+?) \[Reference: ([\s\S]*)\]$/,
    key: "ledger.equityReceived",
    vars: (m) => ({ name: m[1] as string, ref: m[2] as string }),
  },
  {
    pattern: /^Equity Migration: Transferred to (\d+) recipient\(s\) \[Reference: ([\s\S]*)\]$/,
    key: (m) => (m[1] === "1" ? "ledger.equityTransferred.one" : "ledger.equityTransferred.other"),
    vars: (m) => ({ count: m[1] as string, ref: m[2] as string }),
  },
  {
    pattern: /^Equity investment in project: ([\s\S]+?) \((\d+) shares? @ ([\d.,]+)\)$/,
    key: (m) => (m[2] === "1" ? "ledger.equityInvestment.one" : "ledger.equityInvestment.other"),
    vars: (m) => ({ project: m[1] as string, count: m[2] as string, value: m[3] as string }),
  },
  {
    pattern: /^Statutory reserve sweep to ([\s\S]+?) \(([\d.]+)%\) for dividend run ([\s\S]+)$/,
    key: "ledger.statutoryReserveSweep",
    vars: (m) => ({ fund: m[1] as string, percent: m[2] as string, ref: m[3] as string }),
  },
  {
    pattern: /^Statutory reserve \(([\d.]+)%\) for dividend run ([\s\S]+)$/,
    key: "ledger.statutoryReserve",
    vars: (m) => ({ percent: m[1] as string, ref: m[2] as string }),
  },
  {
    pattern: /^Dividend distribution to (\d+) members?$/,
    key: "ledger.dividendDistribution",
    vars: (m) => ({ count: m[1] as string }),
  },
  {
    pattern: /^Dividend payout for (\d+) shares?$/,
    key: (m) => (m[1] === "1" ? "ledger.dividendPayout.one" : "ledger.dividendPayout.other"),
    vars: (m) => ({ count: m[1] as string }),
  },
  {
    pattern: /^Project profit return to ([\s\S]+?) \(([\s\S]+?)\): ([\s\S]*)$/,
    key: "ledger.projectProfitReturnToFund",
    vars: (m) => ({ fund: m[1] as string, project: m[2] as string, note: m[3] as string }),
  },
  {
    pattern: /^Project profit return \(([\s\S]+?)\): ([\s\S]*)$/,
    key: "ledger.projectProfitReturn",
    vars: (m) => ({ project: m[1] as string, note: m[2] as string }),
  },
  {
    pattern: /^Project loss absorption \(([\s\S]+?)\): ([\s\S]*)$/,
    key: "ledger.projectLossAbsorption",
    vars: (m) => ({ project: m[1] as string, note: m[2] as string }),
  },
  {
    pattern: /^\[Transfer OUT\] to ([\s\S]+?): ([\s\S]*)$/,
    key: "ledger.fundTransferOut",
    vars: (m) => ({ fund: m[1] as string, note: m[2] as string }),
  },
  {
    pattern: /^\[Transfer IN\] from ([\s\S]+?): ([\s\S]*)$/,
    key: "ledger.fundTransferIn",
    vars: (m) => ({ fund: m[1] as string, note: m[2] as string }),
  },
  {
    pattern: /^Opening Balance for ([\s\S]+)$/,
    key: "ledger.openingBalance",
    vars: (m) => ({ fund: m[1] as string }),
  },
];

/** Fill `{name}` placeholders; unknown placeholders are left intact. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] as string) : whole,
  );
}

/**
 * Localize one stored ledger narration. Returns the input unchanged when it is
 * empty, matches no known pattern, or has no translation in the active locale.
 */
export function translateLedgerDescription(
  raw: string | null | undefined,
  t: LedgerTranslator,
): string {
  const text = raw ?? "";
  if (!text) return text;
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const key = typeof rule.key === "function" ? rule.key(match) : rule.key;
    const template = t(key);
    // A missing key resolves to the key itself (both the server and the client
    // translators behave this way) — keep the stored text rather than leak it.
    if (!template || template === key) return text;
    return fill(template, rule.vars(match));
  }
  return text;
}
