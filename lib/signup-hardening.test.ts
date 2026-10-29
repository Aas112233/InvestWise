import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { bucketKey } from "./rate-limit";
import { getAbuseClientIp } from "./request-meta";
import { globalSignupCeiling, SIGNUP_CEILING_NO_PROOF, SIGNUP_CEILING_WITH_PROOF } from "./turnstile";
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
  // Only headers this deployment's own edge writes may be trusted. Vercel sets
  // `x-vercel-forwarded-for` and will not let a client overwrite it; `x-real-ip`
  // and `cf-connecting-ip` are never set by Vercel, so a value in them arrived
  // in the request. The two tests below previously asserted the OPPOSITE
  // (x-real-ip winning, and raw XFF being usable) — i.e. they pinned the
  // bypass in place: one request header bought a fresh bucket per request.

  it("trusts the edge-stamped header over client-supplied forwarded headers", () => {
    const req = requestWith({
      "x-vercel-forwarded-for": "198.51.100.7",
      "x-real-ip": "203.0.113.99",
      "x-forwarded-for": "203.0.113.99, 10.0.0.1",
    });
    expect(getAbuseClientIp(req)).toBe("198.51.100.7");
  });

  it("ignores a spoofed x-real-ip so a header cannot buy a fresh bucket", () => {
    const req = requestWith({ "x-real-ip": "203.0.113.99", "x-forwarded-for": "203.0.113.99" });
    expect(getAbuseClientIp(req)).toBe("unknown");
  });

  it("does not fall back to raw x-forwarded-for, whose first entry is caller-chosen", () => {
    const req = requestWith({ "x-forwarded-for": "203.0.113.99, 10.0.0.1" });
    expect(getAbuseClientIp(req)).toBe("unknown");
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

  it("skips bot protection entirely when the kill switch is off", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAAAJ3_xxxxxxxxxxxxxxxxxxxxx");
    const { turnstileState } = await import("./turnstile");
    expect(turnstileState().mode).toBe("skipped");
  });

  it("fails closed in production when the secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", undefined);
    const { turnstileState } = await import("./turnstile");
    expect(turnstileState().mode).toBe("unavailable");
  });

  it("refuses Cloudflare's always-pass test vector in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000");
    const { turnstileState } = await import("./turnstile");
    expect(turnstileState().mode).toBe("unavailable");
  });

  it("requires a token once a real secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_ENABLED", "true");
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

describe("platform signup ceiling follows bot-protection posture", () => {
  // With human proof off, the global counter is the only control a
  // rotating-IP, rotating-email swarm cannot bypass — so it must be tight
  // enough that mass tenant minting stops being economical.
  it("stays generous when human proof prices each admission", () => {
    expect(globalSignupCeiling("required")).toBe(SIGNUP_CEILING_WITH_PROOF);
  });

  it("tightens when the kill switch removes human proof", () => {
    expect(globalSignupCeiling("skipped")).toBe(SIGNUP_CEILING_NO_PROOF);
  });

  it("never widens the no-proof ceiling above the proof ceiling", () => {
    expect(SIGNUP_CEILING_NO_PROOF).toBeLessThan(SIGNUP_CEILING_WITH_PROOF);
  });

  it("treats 'unavailable' as no-proof if it ever reaches a counter", () => {
    // 'unavailable' already fails closed with 503 before any bucket is spent;
    // the safe direction is the strict ceiling should the ordering change.
    expect(globalSignupCeiling("unavailable")).toBe(SIGNUP_CEILING_NO_PROOF);
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
