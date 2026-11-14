import { describe, it, expect } from "vitest";
import {
  parseDistributionRules,
  sanitizeDistributionRules,
  distributionRulesToBp,
  distributionRulesSumBp,
  isProjectMemberRole,
  parseProjectMemberOverrideBp,
  withProjectMemberOverride,
  effectiveProjectMemberBp,
  assertProjectRulesFit,
  parseProjectType,
  isProjectType,
  pmCapitalCents,
  clubCapitalCeilingCents,
  splitPmCapitalCents,
  splitProjectPool,
  assertProjectDistributionContract,
  assertProjectTypeRoster,
  splitPmContractBp,
} from "./distribution-rules";
import { MoneyError, splitByTypeAndShares } from "./money";
import { type MemberRole } from "./member-roles";

describe("parseDistributionRules — the one semantic gate", () => {
  it("accepts a valid list and normalizes percent through basis points", () => {
    const rules = parseDistributionRules([
      { role: "Board Member", percent: 15 },
      { role: "Shareholder Member", percent: 60.5 },
    ]);
    expect(rules).toEqual([
      { role: "Board Member", percent: 15 },
      { role: "Shareholder Member", percent: 60.5 },
    ]);
  });

  it("refuses the retired categories (six-category vocabulary, migration 0029)", () => {
    for (const role of ["Member", "Investor", "Associate Member", "Founding Member", "Project Member"]) {
      expect(() => parseDistributionRules([{ role, percent: 10 }])).toThrow(/Unknown member category/);
    }
  });

  it("treats null/undefined as not-configured (empty list)", () => {
    expect(parseDistributionRules(null)).toEqual([]);
    expect(parseDistributionRules(undefined)).toEqual([]);
    expect(parseDistributionRules([])).toEqual([]);
  });

  it("refuses unknown member categories", () => {
    expect(() => parseDistributionRules([{ role: "CEO", percent: 10 }])).toThrow(
      /Unknown member category/,
    );
  });

  it("refuses duplicate categories", () => {
    expect(() =>
      parseDistributionRules([
        { role: "Shareholder Member", percent: 10 },
        { role: "Shareholder Member", percent: 20 },
      ]),
    ).toThrow(/Duplicate/);
  });

  it("refuses a percent sum above 100", () => {
    expect(() =>
      parseDistributionRules([
        { role: "Shareholder Member", percent: 60 },
        { role: "Board Member", percent: 40.01 },
      ]),
    ).toThrow(/exceed 100%/);
  });

  it("accepts exactly 100 in total", () => {
    const rules = parseDistributionRules([
      { role: "Shareholder Member", percent: 60 },
      { role: "Board Member", percent: 40 },
    ]);
    expect(rules).toHaveLength(2);
  });

  it("refuses bad percents: zero, negative, >100, >2dp, non-numeric", () => {
    expect(() => parseDistributionRules([{ role: "Shareholder Member", percent: 0 }])).toThrow();
    expect(() => parseDistributionRules([{ role: "Shareholder Member", percent: -5 }])).toThrow();
    expect(() => parseDistributionRules([{ role: "Shareholder Member", percent: 100.01 }])).toThrow();
    expect(() => parseDistributionRules([{ role: "Shareholder Member", percent: 12.345 }])).toThrow();
    expect(() => parseDistributionRules([{ role: "Shareholder Member", percent: "ten" }])).toThrow();
  });

  it("refuses garbage shapes (non-array, non-objects, oversized)", () => {
    expect(() => parseDistributionRules("nope")).toThrow();
    expect(() => parseDistributionRules([null])).toThrow();
    expect(() => parseDistributionRules(["x"])).toThrow();
    const many = Array.from({ length: 17 }, (_, i) => ({ role: "Shareholder Member", percent: i + 0.01 }));
    // dedupe is impossible past 16 entries anyway, but the cap fires first:
    expect(() => parseDistributionRules(many as never)).toThrow(/at most/);
  });
});

