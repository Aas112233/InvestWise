import { describe, expect, it } from "vitest";
import { navItemForRoute, screenForRoute } from "./navigation";

describe("screenForRoute", () => {
  it("maps nav screens by exact route", () => {
    expect(screenForRoute("/")).toBe("DASHBOARD");
    expect(screenForRoute("/members")).toBe("MEMBERS");
    expect(screenForRoute("/deposits")).toBe("DEPOSITS");
    expect(screenForRoute("/settings")).toBe("SETTINGS");
  });

  it("maps dynamic sub-routes by prefix", () => {
    expect(screenForRoute("/members/123")).toBe("MEMBERS");
    expect(screenForRoute("/projects/abc/reports")).toBe("PROJECT_MANAGEMENT");
  });

  it("prefers the longest matching prefix", () => {
    // /deposits/request must resolve to REQUEST_DEPOSIT, not DEPOSITS.
    expect(screenForRoute("/deposits/request")).toBe("REQUEST_DEPOSIT");
  });

  it("maps the /request-deposit alias", () => {
    expect(screenForRoute("/request-deposit")).toBe("REQUEST_DEPOSIT");
  });

  it("does not match partial segment names", () => {
    expect(screenForRoute("/depositsX")).toBeNull();
    expect(screenForRoute("/members-archive")).toBeNull();
  });

  it("returns null for unmapped routes", () => {
    expect(screenForRoute("/unknown")).toBeNull();
    expect(screenForRoute("/login")).toBeNull();
  });
});

describe("navItemForRoute", () => {
  it("resolves the localized label key the tab title uses", () => {
    expect(navItemForRoute("/")?.labelKey).toBe("nav.dashboard");
    expect(navItemForRoute("/deposits")?.labelKey).toBe("nav.deposits");
    expect(navItemForRoute("/deposits/request")?.labelKey).toBe("nav.requestDeposit");
    expect(navItemForRoute("/members/123")?.labelKey).toBe("nav.members");
  });

  it("borrows the label of the screen an alias route renders", () => {
    expect(navItemForRoute("/request-deposit")?.labelKey).toBe("nav.requestDeposit");
  });

  it("returns null for routes with no nav entry", () => {
    expect(navItemForRoute("/login")).toBeNull();
  });
});
