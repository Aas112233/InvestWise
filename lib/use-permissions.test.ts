import { describe, it, expect } from "vitest";
import { hasScreenPermission } from "./permissions";
import { normalizeRole, isSuperAdminRole, roleBaselineGrant } from "./roles";

describe("role normalization", () => {
  it("maps legacy role strings to canonical roles", () => {
    expect(normalizeRole("Administrator")).toBe("Admin");
    expect(normalizeRole("Super Admin")).toBe("SuperAdmin");
    expect(normalizeRole("Cashier")).toBe("Manager");
    expect(normalizeRole("Officer")).toBe("Manager");
    expect(normalizeRole("Audit")).toBe("Auditor");
    expect(normalizeRole("Shareholder")).toBe("Member");
    expect(normalizeRole("Investor")).toBe("Member");
    expect(normalizeRole("Viewer")).toBe("Member");
    expect(normalizeRole("Guest")).toBe("Member");
    expect(normalizeRole("Admin")).toBe("Admin");
    expect(normalizeRole("Manager")).toBe("Manager");
    expect(normalizeRole("Auditor")).toBe("Auditor");
    expect(normalizeRole("Member")).toBe("Member");
    expect(normalizeRole("SuperAdmin")).toBe("SuperAdmin");
  });

  it("unknown, empty, and non-string roles become Member", () => {
    expect(normalizeRole("Billionaire")).toBe("Member");
    expect(normalizeRole("")).toBe("Member");
    expect(normalizeRole(null)).toBe("Member");
    expect(normalizeRole(undefined)).toBe("Member");
  });

  it("detects platform operators by role", () => {
    expect(isSuperAdminRole("SuperAdmin")).toBe(true);
    expect(isSuperAdminRole("Super Admin")).toBe(true);
    expect(isSuperAdminRole("Admin")).toBe(false);
    expect(isSuperAdminRole("Manager")).toBe(false);
  });

  it("role baselines match the old matrix", () => {
    expect(roleBaselineGrant("SuperAdmin", "SETTINGS")).toBe("WRITE");
    expect(roleBaselineGrant("Admin", "DIVIDENDS")).toBe("WRITE");
    expect(roleBaselineGrant("Manager", "DEPOSITS")).toBe("WRITE");
    expect(roleBaselineGrant("Manager", "SETTINGS")).toBe("NONE");
    expect(roleBaselineGrant("Auditor", "MEMBERS")).toBe("READ");
    expect(roleBaselineGrant("Member", "DEPOSITS")).toBe("READ");
    expect(roleBaselineGrant("Member", "REQUEST_DEPOSIT")).toBe("WRITE");
    expect(roleBaselineGrant("Member", "SETTINGS")).toBe("NONE");
  });
});

describe("permission evaluation (RBAC)", () => {
  it("SuperAdmin and Admin pass everything", () => {
    for (const role of ["SuperAdmin", "Admin", "Administrator", "Super Admin"]) {
      const user = { role, permissions: {} };
      expect(hasScreenPermission(user, "SETTINGS", "WRITE")).toBe(true);
      expect(hasScreenPermission(user, "DIVIDENDS", "WRITE")).toBe(true);
    }
  });

  it("manager writes everywhere except SETTINGS", () => {
    const user = { role: "Manager", permissions: {} };
    expect(hasScreenPermission(user, "DEPOSITS", "WRITE")).toBe(true);
    expect(hasScreenPermission(user, "FUNDS_MANAGEMENT", "WRITE")).toBe(true);
    expect(hasScreenPermission(user, "SETTINGS", "WRITE")).toBe(false);
    expect(hasScreenPermission(user, "SETTINGS", "READ")).toBe(false);
  });

  it("auditor reads everything, writes nothing", () => {
    const user = { role: "Auditor", permissions: {} };
    expect(hasScreenPermission(user, "MEMBERS", "READ")).toBe(true);
    expect(hasScreenPermission(user, "SETTINGS", "READ")).toBe(true);
    expect(hasScreenPermission(user, "DEPOSITS", "WRITE")).toBe(false);
    expect(hasScreenPermission(user, "REQUEST_DEPOSIT", "WRITE")).toBe(false);
  });

  it("explicit permissions override role defaults", () => {
    const user = { role: "Member", permissions: { DIVIDENDS: "WRITE" } };
    expect(hasScreenPermission(user, "DIVIDENDS", "WRITE")).toBe(true);
    expect(hasScreenPermission(user, "FUNDS_MANAGEMENT", "WRITE")).toBe(false);
  });

  it("explicit NONE blocks non-admin roles", () => {
    const user = { role: "Member", permissions: { DEPOSITS: "NONE" } };
    expect(hasScreenPermission(user, "DEPOSITS", "READ")).toBe(false);
  });

  it("TRANSACTIONS falls back to DEPOSITS parent", () => {
    const user = { role: "Member", permissions: { DEPOSITS: "WRITE" } };
    expect(hasScreenPermission(user, "TRANSACTIONS", "WRITE")).toBe(true);
    const reader = { role: "Member", permissions: { DEPOSITS: "READ" } };
    expect(hasScreenPermission(reader, "TRANSACTIONS", "READ")).toBe(true);
    expect(hasScreenPermission(reader, "TRANSACTIONS", "WRITE")).toBe(false);
  });

  it("members get read on financial screens plus deposit requests, no other writes", () => {
    const user = { role: "Member", permissions: {} };
    expect(hasScreenPermission(user, "DEPOSITS", "READ")).toBe(true);
    expect(hasScreenPermission(user, "TRANSACTIONS", "READ")).toBe(true);
    expect(hasScreenPermission(user, "EXPENSES", "WRITE")).toBe(false);
    expect(hasScreenPermission(user, "REQUEST_DEPOSIT", "WRITE")).toBe(true);
  });

  it("legacy investor/shareholder strings behave as Member", () => {
    const user = { role: "Investor", permissions: {} };
    expect(hasScreenPermission(user, "DEPOSITS", "READ")).toBe(true);
    expect(hasScreenPermission(user, "DEPOSITS", "WRITE")).toBe(false);
  });

  it("null user has no permission", () => {
    expect(hasScreenPermission(null, "DASHBOARD", "READ")).toBe(false);
  });
});