describe("sanitizeDistributionRules — the fail-safe read path", () => {
  it("drops invalid entries instead of failing the settings page", () => {
    const out = sanitizeDistributionRules([
      { role: "Board Member", percent: 10 },
      { role: "CEO", percent: 5 }, // unknown role
      { role: "Board Member", percent: 20 }, // duplicate
      { role: "Shareholder Member", percent: 0 }, // invalid percent
      null,
      "junk",
    ]);
    expect(out).toEqual([{ role: "Board Member", percent: 10 }]);
  });

  it("reads null/non-array as an empty list", () => {
    expect(sanitizeDistributionRules(null)).toEqual([]);
    expect(sanitizeDistributionRules("nope")).toEqual([]);
  });

  it("drops the rules that push the total past 100%", () => {
    const out = sanitizeDistributionRules([
      { role: "Board Member", percent: 70 },
      { role: "Member", percent: 40 },
    ]);
    expect(out).toEqual([{ role: "Board Member", percent: 70 }]);
  });
});

describe("distributionRulesToBp / sum / role helpers", () => {
  it("maps roles to integer basis points", () => {
    const bp = distributionRulesToBp([{ role: "Board Member", percent: 12.5 }]);
    expect(bp.get("Board Member")).toBe(1250);
  });

  it("sums configured percents in bp", () => {
    const rules = parseDistributionRules([
      { role: "Board Member", percent: 12.5 },
      { role: "Shareholder Member", percent: 30 },
    ]);
    expect(distributionRulesSumBp(rules)).toBe(4250);
  });

  it("identifies the exclusive project category", () => {
    expect(isProjectMemberRole("Project Level Member")).toBe(true);
    expect(isProjectMemberRole("Project Member")).toBe(false); // retired 2026-11-12
    expect(isProjectMemberRole("Member")).toBe(false);
    expect(isProjectMemberRole(undefined)).toBe(false);
  });
});

describe("per-project Project Level Member override (migration 0030)", () => {
  const clubMap = (...entries: Array<[MemberRole, number]>) => new Map<MemberRole, number>(entries);

  it("reads blank stored values as 'no override', percents as basis points", () => {
    expect(parseProjectMemberOverrideBp(null)).toBeNull();
    expect(parseProjectMemberOverrideBp(undefined)).toBeNull();
    expect(parseProjectMemberOverrideBp("")).toBeNull();
    // decimal(5,2) arrives as driver text; user input as number — same result.
    expect(parseProjectMemberOverrideBp("12.50")).toBe(1250);
    expect(parseProjectMemberOverrideBp(12.5)).toBe(1250);
  });

  it("applies the full percent contract to overrides", () => {
    for (const bad of [0, "0", "0.00", -5, 100.01, "100.01", "3.333", "abc", {}, []]) {
      expect(() => parseProjectMemberOverrideBp(bad)).toThrow(MoneyError);
    }
  });

  it("the override replaces the club PM percent; other club rules survive", () => {
    const club = clubMap(["Board Member", 2000], ["Project Level Member", 3000]);
    const effective = withProjectMemberOverride(club, "12.50");
    expect(effective.get("Project Level Member")).toBe(1250);
    expect(effective.get("Board Member")).toBe(2000);
    // The caller's club map is never mutated — one project's run cannot leak
    // its override into another project's preview.
    expect(club.get("Project Level Member")).toBe(3000);
  });

  it("null override keeps the club rules byte-identically", () => {
    const club = clubMap(["Board Member", 2000], ["Project Level Member", 3000]);
    expect([...withProjectMemberOverride(club, null).entries()]).toEqual([...club.entries()]);
  });

  it("an override works with NO club rules at all (project-only carve-out)", () => {
    const effective = withProjectMemberOverride(new Map(), "20");
    expect([...effective.entries()]).toEqual([["Project Level Member", 2000]]);
  });

  it("effective percent: project first, club second, null when neither", () => {
    const club = clubMap(["Project Level Member", 3000]);
    expect(effectiveProjectMemberBp(club, "12.50")).toBe(1250); // project wins
    expect(effectiveProjectMemberBp(club, null)).toBe(3000); // club fallback
    expect(effectiveProjectMemberBp(new Map(), null)).toBeNull(); // unconfigured
  });

  it("sum guard measures the EFFECTIVE set, not the stored club set", () => {
    // Club: Board 40% + PM 10% = 50 (valid). Project override 65% → 40+65=105 > 100.
    const club = clubMap(["Board Member", 4000], ["Project Level Member", 1000]);
    expect(() => assertProjectRulesFit(club, "10")).not.toThrow();
    expect(() => assertProjectRulesFit(club, "60")).not.toThrow(); // exactly 100
    expect(() => assertProjectRulesFit(club, "65")).toThrow(/exceed 100% in total/);
    // Clearing the override can only shrink or keep the club sum → always fits.
    expect(() => assertProjectRulesFit(club, null)).not.toThrow();
  });

  it("sum guard fits an override with no club rules", () => {
    expect(() => assertProjectRulesFit(new Map(), "100")).not.toThrow();
    expect(() => assertProjectRulesFit(new Map(), "100.01")).toThrow(MoneyError); // contract first
  });

  it("user scenario (2026-11-12): club 88+12 = 100% is fine ALONE, but a 50% project override must not sneak past", () => {
    // This exact combination rendered a preview of +BDT 0.00 rows because the
    // modal swallowed the engine's PERCENT_SUM_EXCEEDED. The guard itself was
    // always right — Settings now also refuses the rules side (PUT gate).
    const club = clubMap(["Board Member", 8800], ["Shareholder Member", 1200]);
    expect(() => assertProjectRulesFit(club, null)).not.toThrow(); // club alone: exactly 100
    expect(() => assertProjectRulesFit(club, "50.00")).toThrow(/exceed 100% in total/); // effective 150
    // A club rule FOR the PM category is REPLACED by the override, not added.
    const clubWithPm = clubMap(["Board Member", 8800], ["Shareholder Member", 200], ["Project Level Member", 1000]);
    expect(() => assertProjectRulesFit(clubWithPm, "10.00")).not.toThrow(); // same 100 total
  });
});

