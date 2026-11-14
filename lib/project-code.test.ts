import { describe, expect, it } from "vitest";
import { nextProjectCode, isProjectCodeClash } from "./project-code";

describe("project code (PRJ-XXXX, migration 0031)", () => {
  it("formats the sequential number with the member-code padding rule", () => {
    expect(nextProjectCode(0)).toBe("PRJ-0001");
    expect(nextProjectCode(42)).toBe("PRJ-0043");
    expect(nextProjectCode(9999)).toBe("PRJ-10000"); // grows past 4 digits — the {4,} regex keeps counting it
  });

  it("refuses numbers that are not a plain counter", () => {
    expect(() => nextProjectCode(-1)).toThrow(/non-negative integer/);
    expect(() => nextProjectCode(1.5)).toThrow(/non-negative integer/);
    expect(() => nextProjectCode(Number.NaN)).toThrow(/non-negative integer/);
  });

  it("recognises ONLY our code's unique-constraint clash", () => {
    const clash = {
      code: "23505",
      constraint: "projects_tenant_code_key",
      message: "duplicate key value violates unique constraint \"projects_tenant_code_key\"",
    };
    expect(isProjectCodeClash(clash)).toBe(true);
    // Drizzle wraps driver errors: cause carries the code/constraint instead.
    expect(isProjectCodeClash({ cause: { code: "23505", constraint: "projects_tenant_code_key" } })).toBe(true);
    // Only the message text (some drivers give nothing else).
    expect(isProjectCodeClash({ code: "23505", message: "... projects_tenant_code_key ..." })).toBe(true);

    // Other unique violations must NOT be retried as a code clash.
    expect(isProjectCodeClash({ code: "23505", constraint: "funds_name_tenant_unique", message: "funds" })).toBe(false);
    expect(isProjectCodeClash({ code: "22001", message: "string data right truncation" })).toBe(false);
    expect(isProjectCodeClash(new Error("boom"))).toBe(false);
    expect(isProjectCodeClash(undefined)).toBe(false);
  });
});
