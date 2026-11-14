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

  it("is exactly the six-category vocabulary", () => {
    expect(MEMBER_ROLES).toEqual([
      "Admin",
      "Manager",
      "Board Member",
      "Shareholder Member",
      "Project Level Member",
      "Auditor",
    ]);
  });

  it("drops the stale synonyms in favour of the canonical spellings", () => {
    expect(isMemberRole("Administrator")).toBe(false);
    expect(isMemberRole("Audit")).toBe(false);
    expect(isMemberRole("Admin")).toBe(true);
    expect(isMemberRole("Auditor")).toBe(true);
  });

  it("retires the folded categories (migration 0029 rewrote every row)", () => {
    // Kept out of the vocabulary on purpose: a retired value in the picker
    // would offer a category the settings/rules UI no longer accounts for.
    for (const role of ["Member", "Investor", "Associate Member", "Founding Member", "Project Member"]) {
      expect(isMemberRole(role)).toBe(false);
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
    expect(memberRoleDisplay("Founding Member", t)).toBe("Founding Member");
    // t called only for the in-vocabulary role below (the retired value above
    // must render its stored text, never a key lookup).
    expect(t).not.toHaveBeenCalled();
    expect(memberRoleDisplay("Shareholder Member", t)).toBe(`t:${memberRoleLabel("Shareholder Member")}`);
    expect(memberRoleDisplay(null, t)).toBe("");
  });
});
