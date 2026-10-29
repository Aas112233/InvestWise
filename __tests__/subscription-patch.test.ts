import { describe, expect, it } from "vitest";
import {
  buildSubscriptionPatch,
  deriveGraceDays,
  isoToLocalInput,
  type SubscriptionBaseline,
} from "@/lib/admin/subscription-patch";

const DAY = 86_400_000;

function baseline(overrides: Partial<SubscriptionBaseline> = {}): SubscriptionBaseline {
  return {
    status: "active",
    planSlug: "standard",
    currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(),
    trialEndsAt: null,
    graceEndsAt: null,
    ...overrides,
  };
}

/** Mirror of the panel's seedDraft: every control starts at the stored value. */
function seedFor(b: SubscriptionBaseline) {
  return {
    status: b.status ?? "",
    planSlug: b.planSlug ?? null,
    currentPeriodEnd: isoToLocalInput(b.currentPeriodEnd),
    trialEndsAt: isoToLocalInput(b.trialEndsAt),
    graceDays: b.graceEndsAt && b.currentPeriodEnd ? String(deriveGraceDays(b) ?? "") : "",
    reason: "",
  };
}

const draft = (
  b: SubscriptionBaseline,
  overrides: Partial<ReturnType<typeof seedFor>> = {},
) => ({ ...seedFor(b), ...overrides });

describe("isoToLocalInput", () => {
  it("maps null/invalid to an empty input value", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("not-a-date")).toBe("");
  });

  it("renders local wall-clock HH:mm from an ISO instant", () => {
    const iso = new Date(2026, 10, 5, 14, 30).toISOString();
    expect(isoToLocalInput(iso)).toBe("2026-11-05T14:30");
  });
});

describe("deriveGraceDays", () => {
  it("returns null without both anchors", () => {
    expect(deriveGraceDays({ graceEndsAt: null, currentPeriodEnd: null })).toBeNull();
    expect(deriveGraceDays({ graceEndsAt: new Date().toISOString(), currentPeriodEnd: null })).toBeNull();
  });

  it("rounds the stored window to whole days", () => {
    const end = new Date("2026-12-01T00:00:00Z");
    const grace = new Date(end.getTime() + 7 * DAY);
    expect(deriveGraceDays({ graceEndsAt: grace.toISOString(), currentPeriodEnd: end.toISOString() })).toBe(7);
  });
});

describe("buildSubscriptionPatch", () => {
  it("reports no change for a draft seeded from the stored row", () => {
    const b = baseline();
    const r = buildSubscriptionPatch(b, draft(b));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changedFields).toEqual([]);
      expect(Object.keys(r.patch)).toEqual([]);
    }
  });

  it("sends status and plan only when they differ", () => {
    const b = baseline();
    const r = buildSubscriptionPatch(b, draft(b, { status: "past_due", planSlug: "premium" }));
    expect(r.ok && r.patch).toEqual({ status: "past_due", planSlug: "premium" });
  });

  it("clearing the paid-through field sends an explicit null", () => {
    const b = baseline();
    const r = buildSubscriptionPatch(b, draft(b, { currentPeriodEnd: "" }));
    expect(r.ok && r.patch.currentPeriodEnd).toBeNull();
  });

  it("a stored seconds-precision deadline re-seeded into the input is not a change", () => {
    // datetime-local carries minutes only; without minute-rounded comparison a
    // panel would open permanently dirty.
    const b = baseline({ currentPeriodEnd: new Date("2026-12-01T10:20:37Z").toISOString() });
    const r = buildSubscriptionPatch(b, draft(b));
    expect(r.ok && r.changedFields).not.toContain("currentPeriodEnd");
  });

  it("rejects an impossible calendar date instead of sending it", () => {
    const b = baseline();
    const r = buildSubscriptionPatch(b, draft(b, { currentPeriodEnd: "2026-02-30T10:00" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("currentPeriodEnd");
  });

  it("grace days without any paid-through anchor fails with a readable message", () => {
    const b = baseline({ currentPeriodEnd: null });
    const r = buildSubscriptionPatch(b, draft(b, { graceDays: "5" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("paid-through");
  });

  it("grace days alone resends the existing period end as the anchor", () => {
    const b = baseline();
    const r = buildSubscriptionPatch(b, draft(b, { graceDays: "5" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.gracePeriodDays).toBe(5);
      expect(new Date(String(r.patch.currentPeriodEnd)).getTime()).toBe(
        new Date(b.currentPeriodEnd as string).getTime(),
      );
    }
  });

  it("grace days + a new end date anchor on the NEW date", () => {
    const b = baseline();
    // Minute-aligned: datetime-local inputs carry no seconds, so the patch
    // anchor equals the typed wall-clock minute, not the raw Date.now() value.
    const next = new Date(Math.floor((Date.now() + 40 * DAY) / 60_000) * 60_000);
    const r = buildSubscriptionPatch(b, draft(b, {
      currentPeriodEnd: isoToLocalInput(next.toISOString()),
      graceDays: "3",
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.gracePeriodDays).toBe(3);
      expect(new Date(String(r.patch.currentPeriodEnd)).getTime()).toBe(next.getTime());
    }
  });

  it("grace value unchanged from the stored window is not a change", () => {
    const end = new Date("2026-12-01T00:00:00Z");
    const b = baseline({
      currentPeriodEnd: end.toISOString(),
      graceEndsAt: new Date(end.getTime() + 7 * DAY).toISOString(),
    });
    const r = buildSubscriptionPatch(b, draft(b));
    expect(r.ok && r.changedFields).not.toContain("gracePeriodDays");
  });

  it("out-of-range grace days are rejected", () => {
    const b = baseline();
    expect(buildSubscriptionPatch(b, draft(b, { graceDays: "4000" })).ok).toBe(false);
    expect(buildSubscriptionPatch(b, draft(b, { graceDays: "abc" })).ok).toBe(false);
  });

  it("an untrimmed reason is trimmed and capped", () => {
    const b = baseline();
    const r = buildSubscriptionPatch(b, draft(b, { status: "trial", reason: "  renewed verbally  " }));
    expect(r.ok && r.patch.reason).toBe("renewed verbally");
  });
});
