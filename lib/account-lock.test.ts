import { describe, expect, it } from "vitest";
import {
  lockDurationMs,
  LOCKOUT_BASE_MS,
  LOCKOUT_MAX_MS,
  LOCKOUT_THRESHOLD,
} from "./account-lock";

/**
 * The lockout used to be derived by counting rows in `login_attempts`, which
 * meant its behaviour could only be observed against a live database. These
 * cover the escalation curve, which is pure and is the part most likely to be
 * changed by someone tuning a constant.
 */
describe("account lockout escalation", () => {
  it("does not lock below the threshold", () => {
    for (let n = 0; n < LOCKOUT_THRESHOLD; n++) {
      expect(lockDurationMs(n)).toBe(0);
    }
  });

  it("locks for the base window on the first qualifying failure", () => {
    expect(lockDurationMs(LOCKOUT_THRESHOLD)).toBe(LOCKOUT_BASE_MS);
  });

  it("doubles per subsequent strike", () => {
    expect(lockDurationMs(5)).toBe(15 * 60_000);
    expect(lockDurationMs(6)).toBe(30 * 60_000);
    expect(lockDurationMs(7)).toBe(60 * 60_000);
    expect(lockDurationMs(8)).toBe(120 * 60_000);
  });

  it("is monotonic — a later strike can never release sooner", () => {
    let previous = 0;
    for (let n = LOCKOUT_THRESHOLD; n <= 30; n++) {
      const duration = lockDurationMs(n);
      expect(duration).toBeGreaterThanOrEqual(previous);
      previous = duration;
    }
  });

  it("is capped, so a guesser cannot make a lockout permanent", () => {
    // Escalation without a ceiling turns a scripted attempt run into a
    // self-inflicted denial of service against your own customers.
    expect(lockDurationMs(9)).toBe(LOCKOUT_MAX_MS);
    expect(lockDurationMs(500)).toBe(LOCKOUT_MAX_MS);
    expect(lockDurationMs(500)).toBeLessThanOrEqual(4 * 60 * 60_000);
  });

  it("never locks on nonsense input, and never throws at the login path", () => {
    // Deliberate: failed_attempts comes from a Postgres integer, so a
    // non-finite value can only mean a bug upstream. Locking real users out
    // because of a caller's arithmetic error is the worse failure, so garbage
    // degrades to "do not lock" and the credential check decides on its merits.
    expect(lockDurationMs(Number.NaN)).toBe(0);
    expect(lockDurationMs(-1)).toBe(0);
    expect(lockDurationMs(Infinity)).toBe(0);
    expect(lockDurationMs(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
