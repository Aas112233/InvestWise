import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasLedgerRef, ledgerRef } from "./doc-number";

/**
 * The client must never print a primary key again. Before migration 0026 every
 * list rendered `referenceNumber || id.slice(0, 8)`, which produced unreadable
 * receipts (`a3f9c21b`) and leaked internal idempotency keys
 * (`BLK-9f3c…-001`) onto printed paper.
 */
describe("ledgerRef", () => {
  it("prefers doc_number", () => {
    expect(
      ledgerRef({ docNumber: "DEP-2026-00042", referenceNumber: "BLK-abc-001" }),
    ).toBe("DEP-2026-00042");
  });

  it("falls back to the clerk's reference only when there is no doc_number", () => {
    expect(ledgerRef({ referenceNumber: "Bank transfer 5521" })).toBe(
      "Bank transfer 5521",
    );
  });

  it("treats blank and whitespace-only values as absent", () => {
    expect(ledgerRef({ docNumber: "   ", referenceNumber: "" })).toBe("—");
  });

  it("renders the supplied empty marker instead of an em dash when asked", () => {
    // Report exports need a genuinely empty cell, not a dash.
    expect(ledgerRef({}, "")).toBe("");
  });

  it("returns the empty marker for a missing row", () => {
    expect(ledgerRef(null)).toBe("—");
    expect(ledgerRef(undefined)).toBe("—");
  });

  it("never falls back to the primary key", () => {
    // A realistic row shape: `id` is always present and must never influence output.
    const row: {
      id: string;
      docNumber?: string | null;
      referenceNumber?: string | null;
    } = { id: "9f3c1a2b-7d4e-4a1f-9c8b-2e5d7f1a3b9c" };
    expect(ledgerRef(row)).toBe("—");
    expect(ledgerRef(row)).not.toContain("9f3c1a2b");
  });

  it("hasLedgerRef agrees with ledgerRef", () => {
    expect(hasLedgerRef({ docNumber: "EXP-2026-00001" })).toBe(true);
    expect(hasLedgerRef({ referenceNumber: "x" })).toBe(true);
    expect(hasLedgerRef({})).toBe(false);
    expect(hasLedgerRef(null)).toBe(false);
  });
});

/**
 * Parity between the SQL allocator and the ledger vocabulary.
 *
 * Assignment lives in the database (migration 0026), so TypeScript cannot import
 * the code table. What it CAN do is fail loudly when the two definitions drift,
 * which is the same class of bug that produced issues #19, #20 and #73 — a
 * `type` the application writes that the database never agreed to.
 */
describe("doc_number code table vs the ledger type vocabulary", () => {
  const migration026 = readFileSync(
    join(process.cwd(), "db", "migrations", "0026_doc_number.sql"),
    "utf8",
  );
  const migration012 = readFileSync(
    join(process.cwd(), "db", "migrations", "0012_transactions_type_vocabulary.sql"),
    "utf8",
  );

  /** Every `WHEN '<type>' THEN '<CODE>'` arm of app_doc_type_code(). */
  const codeArms = [...migration026.matchAll(/WHEN\s+'([^']+)'\s+THEN\s+'([A-Z]+)'/g)].map(
    (m) => ({ type: m[1], code: m[2] }),
  );

  /** Every type the DB CHECK allows (migration 0012) — the app-written set. */
  const checkedTypes = [
    ...migration012
      .slice(migration012.lastIndexOf("transactions_type_check"))
      .matchAll(/'([^']+)'\s*::character varying/g),
  ].map((m) => m[1]);

  it("maps every type allowed by transactions_type_check", () => {
    const mapped = new Set(codeArms.map((a) => a.type));
    const missing = checkedTypes.filter((t) => !mapped.has(t));
    expect(missing, `no doc code for: ${missing.join(", ")}`).toEqual([]);
  });

  it("assigns a distinct code to every type", () => {
    const codes = codeArms.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps every code exactly three upper-case letters", () => {
    // The rendered width and the ^[A-Z]{3}-\d{4}-\d{5}$ shape both depend on it.
    for (const { code } of codeArms) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it("never maps a real type to the generic fallback", () => {
    expect(codeArms.some((a) => a.code === "GEN")).toBe(false);
  });

  it("reserves GEN as the ELSE arm so an unmapped type still gets numbered", () => {
    expect(migration026).toMatch(/ELSE\s+'GEN'\s*\n\s*END;/);
  });
});
