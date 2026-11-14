import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Project types (migration 0032, docs/PROJECT-TYPES_PLAN.md) — the CAPITAL side,
 * against a real Postgres.
 *
 * `lib/project-capital.ts::investProjectCapital` is the one function the plan
 * names as real refactor risk (§10): it moves member equity and fund balances,
 * and an Extra Investor project now routes a Project Level Member row through a
 * DIFFERENT amount source (the derived contract, not shares × share value) while
 * keeping the same ledger legs. A pure unit test cannot see that — the numbers
 * come out of locked member and fund rows. So this suite drives the real
 * function against the real schema.
 *
 * NOTHING IS COMMITTED. Every case runs inside a transaction that ends in a
 * forced rollback, so the suite is safe against a database that holds real club
 * data, and the throwaway tenant/funds/members vanish with the transaction.
 *
 * Skipped (never silently passed) unless DATABASE_URL_TEST is set:
 *   DATABASE_URL_TEST=postgresql://... npx vitest run __tests__/project-type-capital.integration.test.ts
 */

const CONNECTION = process.env.DATABASE_URL_TEST;
if (CONNECTION) {
  // getDb() reads DATABASE_URL at import time — prime it before the dynamic
  // import below so the suite drives the app's own pool, not a parallel one.
  process.env.DATABASE_URL = CONNECTION;
}

/** Sentinel that unwinds the fixture transaction after each case. */
class Rollback extends Error {
  constructor() {
    super('project-type-capital: fixture rolled back');
  }
}

