import { describe, expect, it } from "vitest";
import {
  ACCESS_ONLY_ROLES,
  decideRoleLock,
  isAccessOnlyRole,
  normalizeMemberRole,
} from "./member-role-lock";
import { MEMBER_ROLES } from "./member-roles";

describe("member type lock policy (money types freeze after transactions)", () => {
  it("the vocabulary splits exactly: three access titles, three money types", () => {
    expect([...ACCESS_ONLY_ROLES].sort()).toEqual(["Admin", "Auditor", "Manager"]);
    for (const role of MEMBER_ROLES) {
      const isMoney = !isAccessOnlyRole(role);
      // Board / Shareholder / Project Level are money; Admin/Manager/Auditor are not.
      expect(isMoney).toBe(
        role === "Board Member" || role === "Shareholder Member" || role === "Project Level Member",
      );
    }
  });

  it("absent or blank submissions are 'leave alone', not a change", () => {
    for (const stored of ["Shareholder Member", "Manager", null, undefined]) {
      expect(decideRoleLock(stored, undefined).kind).toBe("unchanged");
      expect(decideRoleLock(stored, null).kind).toBe("unchanged");
      expect(decideRoleLock(stored, "").kind).toBe("unchanged");
    }
  });

  it("a null stored role IS the default category — null → Shareholder is no change", () => {
    expect(normalizeMemberRole(null)).toBe("Shareholder Member");
    expect(normalizeMemberRole("  ")).toBe("Shareholder Member");
    expect(decideRoleLock(null, "Shareholder Member").kind).toBe("unchanged");
    expect(decideRoleLock("Shareholder Member", null).kind).toBe("unchanged");
  });

  it("every money→money switch is locked (it re-slices the member pool)", () => {
    const money = ["Board Member", "Shareholder Member", "Project Level Member"];
    for (const a of money) {
      for (const b of money) {
        expect(decideRoleLock(a, b).kind).toBe(a === b ? "unchanged" : "lock-required");
      }
    }
  });

  it("access→access stays free — electing officers is governance, not money", () => {
    expect(decideRoleLock("Manager", "Auditor").kind).toBe("free");
    expect(decideRoleLock("Auditor", "Admin").kind).toBe("free");
    expect(decideRoleLock("Admin", "Manager").kind).toBe("free");
  });

  it("money↔access is locked in BOTH directions", () => {
    // Dropping a Board Member to Auditor removes their carve-out (the
    // remainder changes); promoting an Auditor into Board adds one.
    expect(decideRoleLock("Board Member", "Auditor").kind).toBe("lock-required");
    expect(decideRoleLock("Auditor", "Board Member").kind).toBe("lock-required");
    expect(decideRoleLock("Manager", "Shareholder Member").kind).toBe("lock-required");
    expect(decideRoleLock("Project Level Member", "Member").kind).toBe("lock-required");
  });

  it("legacy/vocabulary-unknown stored values fail CLOSED (treated as money)", () => {
    // A stale row outside the six-category vocabulary must not sneak through
    // as "access". The Admin override is the door, not the blind spot.
    expect(decideRoleLock("Founding Member", "Manager").kind).toBe("lock-required");
    expect(decideRoleLock("Chairman", "Board Member").kind).toBe("lock-required");
    // Chairman → Shareholder Member: from is unknown (money-ish, fail closed),
    // so locked — but the SAME pair with an access target is also locked.
    expect(decideRoleLock("Chairman", "Shareholder Member").kind).toBe("lock-required");
  });

  it("whitespace around a real role does not fake a change", () => {
    expect(decideRoleLock("Manager ", " Manager").kind).toBe("unchanged");
  });
});
