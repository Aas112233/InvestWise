import { afterEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { ValidationError } from "./utils/errors";
import { clampText, readCappedJson } from "./request-meta";
import { authorizeCronRequest } from "./cron-auth";
import { generateAccessToken, verifyToken } from "./utils/jwt";

function requestWith(headers: Record<string, string>, body?: string): NextRequest {
  return new Request("http://localhost/test", {
    method: body === undefined ? "GET" : "POST",
    headers,
    body,
  }) as unknown as NextRequest;
}

const SAVED_CRON_SECRET = process.env.CRON_SECRET;
afterEach(() => {
  if (SAVED_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = SAVED_CRON_SECRET;
});

describe("readCappedJson", () => {
  it("parses a JSON body within the cap", async () => {
    const parsed = await readCappedJson(requestWith({}, JSON.stringify({ a: 1 })), 1024);
    expect(parsed).toEqual({ a: 1 });
  });

  it("rejects a body larger than the cap based on bytes actually read, not headers", async () => {
    // 1 MB of real payload; content-length header deliberately absent/lying is
    // irrelevant because the cap is applied to the read text.
    const big = JSON.stringify({ blob: "x".repeat(1024 * 1024) });
    await expect(readCappedJson(requestWith({}, big), 4096)).rejects.toThrow(ValidationError);
  });

  it("rejects a non-JSON body", async () => {
    await expect(readCappedJson(requestWith({}, "not json {"), 4096)).rejects.toThrow(ValidationError);
  });
});

describe("clampText", () => {
  it("trims and clamps to the maximum length", () => {
    expect(clampText("  Dhaka  ", 100)).toBe("Dhaka");
    expect(clampText("x".repeat(500), 100)).toHaveLength(100);
  });

  it("maps absence and non-strings to null, and blank to null", () => {
    expect(clampText(undefined, 10)).toBeNull();
    expect(clampText(42, 10)).toBeNull();
    expect(clampText("   ", 10)).toBeNull();
  });
});

describe("authorizeCronRequest", () => {
  it("fails closed when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    const result = authorizeCronRequest(requestWith({ authorization: "Bearer anything" }));
    expect(result).toEqual({ ok: false, reason: "CRON_NOT_CONFIGURED" });
  });

  it("accepts the exact bearer and rejects everything else", () => {
    process.env.CRON_SECRET = "test-secret-value-123";
    expect(authorizeCronRequest(requestWith({ authorization: "Bearer test-secret-value-123" }))).toEqual({ ok: true });
    expect(authorizeCronRequest(requestWith({})).ok).toBe(false);
    expect(authorizeCronRequest(requestWith({ authorization: "Bearer wrong" })).ok).toBe(false);
    // Wrong scheme must not pass even with the right secret.
    expect(
      authorizeCronRequest(requestWith({ authorization: "test-secret-value-123" })).ok,
    ).toBe(false);
  });

  it("rejects a length-mismatched header without throwing", () => {
    process.env.CRON_SECRET = "test-secret-value-123";
    const result = authorizeCronRequest(requestWith({ authorization: "B" }));
    expect(result).toEqual({ ok: false, reason: "UNAUTHORIZED" });
  });
});

describe("jwt algorithm pinning", () => {
  it("round-trips an HS256 token", () => {
    process.env.JWT_SECRET = "test-jwt-secret-for-vitest-0123456789";
    const token = generateAccessToken("user-1", { role: "Admin" });
    const decoded = verifyToken(token, "access");
    expect(decoded.id).toBe("user-1");
    expect(decoded.type).toBe("access");
    delete process.env.JWT_SECRET;
  });

  it("refuses a token forged with a different algorithm (alg=none-style header)", () => {
    process.env.JWT_SECRET = "test-jwt-secret-for-vitest-0123456789";
    // Hand-rolled header with alg "none" and an empty signature.
    const forged = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(
      JSON.stringify({ id: "user-1", type: "access" }),
    ).toString("base64url")}.`;
    expect(() => verifyToken(forged, "access")).toThrow();
    // A token claiming HS512 must also be refused even if signed with our secret.
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const signingInput = `${Buffer.from(JSON.stringify({ alg: "HS512", typ: "JWT" })).toString("base64url")}.${Buffer.from(
      JSON.stringify({ id: "user-1", type: "access" }),
    ).toString("base64url")}`;
    const sig = createHmac("sha512", "test-jwt-secret-for-vitest-0123456789").update(signingInput).digest("base64url");
    expect(() => verifyToken(`${signingInput}.${sig}`, "access")).toThrow();
    delete process.env.JWT_SECRET;
  });
});