describe.skipIf(!CONNECTION)('project types: PM capital posting (migration 0032)', () => {
  // The fixture runs on the app's own transaction handle; naming it ny` 
  // locally would silence every column-typing mistake in this suite, which is
  // the opposite of what a money test is for.
  type Db = ReturnType<typeof getDb>;
  type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
  let getDb: () => any;
  let schema: typeof import('@/db/schema/index');
  let investProjectCapital: typeof import('@/lib/project-capital').investProjectCapital;

  beforeAll(async () => {
    ({ getDb } = await import('@/db/index'));
    schema = await import('@/db/schema/index');
    ({ investProjectCapital } = await import('@/lib/project-capital'));
  });

  interface Fixture {
    tx: Tx;
    tenantId: string;
    projectFundId: string;
    depositA: string;
    depositB: string;
    boardId: string;
    shareholderId: string;
    pmAId: string;
    pmBId: string;
  }

  /**
   * Creates a tenant with two deposit funds, one project fund and four members
   * (Board 12 shares, Shareholder 50 shares, two Project Level Members), runs
   * `body`, then rolls the whole thing back.
   */
  async function withFixture(body: (f: Fixture) => Promise<void>): Promise<void> {
    const db = getDb();
    const { tenants, funds, members } = schema;
    try {
      await db.transaction(async (tx: Tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({ slug: `pt-${randomUUID()}`.slice(0, 100), name: 'Project Type Test Club' })
          .returning();
        const tenantId = tenant.id as string;

        const [projectFund] = await tx
          .insert(funds)
          .values({ tenantId, name: 'Project Fund', type: 'PROJECT', status: 'ACTIVE', balance: '0.00' })
          .returning();
        const [depositA] = await tx
          .insert(funds)
          .values({ tenantId, name: 'Deposit A', type: 'DEPOSIT', status: 'ACTIVE', balance: '5000000.00' })
          .returning();
        const [depositB] = await tx
          .insert(funds)
          .values({ tenantId, name: 'Deposit B', type: 'DEPOSIT', status: 'ACTIVE', balance: '5000000.00' })
          .returning();

        const seeded: Record<string, string> = {};
        for (const [key, role] of [
          ['boardId', 'Board Member'],
          ['shareholderId', 'Shareholder Member'],
          ['pmAId', 'Project Level Member'],
          ['pmBId', 'Project Level Member'],
        ] as const) {
          const [member] = await tx
            .insert(members)
            .values({
              tenantId,
              memberId: `MEM-${randomUUID().slice(0, 8).toUpperCase()}`,
              name: `PT ${key}`,
              email: `pt-${key}-${randomUUID()}@test.invalid`,
              phone: '0000',
              role,
              shares: 0,
              status: 'active',
              // Enough equity for any case below: the tests are about WHERE the
              // money goes, not about the insufficient-balance branch.
              totalContributed: '1000000.00',
            })
            .returning();
          seeded[key] = member.id as string;
        }

        await body({
          tx,
          tenantId,
          projectFundId: projectFund.id,
          depositA: depositA.id,
          depositB: depositB.id,
          boardId: seeded.boardId!,
          shareholderId: seeded.shareholderId!,
          pmAId: seeded.pmAId!,
          pmBId: seeded.pmBId!,
        });

        throw new Rollback();
      });
    } catch (err) {
      if (err instanceof Rollback) return;
      throw err;
    }
  }

  const BUDGET_CENTS = 50_000_000; // BDT 500,000.00 — the live test project's budget
  const SHARE_VALUE = 1000; // BDT 1,000.00 per share (the tenant default)
  const now = () => new Date('2026-11-13T09:00:00Z');

  it('Extra Investor: the PM funds its derived contract, the club funds shares', async () => {
    await withFixture(async (f) => {
      const result = await investProjectCapital(f.tx, {
        tenantId: f.tenantId,
        shareValue: SHARE_VALUE,
        destinationFundId: f.projectFundId,
        budgetCents: BUDGET_CENTS,
        now: now(),
        projectType: 'extra_investor',
        projectMemberPercent: '50.00',
        shareholders: [
          { memberId: f.pmAId, shares: 0, sourceFundId: f.depositA },
          { memberId: f.boardId, shares: 12, sourceFundId: f.depositA },
          { memberId: f.shareholderId, shares: 50, sourceFundId: f.depositB },
        ],
      });

      // Contract = floor(500,000 × 50%) = 250,000. Club = 62 shares × 1,000.
      expect(result.contractCents).toBe(25_000_000);
      expect(result.clubCapitalCents).toBe(6_200_000);
      expect(result.totalCents).toBe(31_200_000);
      expect(result.totalShares).toBe(62); // the PM's zero shares add nothing

      const byId = new Map(result.shareholders.map((s) => [s.memberId, s]));
      expect(byId.get(f.pmAId)?.pmCapitalCents).toBe(25_000_000);
      expect(byId.get(f.pmAId)?.ownershipPercentage).toBe('50.00');
      expect(byId.get(f.boardId)?.pmCapitalCents).toBeNull();
      expect(byId.get(f.boardId)?.investmentCents).toBe(12_000_000 / 10); // 12 × 1,000.00
      expect(byId.get(f.shareholderId)?.investmentCents).toBe(5_000_000);

      // Double entry (§12): the project fund holds exactly what the two deposit
      // funds lost, and each member's equity dropped by exactly their own leg.
      const { funds, members } = schema;
      const { eq } = await import('drizzle-orm');
      const balanceOf = async (id: string) => {
        const [row] = await f.tx
          .select({ balance: funds.balance })
          .from(funds)
          .where(eq(funds.id, id))
          .limit(1);
        return Number(row.balance);
      };
      const equityOf = async (id: string) => {
        const [row] = await f.tx
          .select({ totalContributed: members.totalContributed })
          .from(members)
          .where(eq(members.id, id))
          .limit(1);
        return Number(row.totalContributed);
      };

      expect(await balanceOf(f.projectFundId)).toBe(312_000); // BDT, = 31,200,000 cents
      expect(await balanceOf(f.depositA)).toBe(5_000_000 - 262_000); // 250,000 PM + 12,000 board
      expect(await balanceOf(f.depositB)).toBe(5_000_000 - 50_000); // 50 shares × 1,000
      expect(await equityOf(f.pmAId)).toBe(1_000_000 - 250_000);
      expect(await equityOf(f.boardId)).toBe(1_000_000 - 12_000);
      expect(await equityOf(f.shareholderId)).toBe(1_000_000 - 50_000);
    });
  });

  it('two Project Level Members share one contract equally, to the cent', async () => {
    await withFixture(async (f) => {
      const result = await investProjectCapital(f.tx, {
        tenantId: f.tenantId,
        shareValue: SHARE_VALUE,
        destinationFundId: f.projectFundId,
        budgetCents: BUDGET_CENTS,
        now: now(),
        projectType: 'extra_investor',
        projectMemberPercent: '50.00',
        shareholders: [
          { memberId: f.pmAId, shares: 0, sourceFundId: f.depositA },
          { memberId: f.pmBId, shares: 0, sourceFundId: f.depositB },
          { memberId: f.boardId, shares: 12, sourceFundId: f.depositA },
        ],
      });
      const byId = new Map(result.shareholders.map((s) => [s.memberId, s]));
      expect(byId.get(f.pmAId)?.pmCapitalCents).toBe(12_500_000);
      expect(byId.get(f.pmBId)?.pmCapitalCents).toBe(12_500_000);
      expect(byId.get(f.pmAId)?.ownershipPercentage).toBe('25.00');
      expect(byId.get(f.pmBId)?.ownershipPercentage).toBe('25.00');
      expect(
        result.shareholders.reduce((acc, s) => acc + s.investmentCents, 0),
      ).toBe(result.totalCents);
    });
  });

  it('a contract that leaves too little of the budget for the club shares refuses with the ceiling spelled out', async () => {
    // 90% contract = 450,000 of a 500,000 budget; the club wants 62,000 more.
    // The message must say WHAT the contract left, not just "over budget".
    await expect(
      withFixture(async (f) => {
        await investProjectCapital(f.tx, {
          tenantId: f.tenantId,
          shareValue: SHARE_VALUE,
          destinationFundId: f.projectFundId,
          budgetCents: BUDGET_CENTS,
          now: now(),
          projectType: 'extra_investor',
          projectMemberPercent: '90',
          shareholders: [
            { memberId: f.pmAId, shares: 0, sourceFundId: f.depositA },
            { memberId: f.boardId, shares: 12, sourceFundId: f.depositA },
            { memberId: f.shareholderId, shares: 50, sourceFundId: f.depositB },
          ],
        });
      }),
    ).rejects.toThrow(/leaves of the budget/);
  });

  it.each([
    {
      name: 'PM on a club project',
      projectType: 'club_level' as const,
      percent: null,
      shares: [
        { key: 'pmAId' as const, shares: 0 },
        { key: 'boardId' as const, shares: 12 },
      ],
      message: /PM_NOT_ALLOWED_IN_CLUB_PROJECT/,
    },
    {
      name: 'percent on a club project',
      projectType: 'club_level' as const,
      percent: '25.00',
      shares: [{ key: 'boardId' as const, shares: 12 }],
      message: /PERCENT_NOT_ALLOWED_IN_CLUB_PROJECT/,
    },
    {
      name: 'PM holding shares',
      projectType: 'extra_investor' as const,
      percent: '50.00',
      shares: [{ key: 'pmAId' as const, shares: 20 }],
      message: /PM_HOLDS_NO_SHARES/,
    },
    {
      name: 'PM with no contract',
      projectType: 'extra_investor' as const,
      percent: null,
      shares: [{ key: 'pmAId' as const, shares: 0 }],
      message: /PM_PERCENT_REQUIRED/,
    },
  ])('refuses: $name', async ({ projectType, percent, shares, message }) => {
    await withFixture(async (f) => {
      let caught: unknown = null;
      try {
        await investProjectCapital(f.tx, {
          tenantId: f.tenantId,
          shareValue: SHARE_VALUE,
          destinationFundId: f.projectFundId,
          budgetCents: BUDGET_CENTS,
          now: now(),
          projectType,
          projectMemberPercent: percent,
          shareholders: shares.map((s) => ({
            memberId: f[s.key],
            shares: s.shares,
            sourceFundId: f.depositA,
          })),
        });
      } catch (err) {
        caught = err;
      }
      // Asserted INSIDE the fixture: throwing out of `body` would be swallowed by
      // the rollback sentinel, and a swallowed assertion is a false green.
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(message);
    });
  });
});
