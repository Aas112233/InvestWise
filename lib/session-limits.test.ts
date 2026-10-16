import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_SESSION_LIFETIME_MS,
  IDLE_SESSION_LIFETIME_MS,
  SERVER_IDLE_GRACE_MS,
  SUPPORT_SESSION_LIFETIME_MS,
  isAbsoluteSessionExpired,
  isSessionIdle,
  isSupportSessionExpired,
} from "./session-limits";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe("session lifetime bounds", () => {
  it("caps absolute lifetime at 24h from login", () => {
    expect(ABSOLUTE_SESSION_LIFETIME_MS).toBe(24 * HOUR);
    const now = Date.now();
    expect(isAbsoluteSessionExpired(new Date(now - 23 * HOUR), now)).toBe(false);
    expect(isAbsoluteSessionExpired(new Date(now - 25 * HOUR), now)).toBe(true);
  });

  it("kills idle sessions at policy + grace (35m), not before", () => {
    expect(IDLE_SESSION_LIFETIME_MS).toBe(30 * MIN);
    expect(SERVER_IDLE_GRACE_MS).toBe(5 * MIN);
    const now = Date.now();
    // Still within the client warning window: alive server-side.
    expect(isSessionIdle(new Date(now - 31 * MIN), now)).toBe(false);
    // Past the grace: dead.
    expect(isSessionIdle(new Date(now - 36 * MIN), now)).toBe(true);
  });

  it("holds Support sessions to a hard 30m", () => {
    expect(SUPPORT_SESSION_LIFETIME_MS).toBe(30 * MIN);
    const now = Date.now();
    expect(isSupportSessionExpired(new Date(now - 29 * MIN), now)).toBe(false);
    expect(isSupportSessionExpired(new Date(now - 31 * MIN), now)).toBe(true);
  });

  it("fails closed on missing or unparseable timestamps", () => {
    expect(isAbsoluteSessionExpired(null)).toBe(true);
    expect(isSessionIdle(undefined)).toBe(true);
    expect(isSupportSessionExpired("not-a-date")).toBe(true);
  });
});
