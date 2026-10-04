import { describe, expect, it, vi } from "vitest";
import {
  MEMBER_ROLES,
  isMemberRole,
  memberRoleDisplay,
  memberRoleLabel,
  memberRoleLabelKey,
} from "./member-roles";

describe("member role vocabulary", () => {
  it("renders no two options with the same label", () => {
    // The bug this guards: 'Admin' and 'Administrator' both mapped to
    // members.adminRole, so the picker showed two identical "Admin" rows.
    const labels = MEMBER_ROLES.map((r) => memberRoleLabel(r));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("drops the stale synonyms in favour of the canonical spellings", () => {
    expect(isMemberRole("Administrator")).toBe(false);
    expect(isMemberRole("Audit")).toBe(false);
    expect(isMemberRole("Admin")).toBe(true);
    expect(isMemberRole("Auditor")).toBe(true);
  });

  it("accepts every category actually present in member data", () => {
    // Seeded rows hold these; if the picker rejected them, editing such a
    // member would either fail or quietly change their category.
    for (const role of ["Investor", "Associate Member", "Founding Member", "Board Member"]) {
      expect(isMemberRole(role)).toBe(true);
    }
  });

  it("has a label key for every role and none outside it", () => {
    for (const role of MEMBER_ROLES) {
      expect(memberRoleLabelKey(role)).toMatch(/^(members|roles)\./);
    }
    expect(memberRoleLabelKey("Chairman")).toBeNull();
    expect(memberRoleLabelKey(undefined)).toBeNull();
  });

  it("shows an out-of-vocabulary stored value as itself, not as Member", () => {
    const t = vi.fn((key: string) => `t:${key}`);
    expect(memberRoleDisplay("Chairman", t)).toBe("Chairman");
    expect(t).not.toHaveBeenCalled();
    expect(memberRoleDisplay("Investor", t)).toBe(`t:${memberRoleLabel("Investor")}`);
    expect(memberRoleDisplay(null, t)).toBe("");
  });
});
