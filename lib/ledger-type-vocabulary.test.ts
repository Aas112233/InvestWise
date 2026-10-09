import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #73 was a project created with a shareholder rolling back because
 * `transactions_type_check` did not list the `type` the route writes, and the
 * failure surfaced as a 500 echoing raw SQL. The same drift already broke fund
 * transfers (#19) and dividends (#20). This pins the vocabulary the application
 * actually writes so a future insert cannot silently disagree with the DB.
 */

const MIGRATION = join(
  process.cwd(),
  "db",
  "migrations",
  "0012_transactions_type_vocabulary.sql",
);

function allowedTypesFrom(sql: string): string[] {
  const block = sql.slice(sql.lastIndexOf("transactions_type_check"));
  return [...block.matchAll(/'([^']+)'\s*::character varying/g)]
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string");
}

// Every ledger type written anywhere in app/, server/ or lib/.
const TYPES_THE_APP_WRITES = [
  "Deposit",
  "Withdrawal",
  "Investment",
  "Project Investment", // app/api/projects/route.ts — shareholder equity leg
  "Expense",
  "Earning",
  "Dividend",
  "Dividend Distribution",
  "Statutory Reserve",
  "Equity-Transfer",
  "Adjustment",
  "Transfer",
  "Transfer In",
  "Transfer Out",
  "Disbursement",
];

describe("transactions type vocabulary", () => {
  const allowed = allowedTypesFrom(readFileSync(MIGRATION, "utf8"));

  it.each(TYPES_THE_APP_WRITES)(
    "allows the type the app writes: %s",
    (type) => {
      expect(allowed).toContain(type);
    },
  );

  it("does not allow the fund-only type 'Reserve'", () => {
    // 'Reserve' is a funds.type value (server/src/db/init-db.ts), never a
    // ledger type; widening the ledger list to cover it would hide a real bug.
    expect(allowed).not.toContain("Reserve");
  });
});
