import { describe, expect, it } from "vitest";
import { parseFieldError } from "./errors";

describe("parseFieldError — the client reader of the §11 wire format", () => {
  it("splits the exact project-form rejection into field, code and clean sentence", () => {
    const parsed = parseFieldError(
      "[Field 'projectMemberPercent', Code: PERCENT_SUM_EXCEEDED] This project\u2019s Project Level Member percentage plus the configured club categories exceed 100% in total",
    );
    expect(parsed.field).toBe("projectMemberPercent");
    expect(parsed.code).toBe("PERCENT_SUM_EXCEEDED");
    expect(parsed.message).toBe(
      "This project\u2019s Project Level Member percentage plus the configured club categories exceed 100% in total",
    );
  });

  it("keeps dotted and nested field names intact", () => {
    const parsed = parseFieldError("[Field 'shareholders.sourceFundId', Code: required] Select the deposit fund.");
    expect(parsed.field).toBe("shareholders.sourceFundId");
    expect(parsed.code).toBe("required");
    expect(parsed.message).toBe("Select the deposit fund.");
  });

  it("passes non-matching text through untouched — a server error is never lost to parsing", () => {
    for (const raw of ["Network error", "", "500 Internal Server Error", "[Field 'x' broken"]) {
      const parsed = parseFieldError(raw);
      expect(parsed.field).toBeNull();
      expect(parsed.code).toBeNull();
      expect(parsed.message).toBe(raw);
    }
  });

  it("survives junk input and a bracketed but empty sentence", () => {
    expect(parseFieldError(null as unknown as string).message).toBe("");
    const empty = parseFieldError("[Field 'a', Code: x]");
    expect(empty.field).toBe("a");
    // An empty sentence must not render as a blank error: fall back to the raw text.
    expect(empty.message).toBe("[Field 'a', Code: x]");
  });
});
