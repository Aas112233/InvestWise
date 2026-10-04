import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { bucketKey } from "./rate-limit";
import { getAbuseClientIp } from "./request-meta";
import { provisionTenant } from "./tenant-provision";
import { validatePasswordStrength } from "./utils/password";
import { ValidationError } from "./utils/errors";

function requestWith(headers: Record<string, string>): NextRequest {
  return new Request("http://localhost/signup", { headers }) as unknown as NextRequest;
}

describe("signup rate-limit keys", () => {
  it("scopes keys so identical identities in different buckets never share a counter", () => {
    expect(bucketKey("signup:email", "a@b.co")).not.toBe(bucketKey("signup:ip", "a@b.co"));
  });

  it("is deterministic per identity but never stores the raw value", () => {
    const key = bucketKey("signup:ip", "203.0.113.9");
    expect(key).toBe(bucketKey("signup:ip", "203.0.113.9"));
    expect(key).not.toContain("203.0.113.9");
    expect(key.startsWith("signup:ip:")).toBe(true);
  });

  it("normalizes case so a spoofed casing cannot open a second window", () => {
    expect(bucketKey("signup:email", "Person@Example.COM")).toBe(bucketKey("signup:email", "person@example.com"));
  });
});

describe("client IP selection for abuse controls", () => {
  it("prefers the edge-stamped header over the spoofable first XFF entry", () => {
    const req = requestWith({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.99, 10.0.0.1" });
    expect(getAbuseClientIp(req)).toBe("198.51.100.7");
  });

  it("takes the first forwarded entry only when no trusted header exists", () => {
    const req = requestWith({ "x-forwarded-for": "203.0.113.99, 10.0.0.1" });
    expect(getAbuseClientIp(req)).toBe("203.0.113.99");
  });

  it("never fabricates an address it cannot see", () => {
    expect(getAbuseClientIp(requestWith({}))).toBe("unknown");
  });
});

describe("bot protection posture", () => {
  // turnstile.ts reads NODE_ENV once at module load, so every case needs a
  // fresh import.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed in production when the secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);
    const { turnstileState } = await import("./turnstile");
    expect(turnstileState().mode).toBe("unavailable");
  });

  it("refuses Cloudflare's always-pass test vector in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000");
    const { turnstileState } = await import("./turnstile");
    expect(turnstileState().mode).toBe("unavailable");
  });

  it("requires a token once a real secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAAAJ3_xxxxxxxxxxxxxxxxxxxxx");
    const { turnstileState } = await import("./turnstile");
    expect(turnstileState().mode).toBe("required");
  });

  it("denies a missing or malformed token without calling the provider", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAAAJ3_xxxxxxxxxxxxxxxxxxxxx");
    const { verifyTurnstileToken } = await import("./turnstile");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(verifyTurnstileToken(undefined, "203.0.113.9")).resolves.toMatchObject({
      ok: false,
      code: "CAPTCHA_MISSING",
    });
    await expect(verifyTurnstileToken("x".repeat(5000), "203.0.113.9")).resolves.toMatchObject({
      ok: false,
      code: "CAPTCHA_MISSING",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("treats an unreachable provider as a denial, not a pass", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAAAJ3_xxxxxxxxxxxxxxxxxxxxx");
    const { verifyTurnstileToken } = await import("./turnstile");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));

    await expect(verifyTurnstileToken("token", "203.0.113.9")).resolves.toMatchObject({
      ok: false,
      code: "CAPTCHA_UNAVAILABLE",
    });
    fetchSpy.mockRestore();
  });
});

describe("tenant provisioning input validation", () => {
  // These must reject before any database access, because the public endpoint
  // is reachable without a session.
  const valid = {
    organizationName: "Acme Investment Group",
    adminName: "Ahmed Khan",
    email: "owner@acme.test",
    password: "Str0ng!Passw0rd#2026",
    trialDays: 30,
    reason: "test",
  };

  it("rejects non-text names instead of throwing a TypeError", async () => {
    await expect(provisionTenant({ ...valid, organizationName: 42 as unknown as string })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects a weak password", async () => {
    await expect(provisionTenant({ ...valid, password: "shorty" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a reserved slug outright", async () => {
    await expect(
      provisionTenant({ ...valid, slug: "default", organizationName: "x".repeat(3) }),
    ).rejects.toThrow(/reserved/i);
  });

  it("applies the reservation to derived slugs, not just typed ones", async () => {
    // "Admin" slugifies to the reserved `admin`; self-serve never passes a slug,
    // so this is the only thing standing between a visitor and that name.
    for (const name of ["Admin", "InvestWise", "WWW"] as const) {
      await expect(provisionTenant({ ...valid, organizationName: name })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("never echoes the password in a rejection message", async () => {
    const error = await provisionTenant({ ...valid, adminName: "" }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).not.toContain(valid.password);
  });

  it("rejects a non-string email", async () => {
    await expect(
      provisionTenant({ ...valid, email: { toString: () => "a@b.co" } as unknown as string }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("password length policy (8-char minimum)", () => {
  // The floor was lowered from 12 to 8; the complexity rule (upper, lower,
  // digit, special) is unchanged. These pin the exact boundary so a future
  // bump back up fails loudly.
  it("accepts the shortest valid 8-character complex password", () => {
    expect(validatePasswordStrength("Aa1@bcde")).toEqual({ valid: true });
  });

  it("rejects a 7-character password even when it is complex", () => {
    expect(validatePasswordStrength("Aa1@bcd").valid).toBe(false);
  });

  it("still rejects an 8-character password missing complexity", () => {
    expect(validatePasswordStrength("abcdefgh").valid).toBe(false);
  });
});
