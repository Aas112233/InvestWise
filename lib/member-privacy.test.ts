import { describe, expect, it } from "vitest";
import { canViewMemberPII, maskMemberPII, type MemberWithPII } from "./member-privacy";

// The fixture is a real member row, not just the PII subset: assertions below
// reach for id/name/shares too, and the masked flag only exists on the type
// that extends MemberWithPII.
type TestMember = MemberWithPII & {
  id: string;
  memberId: string;
  name: string;
  email: string;
  shares: number;
};

const fullMember: TestMember = {
  id: "m1",
  memberId: "MEM-0001",
  name: "Test Member",
  email: "test@example.com",
  shares: 10,
  userId: "u1",
  phone: "01700-000000",
  address: "12/A, Dhaka",
  fatherName: "Father Name",
  motherName: "Mother Name",
  spouseName: "Spouse Name",
  nidOrPassport: "NID-123",
  nomineeName: "Nominee Name",
  nomineeRelation: "Spouse",
  nomineeNidOrPassport: "NID-456",
  nomineePhone: "01800-000000",
};

const SENSITIVE_KEYS = [
  "phone",
  "address",
  "fatherName",
  "motherName",
  "spouseName",
  "nidOrPassport",
  "nomineeName",
  "nomineeRelation",
  "nomineeNidOrPassport",
  "nomineePhone",
] as const;

describe("canViewMemberPII", () => {
  it("grants Admin and Manager full PII", () => {
    expect(canViewMemberPII("Admin", "u1", "someone-else")).toBe(true);
    expect(canViewMemberPII("Manager", "u1", "someone-else")).toBe(true);
  });

  it("grants a member their own record regardless of role", () => {
    expect(canViewMemberPII("Member", "u1", "u1")).toBe(true);
    expect(canViewMemberPII("Auditor", "u1", "u1")).toBe(true);
  });

  it("denies Auditor, Member, and anonymous viewers on other records", () => {
    expect(canViewMemberPII("Auditor", "u1", "someone-else")).toBe(false);
    expect(canViewMemberPII("Member", "u1", "someone-else")).toBe(false);
    expect(canViewMemberPII("Member", "u1", undefined)).toBe(false);
  });

  it("denies when the record has no linked user", () => {
    expect(canViewMemberPII("Member", null, "u1")).toBe(false);
    expect(canViewMemberPII("Auditor", null, "u1")).toBe(false);
  });
});

describe("maskMemberPII", () => {
  it("returns the record untouched for privileged viewers", () => {
    const result = maskMemberPII(fullMember, true);
    expect(result).toEqual(fullMember);
    expect(result.phone).toBe("01700-000000");
  });

  it("never stamps the masked flag for privileged viewers", () => {
    expect(maskMemberPII(fullMember, true).piiMasked).toBeUndefined();
  });

  it("strips every sensitive field for unprivileged viewers", () => {
    const result = maskMemberPII(fullMember, false);
    for (const key of SENSITIVE_KEYS) {
      expect(result[key as keyof typeof result]).toBeUndefined();
    }
    // And the underlying record still has them (only the copy is masked).
    expect(fullMember.phone).toBe("01700-000000");
  });

  it("flags the row as masked so the UI can say 'hidden' rather than blank", () => {
    expect(maskMemberPII(fullMember, false).piiMasked).toBe(true);
  });

  it("keeps non-sensitive fields visible for unprivileged viewers", () => {
    const result = maskMemberPII(fullMember, false);
    expect(result.name).toBe("Test Member");
    expect(result.email).toBe("test@example.com");
    expect(result.shares).toBe(10);
    expect(result.memberId).toBe("MEM-0001");
  });

  it("does not mutate the input object", () => {
    const snapshot = { ...fullMember };
    maskMemberPII(fullMember, false);
    expect(fullMember).toEqual(snapshot);
  });
});
