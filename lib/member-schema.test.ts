import { describe, expect, it } from "vitest";
import { memberCreateSchema, memberUpdateSchema } from "./member-schema";

/**
 * members.name / members.email are varchar(255). Before this the schema capped
 * phone, avatar and every KYC field but not those two, so a long value passed
 * validation and then failed inside the INSERT as Postgres 22001 — a 500 with
 * raw SQL, instead of a field error the user could act on.
 */

describe("member input length limits", () => {
  const valid = { name: "Rahim Uddin", email: "rahim@example.com", phone: "+8801711000001" };

  it("accepts a name and email right up to the column limit", () => {
    const res = memberCreateSchema.safeParse({
      ...valid,
      name: "a".repeat(255),
      email: `${"b".repeat(243)}@example.com`,
    });
    expect(res.success).toBe(true);
  });

  it("rejects a name longer than varchar(255) with a field error", () => {
    const res = memberCreateSchema.safeParse({ ...valid, name: "a".repeat(256) });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(["name"]);
      expect(res.error.issues[0]?.message).toContain("255");
    }
  });

  it("rejects an email longer than varchar(255)", () => {
    // 252 local chars + "@x.io" = 257
    const res = memberCreateSchema.safeParse({ ...valid, email: `${"c".repeat(252)}@x.io` });
    expect(res.success).toBe(false);
  });

  it("applies the same cap on update", () => {
    expect(memberUpdateSchema.safeParse({ name: "d".repeat(300) }).success).toBe(false);
    expect(memberUpdateSchema.safeParse({ name: "d".repeat(255) }).success).toBe(true);
  });

  it("still trims, so padding does not smuggle an over-long value through", () => {
    const res = memberCreateSchema.safeParse({ ...valid, name: `  ${"e".repeat(256)}  ` });
    expect(res.success).toBe(false);
  });

  it("keeps the existing phone cap", () => {
    expect(memberCreateSchema.safeParse({ ...valid, phone: "1".repeat(51) }).success).toBe(false);
  });
});