/* --------------------------------------------------------------------------
 * Project types (migration 0032, docs/PROJECT-TYPES_PLAN.md)
 * ------------------------------------------------------------------------ */

describe("project type vocabulary", () => {
  it("accepts the two types and defaults a missing one to club_level", () => {
    expect(parseProjectType("club_level")).toBe("club_level");
    expect(parseProjectType("extra_investor")).toBe("extra_investor");
    expect(parseProjectType(null)).toBe("club_level");
    expect(parseProjectType(undefined)).toBe("club_level");
    expect(parseProjectType("")).toBe("club_level");
    expect(isProjectType("club_level")).toBe(true);
    expect(isProjectType("Club Level")).toBe(false);
  });

  it("fails loud on an unknown stored value instead of guessing a split", () => {
    expect(() => parseProjectType("partnership")).toThrow(MoneyError);
  });
});

describe("capital side of the contract (extra investor)", () => {
  it("PM capital = floor(budget x percent); the club ceiling is exact by subtraction", () => {
    // BDT 500,000.00 budget, 50% contract.
    expect(pmCapitalCents(50_000_000, 5000)).toBe(25_000_000);
    expect(clubCapitalCeilingCents(50_000_000, 5000)).toBe(25_000_000);
    // A percent that does not divide: 1/3 of 100 cents = 33, club keeps 67.
    expect(pmCapitalCents(100, 3333)).toBe(33);
    expect(clubCapitalCeilingCents(100, 3333)).toBe(67);
    // Conservation holds for every budget -> pm + club === budget.
    for (const budget of [1, 7, 999, 12_345_67, 50_000_000]) {
      for (const bp of [1, 1250, 5000, 9999, 10_000]) {
        expect(pmCapitalCents(budget, bp) + clubCapitalCeilingCents(budget, bp)).toBe(budget);
      }
    }
  });

  it("splits the contract equally across the PMs, residue by id, summing exactly", () => {
    const out = splitPmCapitalCents(25_000_000, ["pm-b", "pm-a"]);
    expect([...out.entries()]).toEqual([
      ["pm-a", 12_500_000],
      ["pm-b", 12_500_000],
    ]);
    const odd = splitPmCapitalCents(100, ["pm-a", "pm-b", "pm-c"]);
    expect([...odd.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect(odd.get("pm-a")).toBe(34);
  });

  it("refuses a contract percent outside (0, 100]", () => {
    expect(() => pmCapitalCents(1000, 0)).toThrow(MoneyError);
    expect(() => pmCapitalCents(1000, 10_001)).toThrow(MoneyError);
    expect(() => pmCapitalCents(1000, 12.5)).toThrow(MoneyError);
  });
});

describe("splitProjectPool — club_level is the shipped engine, untouched", () => {
  const club = new Map<MemberRole, number>([
    ["Board Member", 8800],
    ["Shareholder Member", 1200],
  ]);
  const members = [
    { id: "board", shares: 10, role: "Board Member" },
    { id: "shareholder", shares: 90, role: "Shareholder Member" },
  ];

  it("matches splitByTypeAndShares exactly (category rules + inside-category pro-rata)", () => {
    const outcome = splitProjectPool({
      projectType: "club_level",
      poolCents: 100_000,
      members,
      clubRulesBp: club,
    });
    const reference = splitByTypeAndShares(100_000, members, club);
    expect(outcome.payouts).toEqual(reference.payouts);
    expect(outcome.typeBlocks).toEqual(reference.typeBlocks);
    expect(outcome.remainderCents).toBe(reference.remainderCents);
    expect(outcome.pmCarveCents).toBe(0);
  });

  it("still honours the project's PM override for the PM category", () => {
    const withPm = [...members, { id: "pm", shares: 5, role: "Project Level Member" }];
    const outcome = splitProjectPool({
      projectType: "club_level",
      poolCents: 100_000,
      members: withPm,
      clubRulesBp: new Map<MemberRole, number>([["Project Level Member", 1000]]),
      projectMemberPercent: "30.00",
    });
    const blocks = new Map(outcome.typeBlocks.map((b) => [b.role, b]));
    expect(blocks.get("Project Level Member")?.bp).toBe(3000); // override, not the club 10%
  });

  it("keeps the Σ≤100 guard on a club project", () => {
    expect(() =>
      splitProjectPool({
        projectType: "club_level",
        poolCents: 100_000,
        members,
        clubRulesBp: club, // 88 + 12 = 100
        projectMemberPercent: "50.00", // effective 150 → refused
      }),
    ).toThrow(/exceed 100%/);
  });
});

describe("splitProjectPool — extra_investor (contract first, remainder by shares)", () => {
  // The live test project: budget BDT 500,000, PM contract 50%, Board 12 shares,
  // Shareholder 50 shares, and a PM row that still carries 20 legacy shares
  // (excluded by construction — a contract replaced shares).
  const members = [
    { id: "board", shares: 12, role: "Board Member" },
    { id: "pm", shares: 20, role: "Project Level Member" },
    { id: "shareholder", shares: 50, role: "Shareholder Member" },
  ];
  const club88 = new Map<MemberRole, number>([
    ["Board Member", 8800],
    ["Shareholder Member", 1200],
  ]);

  it("plan worked example: pool BDT 273,069.00 at 50% → exact to the poisha", () => {
    const poolCents = 27_306_900;
    const outcome = splitProjectPool({
      projectType: "extra_investor",
      poolCents,
      members,
      clubRulesBp: club88,
      projectMemberPercent: "50.00",
    });
    const byId = new Map(outcome.payouts.map((p) => [p.id, p.payoutCents]));
    expect(byId.get("pm")).toBe(13_653_450); // BDT 136,534.50
    expect(byId.get("board")).toBe(2_642_603); // BDT 26,426.03
    expect(byId.get("shareholder")).toBe(11_010_847); // BDT 110,108.47 (+1 residue cent)
    expect([...byId.values()].reduce((a, b) => a + b, 0)).toBe(poolCents);
    expect(outcome.pmCarveCents).toBe(13_653_450);
    expect(outcome.remainderCents).toBe(13_653_450);
    // The club half is 12:50 — the PM's 20 legacy shares are NOT in the ratio.
    expect(byId.get("board")! / byId.get("shareholder")!).toBeCloseTo(12 / 50, 2);
  });

  it("ignores the category rules entirely — 88/12 cannot distort the remainder", () => {
    const noRules = splitProjectPool({
      projectType: "extra_investor",
      poolCents: 27_306_900,
      members,
      clubRulesBp: new Map(),
      projectMemberPercent: "50.00",
    });
    const withRules = splitProjectPool({
      projectType: "extra_investor",
      poolCents: 27_306_900,
      members,
      clubRulesBp: club88,
      projectMemberPercent: "50.00",
    });
    expect(withRules.payouts).toEqual(noRules.payouts);
  });

  it("records one contract block for the trail, with the contract percent", () => {
    const outcome = splitProjectPool({
      projectType: "extra_investor",
      poolCents: 1_000_000,
      members,
      clubRulesBp: new Map(),
      projectMemberPercent: "40",
    });
    expect(outcome.typeBlocks).toEqual([
      { role: "Project Level Member", bp: 4000, amountCents: 400_000, memberCount: 1 },
    ]);
    expect(outcome.remainderCents).toBe(600_000);
  });

  it("splits one contract between several PMs equally, residue deterministic", () => {
    const threePms = [
      { id: "b1", shares: 10, role: "Board Member" },
      { id: "pm-a", shares: 0, role: "Project Level Member" },
      { id: "pm-b", shares: 0, role: "Project Level Member" },
      { id: "pm-c", shares: 0, role: "Project Level Member" },
    ];
    const outcome = splitProjectPool({
      projectType: "extra_investor",
      poolCents: 1000,
      members: threePms,
      clubRulesBp: new Map(),
      projectMemberPercent: "50", // carve 500 → 167/167/166
    });
    const byId = new Map(outcome.payouts.map((p) => [p.id, p.payoutCents]));
    expect(byId.get("pm-a")).toBe(167);
    expect(byId.get("pm-b")).toBe(167);
    expect(byId.get("pm-c")).toBe(166);
    expect(byId.get("b1")).toBe(500);
    expect([...byId.values()].reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("a 100% contract pays the PMs only and needs no club shares", () => {
    const onlyPm = [{ id: "pm", shares: 0, role: "Project Level Member" }];
    const outcome = splitProjectPool({
      projectType: "extra_investor",
      poolCents: 123_456,
      members: onlyPm,
      clubRulesBp: new Map(),
      projectMemberPercent: "100",
    });
    expect(outcome.payouts).toEqual([{ id: "pm", shares: 0, payoutCents: 123_456 }]);
    expect(outcome.remainderCents).toBe(0);
  });

  it("fails loud instead of splitting silently wrong", () => {
    // No contract percentage at all.
    expect(() =>
      splitProjectPool({
        projectType: "extra_investor",
        poolCents: 1000,
        members,
        clubRulesBp: new Map(),
        projectMemberPercent: null,
      }),
    ).toThrow(/no Project Level Member contract percentage/i);
    // Contract claims cents but the project has no PM row.
    expect(() =>
      splitProjectPool({
        projectType: "extra_investor",
        poolCents: 1000,
        members: [{ id: "board", shares: 10, role: "Board Member" }],
        clubRulesBp: new Map(),
        projectMemberPercent: "50",
      }),
    ).toThrow(/no Project Level Member on it/i);
    // Remainder with cents but nobody holding shares to take it.
    expect(() =>
      splitProjectPool({
        projectType: "extra_investor",
        poolCents: 1000,
        members: [{ id: "pm", shares: 0, role: "Project Level Member" }],
        clubRulesBp: new Map(),
        projectMemberPercent: "50",
      }),
    ).toThrow(/No Board or Shareholder shares/i);
    // Non-positive pool never reaches a split.
    expect(() =>
      splitProjectPool({
        projectType: "extra_investor",
        poolCents: 0,
        members,
        clubRulesBp: new Map(),
        projectMemberPercent: "50",
      }),
    ).toThrow(/positive integer-cent/);
  });

  it("is deterministic across repeated calls (audit reproducibility)", () => {
    const run = () =>
      splitProjectPool({
        projectType: "extra_investor",
        poolCents: 7_777_777,
        members,
        clubRulesBp: club88,
        projectMemberPercent: "33.33",
      }).payouts;
    expect(run()).toEqual(run());
  });
});

describe("assertProjectDistributionContract — the run-time gate", () => {
  const pmMember = { role: "Project Level Member" };
  const clubMember = { role: "Board Member" };

  it("refuses Project Level Members on a club_level project", () => {
    expect(() =>
      assertProjectDistributionContract({
        projectType: "club_level",
        projectMemberPercent: null,
        members: [clubMember, pmMember],
      }),
    ).toThrow(/Club Level project cannot include Project Level Members/);
    expect(() =>
      assertProjectDistributionContract({
        projectType: "club_level",
        projectMemberPercent: null,
        members: [clubMember],
      }),
    ).not.toThrow();
  });

  it("requires a contract on an extra_investor project that holds PMs", () => {
    expect(() =>
      assertProjectDistributionContract({
        projectType: "extra_investor",
        projectMemberPercent: "  ",
        members: [clubMember, pmMember],
      }),
    ).toThrow(MoneyError);
    expect(() =>
      assertProjectDistributionContract({
        projectType: "extra_investor",
        projectMemberPercent: "50.00",
        members: [clubMember, pmMember],
      }),
    ).not.toThrow();
    // No PMs yet: nothing to pay, nothing to enforce (the form still asks).
    expect(() =>
      assertProjectDistributionContract({
        projectType: "extra_investor",
        projectMemberPercent: null,
        members: [clubMember],
      }),
    ).not.toThrow();
  });
});

describe("assertProjectTypeRoster — the save-time gate (migration 0032, §5)", () => {
  const PM = "Project Level Member";
  const BOARD = "Board Member";

  it("club_level refuses Project Level Members, naming the participants field", () => {
    expect(() =>
      assertProjectTypeRoster({
        projectType: "club_level",
        projectMemberPercent: null,
        participantRoles: [BOARD, PM],
      }),
    ).toThrow(/PM_NOT_ALLOWED_IN_CLUB_PROJECT/);
    expect(() =>
      assertProjectTypeRoster({
        projectType: "club_level",
        projectMemberPercent: null,
        participantRoles: [BOARD, "Shareholder Member"],
      }),
    ).not.toThrow();
  });

  it("club_level refuses a stored percentage too (the v9 conflict class, deleted)", () => {
    expect(() =>
      assertProjectTypeRoster({
        projectType: "club_level",
        projectMemberPercent: "12.50",
        participantRoles: [BOARD],
      }),
    ).toThrow(/PERCENT_NOT_ALLOWED_IN_CLUB_PROJECT/);
    // Clearing it (null) is the repair the message asks for.
    expect(() =>
      assertProjectTypeRoster({
        projectType: "club_level",
        projectMemberPercent: null,
        participantRoles: [BOARD],
      }),
    ).not.toThrow();
  });

  it("extra_investor needs the contract exactly when a PM is on the roster", () => {
    expect(() =>
      assertProjectTypeRoster({
        projectType: "extra_investor",
        projectMemberPercent: null,
        participantRoles: [BOARD, PM],
      }),
    ).toThrow(/PM_PERCENT_REQUIRED/);
    expect(() =>
      assertProjectTypeRoster({
        projectType: "extra_investor",
        projectMemberPercent: "50.00",
        participantRoles: [BOARD, PM],
      }),
    ).not.toThrow();
    // No PM row yet (bound later from the member screen): no contract demanded.
    expect(() =>
      assertProjectTypeRoster({
        projectType: "extra_investor",
        projectMemberPercent: null,
        participantRoles: [BOARD],
      }),
    ).not.toThrow();
  });

  it("an extra_investor contract is NOT added to the club categories", () => {
    // The 150% screenshot bug: club rules Board 88 + Shareholder 12 (= 100) next
    // to a 50% PM contract. Legal here on purpose — the two percentage sets are
    // never summed for this type; the resolver splits pool × 50% then shares.
    expect(() =>
      assertProjectTypeRoster({
        projectType: "extra_investor",
        projectMemberPercent: "50.00",
        participantRoles: [BOARD, "Shareholder Member", PM],
      }),
    ).not.toThrow();
  });

  it("the percent contract still applies: 0, >100, 3dp are refused", () => {
    for (const bad of ["0", "100.01", "3.333", "abc"]) {
      expect(() =>
        assertProjectTypeRoster({
          projectType: "extra_investor",
          projectMemberPercent: bad,
          participantRoles: [PM],
        }),
      ).toThrow(MoneyError);
    }
  });

  it("an empty roster is always acceptable (a project before its first member)", () => {
    for (const projectType of ["club_level", "extra_investor"] as const) {
      expect(() =>
        assertProjectTypeRoster({ projectType, projectMemberPercent: null, participantRoles: [] }),
      ).not.toThrow();
    }
  });
});

describe("splitPmContractBp — the display split of one contract", () => {
  it("splits equally and sums to exactly the contract", () => {
    const out = splitPmContractBp(5000, ["pm-a", "pm-b", "pm-c"]);
    expect([...out.values()].reduce((a, b) => a + b, 0)).toBe(5000);
    expect([...out.values()]).toEqual([1667, 1667, 1666]);
  });

  it("one PM carries the whole contract", () => {
    expect([...splitPmContractBp(5000, ["pm-a"]).values()]).toEqual([5000]);
  });

  it("refuses a percent outside (0, 10000] bp", () => {
    expect(() => splitPmContractBp(0, ["pm-a"])).toThrow(MoneyError);
    expect(() => splitPmContractBp(10_001, ["pm-a"])).toThrow(MoneyError);
  });
});
