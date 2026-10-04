import { describe, it, expect } from "vitest";
import { updateSettingsSchema } from "./utils/validation";
import {
  DEFAULT_TENANT_MEETING_TYPES,
  DEFAULT_TENANT_PENALTY_RULES,
} from "./use-tenant-settings";

describe("Settings Module Validation and Configurations", () => {
  it("validates organization settings schema", () => {
    const valid = updateSettingsSchema.safeParse({
      organization: {
        companyName: "Acme Investments Ltd",
        companyTagline: "Growing Together",
        companyAddress: "123 Commercial Ave, Dhaka",
        companyEmail: "info@acme.com",
        companyPhone: "+8801700000000",
        companyWebsite: "https://acme.com",
        companyRegNo: "REG-99824",
      },
    });
    expect(valid.success).toBe(true);

    const emptyEmail = updateSettingsSchema.safeParse({
      organization: {
        companyName: "Test Co",
        companyEmail: "",
      },
    });
    expect(emptyEmail.success).toBe(true);

    const invalidEmail = updateSettingsSchema.safeParse({
      organization: {
        companyEmail: "not-an-email",
      },
    });
    expect(invalidEmail.success).toBe(false);
  });

  it("validates financial settings schema", () => {
    const valid = updateSettingsSchema.safeParse({
      financial: {
        fiscalYearStart: "July",
        fiscalYearEnd: "June",
        baseCurrency: "USD",
        taxRate: 12.5,
        accountingMethod: "Accrual",
        shareValueBdt: 2500,
        withdrawalLimitPercent: 30,
        withdrawalNoticeDays: 45,
        maxWithdrawalPerRequest: 50000,
        statutoryReservePercent: 15,
      },
    });
    expect(valid.success).toBe(true);

    // Negative share value should fail
    const invalidShare = updateSettingsSchema.safeParse({
      financial: {
        shareValueBdt: -500,
      },
    });
    expect(invalidShare.success).toBe(false);
  });

  it("validates governance settings schema with new thresholds", () => {
    const valid = updateSettingsSchema.safeParse({
      governance: {
        monthlyMeetingDay: 7,
        depositDueDate: 12,
        gracePeriodDays: 5,
        lateDepositGraceMonths: 2,
        inactiveAfterMonths: 4,
        suspendedAfterMonths: 8,
        meetingTypes: ["FOUNDING_MEMBER", "INVESTOR", "ANNUAL_GENERAL_MEETING"],
        penaltyRules: [
          { tier: 1, title: "1st Warning", type: "VERBAL_WARNING", deductionAmount: 0, isPercentage: false },
          { tier: 2, title: "2nd Fine", type: "FUND_DEDUCTION", deductionAmount: 100, isPercentage: false },
          { tier: 3, title: "3rd Fine", type: "FUND_DEDUCTION", deductionAmount: 300, isPercentage: false },
          { tier: 4, title: "Suspension", type: "SUSPENSION", deductionAmount: 1000, isPercentage: false },
        ],
      },
    });
    expect(valid.success).toBe(true);

    // Out of bound meeting day should fail
    const invalidDay = updateSettingsSchema.safeParse({
      governance: {
        monthlyMeetingDay: 31,
      },
    });
    expect(invalidDay.success).toBe(false);
  });

  it("validates system settings across all 4 locales", () => {
    for (const lang of ["English", "Bengali", "Urdu", "Hindi"] as const) {
      const valid = updateSettingsSchema.safeParse({
        system: {
          language: lang,
          theme: "Dark",
          refreshInterval: "5 minutes",
          dateFormat: "YYYY-MM-DD",
          isMaintenanceMode: false,
        },
      });
      expect(valid.success).toBe(true);
    }

    const unsupportedLang = updateSettingsSchema.safeParse({
      system: {
        language: "German" as any,
      },
    });
    expect(unsupportedLang.success).toBe(false);

    // Validate theme options
    for (const theme of ["Light", "Dark", "System Default"] as const) {
      const res = updateSettingsSchema.safeParse({
        system: { theme },
      });
      expect(res.success).toBe(true);
    }
  });

  it("exposes default meeting types and penalty rules", () => {
    expect(DEFAULT_TENANT_MEETING_TYPES).toContain("FOUNDING_MEMBER");
    expect(DEFAULT_TENANT_MEETING_TYPES).toContain("SHAREHOLDER");
    expect(DEFAULT_TENANT_MEETING_TYPES).toContain("INVESTOR");

    expect(DEFAULT_TENANT_PENALTY_RULES.length).toBe(4);
    expect(DEFAULT_TENANT_PENALTY_RULES[0]?.type).toBe("VERBAL_WARNING");
    expect(DEFAULT_TENANT_PENALTY_RULES[1]?.type).toBe("FUND_DEDUCTION");
    expect(DEFAULT_TENANT_PENALTY_RULES[3]?.type).toBe("SUSPENSION");
  });
});
