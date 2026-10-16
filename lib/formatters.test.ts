import { describe, it, expect } from "vitest";
import { endOfRangeUtc, formatDatePattern } from "./formatters";

describe("endOfRangeUtc", () => {
  it("covers the whole final day of a date-only range end", () => {
    // A deposit collected at 10:00 on the 31st must be INSIDE a March range.
    const end = endOfRangeUtc("2026-03-31");
    expect(end.toISOString()).toBe("2026-03-31T23:59:59.999Z");
    expect(new Date("2026-03-31T10:00:00.000Z").getTime()).toBeLessThanOrEqual(end.getTime());
  });

  it("handles short months without spilling into the next", () => {
    expect(endOfRangeUtc("2026-02-28").toISOString()).toBe("2026-02-28T23:59:59.999Z");
    expect(endOfRangeUtc("2026-04-30").toISOString()).toBe("2026-04-30T23:59:59.999Z");
  });

  it("passes a full ISO instant through unchanged", () => {
    const iso = "2026-03-31T12:00:00.000Z";
    expect(endOfRangeUtc(iso).toISOString()).toBe(iso);
  });
});

describe("formatDatePattern", () => {
  it("renders the tenant pattern and never throws on bad input", () => {
    // Midday UTC keeps the local calendar day stable across test-runner timezones.
    expect(formatDatePattern("2026-03-05T12:00:00.000Z", "DD/MM/YYYY")).toBe("05/03/2026");
    expect(formatDatePattern(null)).toBe("-");
    expect(formatDatePattern("not-a-date")).toBe("-");
  });
});
