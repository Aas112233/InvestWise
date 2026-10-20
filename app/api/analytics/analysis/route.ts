import { NextRequest, NextResponse } from "next/server";
import { getDb, withDbRetry } from "@/db/index";
import { members, projects, funds, transactions, systemSettings } from "@/db/schema/index";
import { eq, and, or, sql, gte, lte } from "drizzle-orm";
import { getAuthContext } from "@/lib/middleware/auth";
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from "@/lib/permissions";
import { SETTLED_DEPOSIT_STATUSES } from "@/lib/ledger-selectors";
import { memberDisplayNameSql } from "@/lib/member-display";
import { isMonthlySchedule } from "@/lib/governance/status-service";
import {
  fiscalMonthOffsetForDate,
  fiscalMonthSequence,
  fiscalStartYearForDate,
  fiscalYearEndForStart,
  isFiscalMonthName,
  resolveFiscalBounds,
} from "@/lib/fiscal-periods";
import { AnalysisData } from "@/types";

export const dynamic = "force-dynamic";

const SETTLED = new Set<string>(SETTLED_DEPOSIT_STATUSES);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days in a UTC month (month is 0-based). */
function daysInUtcMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const scopedTenantId = requireTenant(tenantId, user);

    // Screen-permission gate — the same contract every other read route keeps
    // (deposits, expenses, members, fiscal, dividends). The sidebar / AppShell
    // 403 is UX only: a per-user ANALYSIS=NONE override used to be bypassable
    // with a direct API call, which returned the whole tenant's contributions,
    // shares and payment behaviour.
    if (!hasScreenPermission(user, "ANALYSIS", "READ")) {
      return NextResponse.json(
        { success: false, message: "You do not have permission to view the Analysis module", code: "FORBIDDEN" },
        { status: 403 },
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const yearParam = searchParams.get("year");
    const selectedMemberId = searchParams.get("memberId") || "all";

    const db = getDb();
    const [fiscalSettings] = await db
      .select({
        fiscalYearStart: systemSettings.fiscalYearStart,
        fiscalYearEnd: systemSettings.fiscalYearEnd,
        depositDueDate: systemSettings.depositDueDate,
        gracePeriodDays: systemSettings.gracePeriodDays,
      })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, scopedTenantId))
      .limit(1);

    // A legacy row may hold a malformed month name; degrade to the platform
    // default instead of 500-ing the whole screen (the picker and top-nav
    // guard the same case). The settings screen now rejects bad months on
    // write, but stored data predates it.
    const fiscalYearStart = isFiscalMonthName(fiscalSettings?.fiscalYearStart)
      ? (fiscalSettings?.fiscalYearStart as string)
      : "July";
    // The analysis window is ALWAYS the 12 slots following the start month, so
    // derive the end instead of trusting a stored one: a misconfigured end
    // (start != end but not a 12-month run) used to shrink the SQL window
    // while the 12-slot grid still claimed all twelve months — empty bars plus
    // fake MISSED cells for months outside the tenant's fiscal year.
    const fiscalYearEnd = fiscalYearEndForStart(fiscalYearStart);
    // Due-date settings for the current-FY matrix (governance defaults).
    const rawDueDate = fiscalSettings?.depositDueDate;
    const rawGrace = fiscalSettings?.gracePeriodDays;
    const depositDueDate =
      typeof rawDueDate === "number" && Number.isInteger(rawDueDate) ? Math.min(Math.max(rawDueDate, 1), 28) : 10;
    const gracePeriodDays =
      typeof rawGrace === "number" && Number.isInteger(rawGrace) ? Math.min(Math.max(rawGrace, 0), 30) : 3;
    // transactions.status is nullable on the schema — one settled-check helper
    // keeps the flow loop and the matrix honest.
    const isSettled = (status: string | null): boolean => status !== null && SETTLED.has(status);

    const now = new Date();
    const parsedYear = yearParam === null ? fiscalStartYearForDate(now, fiscalYearStart) : Number(yearParam);
    if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 9998) {
      return NextResponse.json(
        { success: false, message: "Fiscal year must be an integer from 1900 to 9998" },
        { status: 400 },
      );
    }
    const targetYear = parsedYear;
    const fiscalBounds = resolveFiscalBounds(targetYear, fiscalYearStart, fiscalYearEnd);
    const fiscalMonths = fiscalMonthSequence(fiscalYearStart);
    const startMonthIndex = fiscalMonths[0]?.index ?? 0;

    // Calendar slot of fiscal offset i: absolute month index from the FY start.
    const slotOfYear = (i: number) => {
      const absolute = startMonthIndex + i;
      return {
        slotYear: targetYear + Math.floor(absolute / 12),
        slotMonth0: ((absolute % 12) + 12) % 12,
      };
    };

    // "Is this slot's deadline past?" A past FY is fully evaluated; a future
    // FY has not started; the current FY's in-progress slot only counts once
    // its deposit deadline (configured due day of the month + grace) has
    // passed — marking every member MISSED on day 1 of a running month
    // contradicted the grace logic the rest of the product uses.
    const currentFiscalYear = fiscalStartYearForDate(now, fiscalYearStart);
    const isSlotEvaluated = (i: number): boolean => {
      const { slotYear, slotMonth0 } = slotOfYear(i);
      const fy = fiscalStartYearForDate(new Date(Date.UTC(slotYear, slotMonth0, 15)), fiscalYearStart);
      if (fy < currentFiscalYear) return true;
      if (fy > currentFiscalYear) return false;
      const dueDay = Math.min(depositDueDate, daysInUtcMonth(slotYear, slotMonth0));
      const deadline = Date.UTC(slotYear, slotMonth0, dueDay) + gracePeriodDays * DAY_MS;
      return now.getTime() > deadline;
    };

    // 1. Scoped conditions (unconditional — scopedTenantId 403s on null via requireTenant above).
    // Members are soft-deleted (members.isDeleted); the analysis roster must
    // not surface a removed member's retained contributions/shares. Matches
    // the dashboard member filter so both screens agree.
    const memberCond = and(eq(members.tenantId, scopedTenantId), eq(members.isDeleted, false));
    const projectCond = eq(projects.tenantId, scopedTenantId);
    const fundCond = and(eq(funds.status, "ACTIVE"), eq(funds.tenantId, scopedTenantId));

    // The fetch window must match the BUCKETING key. Rows are bucketed by the
    // deposit month they were made FOR (deposit_month, #57), not the date they
    // were keyed in — so the SQL window has to admit deposits whose
    // deposit_month falls inside this FY even when the posting date landed
    // outside it (late key-in while the FY was still open). The old
    // posting-date-only window dropped those rows, and the matrix then showed
    // MISSED for a month that actually had a settled deposit.
    const slotStartKey = fiscalBounds.periodStart.toISOString().slice(0, 7);
    const slotEndKey = fiscalBounds.periodEnd.toISOString().slice(0, 7);
    const txConditions = [
      eq(transactions.isDeleted, false),
      eq(transactions.tenantId, scopedTenantId),
      selectedMemberId !== "all" ? eq(transactions.memberId, selectedMemberId) : undefined,
      or(
        and(
          gte(transactions.date, fiscalBounds.periodStart),
          lte(transactions.date, fiscalBounds.periodEnd),
        ),
        and(
          eq(transactions.type, "Deposit"),
          gte(transactions.depositMonth, slotStartKey),
          lte(transactions.depositMonth, slotEndKey),
        ),
      )!,
    ];

    // 2. Fetch data in parallel (withDbRetry: a transient pooler blip must
    // not 500 the whole screen — the stats route already retries).
    const [
      allMembers,
      allProjects,
      activeFunds,
      yearTransactions,
      allTimeTxAgg,
    ] = await withDbRetry(() => Promise.all([
      db
        .select({
          id: members.id,
          memberId: members.memberId,
          // Display form: a suspended member is marked in their own name
          // (matrix rows, leaderboard rows and the scope banner).
          name: memberDisplayNameSql,
          avatar: members.avatar,
          shares: members.shares,
          totalContributed: sql<number>`coalesce(${members.totalContributed}::numeric, 0)::float`,
          joinDate: members.joinDate,
          depositFrequency: members.depositFrequency,
        })
        .from(members)
        .where(memberCond),
      db
        .select({
          id: projects.id,
          title: projects.title,
          category: projects.category,
          budget: sql<number>`coalesce(${projects.budget}::numeric, 0)::float`,
          currentFundBalance: sql<number>`coalesce(${projects.currentFundBalance}::numeric, 0)::float`,
          health: projects.health,
          status: projects.status,
        })
        .from(projects)
        .where(projectCond),
      db
        .select({
          netReserves: sql<number>`coalesce(sum(${funds.balance}::numeric), 0)::float`,
        })
        .from(funds)
        .where(fundCond),
      db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: sql<number>`coalesce(${transactions.amount}::numeric, 0)::float`,
          date: transactions.date,
          // #57: a deposit belongs to the month it was deposited FOR, not the
          // month it was keyed in. The Deposits page and its month filter use
          // deposit_month; the chart used the posting date, so the same rows
          // landed in different months across two views of one ledger.
          depositMonth: transactions.depositMonth,
          status: transactions.status,
          memberId: transactions.memberId,
        })
        .from(transactions)
        .where(and(...txConditions)),
      db
        .select({
          // `Deposit` requires a settled status: an unsettled request is not
          // collected capital, and counting it made "Total Capital Invested"
          // disagree with the fund ledger (report issues 27 / 47).
          totalDeposits: sql<number>`coalesce(sum(case when ${transactions.type} = 'Deposit' and ${transactions.status} in ('Completed', 'Success') then ${transactions.amount}::numeric else 0 end), 0)::float`,
          // Dividends follow the same settled rule as deposits (the canonical
          // outflow predicate requires it too). Distribute writes 'Completed'
          // today, but the total must not silently change if a pending state
          // ever lands.
          totalDividends: sql<number>`coalesce(sum(case when ${transactions.type} = 'Dividend' and ${transactions.status} in ('Completed', 'Success') then ${transactions.amount}::numeric else 0 end), 0)::float`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.isDeleted, false),
            eq(transactions.tenantId, scopedTenantId),
            selectedMemberId !== "all" ? eq(transactions.memberId, selectedMemberId) : sql`1=1`,
          ),
        ),
    ]));

    // 3. Aggregate Monthly Trends in configured fiscal-month order.
    //    monthSlot ('YYYY-MM') / calYear travel with the bar so the client
    //    renders labels from the SAME calendar the server bucketed with —
    //    re-deriving them from a separately cached client-side settings copy
    //    drifted for up to ~10 minutes after a fiscal-month change.
    const monthlyTrends = fiscalMonths.map(({ key, shortLabel }, offset) => {
      const { slotYear, slotMonth0 } = slotOfYear(offset);
      return {
        month: shortLabel,
        monthKey: key,
        monthSlot: `${slotYear}-${String(slotMonth0 + 1).padStart(2, "0")}`,
        calYear: slotYear,
        inflow: 0,
        outflow: 0,
        net: 0,
      };
    });

    for (const tx of yearTransactions) {
      if (!tx.date) continue;

      // Bucket by the fiscal month the money belongs to. Deposits carry an
      // explicit `deposit_month` ("YYYY-MM") set by the deposit form — the
      // authoritative month for that money; everything else falls back to its
      // posting date.
      let bucketDate = new Date(tx.date);
      if (tx.type === "Deposit" && tx.depositMonth && /^\d{4}-\d{2}$/.test(tx.depositMonth)) {
        const parts = tx.depositMonth.split("-");
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
          // Anchor mid-month (UTC) so timezone shifts cannot push it into the
          // neighbouring fiscal month.
          bucketDate = new Date(Date.UTC(y, m - 1, 15));
        }
      }

      const monthOffset = fiscalMonthOffsetForDate(bucketDate, fiscalYearStart);
      // A deposit entered inside this FY but made FOR a month in another FY
      // belongs to that FY's bar, not this one's.
      if (fiscalStartYearForDate(bucketDate, fiscalYearStart) !== targetYear) continue;
      const trend = monthlyTrends[monthOffset];
      if (!trend) continue;

      // Settled-money flow, mirroring lib/ledger-selectors: a PENDING request,
      // a REJECTED slip or a REVERTED deposit is not cash that moved, and the
      // old loop counted all three as inflow — so the chart total exceeded the
      // "Total Capital Invested" KPI on the same screen (the exact drift the
      // ledger-selectors module exists to prevent).
      if (tx.type === "Earning" || (tx.type === "Deposit" && isSettled(tx.status))) {
        trend.inflow += tx.amount;
      } else if (
        tx.type === "Expense" ||
        tx.type === "Withdrawal" ||
        (tx.type === "Dividend" && isSettled(tx.status))
      ) {
        trend.outflow += tx.amount;
      }
    }

    monthlyTrends.forEach((t) => {
      t.net = Number((t.inflow - t.outflow).toFixed(2));
      t.inflow = Number(t.inflow.toFixed(2));
      t.outflow = Number(t.outflow.toFixed(2));
    });

    // 4. Sector Allocations
    //
    // #14: "Capital Allocation by Sector" must mean ONE thing across the app.
    // The metric is **committed capital** — the project's budget, i.e. the
    // money set aside for it — which is exactly what the Dashboard's "Capital
    // by Sector" already sums (40,000 for a 40,000-budget project). The previous
    // `currentFundBalance > 0 ? currentFundBalance : budget` expression was a
    // THIRD measure (remaining balance) that made the same label read 10,000 on
    // Analysis and 40,000 on the Dashboard. `budget` is the single definition;
    // "capital deployed so far" lives elsewhere (project detail / spend columns).
    //
    // Cancelled projects are excluded: their budget was never deployable
    // capital, so counting it overstated the allocation (the Dashboard's
    // client-side chart applies the same exclusion).
    const sectorMap = new Map<string, { value: number; count: number }>();
    let totalProjectCapital = 0;

    for (const p of allProjects) {
      if (p.status === "Cancelled") continue;
      const cat = p.category || "General";
      const val = p.budget;
      totalProjectCapital += val;

      const existing = sectorMap.get(cat) || { value: 0, count: 0 };
      existing.value += val;
      existing.count += 1;
      sectorMap.set(cat, existing);
    }

    const sectorAllocations = Array.from(sectorMap.entries()).map(([name, data]) => ({
      name,
      value: Number(data.value.toFixed(2)),
      count: data.count,
      percentage: totalProjectCapital > 0 ? Number(((data.value / totalProjectCapital) * 100).toFixed(1)) : 0,
    }));

    // 5. Risk / Health Distribution (same live-project scope as the sector
    // chart: a cancelled project is not an exposure the org carries).
    const healthMap = new Map<string, { count: number; value: number }>();
    for (const p of allProjects) {
      if (p.status === "Cancelled") continue;
      const h = p.health || "Stable";
      const existing = healthMap.get(h) || { count: 0, value: 0 };
      existing.count += 1;
      existing.value += p.budget;
      healthMap.set(h, existing);
    }

    const riskDistribution = Array.from(healthMap.entries()).map(([health, data]) => ({
      health,
      count: data.count,
      value: Number(data.value.toFixed(2)),
    }));

    // 6. Payment Regularity Matrix (12 months in fiscal order)
    const targetMembers = selectedMemberId === "all"
      ? allMembers
      : allMembers.filter((m) => m.id === selectedMemberId);

    // Map member deposit occurrences by fiscal-month offset — bucketed by the
    // deposit's OWN month (`deposit_month`), exactly like the monthly-trends
    // chart above (#57) and the deposits ledger. A January contribution keyed
    // in October counts for January. Settled means Completed/Success (the
    // collected-capital definition used by every other money view). A deposit
    // whose deposit month falls outside the requested FY is skipped, so a
    // same-calendar-month deposit from another year cannot mark this FY paid.
    const memberMonthlyPaid = new Map<string, Set<number>>();
    for (const tx of yearTransactions) {
      if (tx.type !== "Deposit" || !tx.memberId || !tx.date) continue;
      if (!isSettled(tx.status)) continue;
      let bucketDate = new Date(tx.date);
      if (tx.depositMonth && /^\d{4}-\d{2}$/.test(tx.depositMonth)) {
        const parts = tx.depositMonth.split("-");
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
          bucketDate = new Date(Date.UTC(y, m - 1, 15));
        }
      }
      if (fiscalStartYearForDate(bucketDate, fiscalYearStart) !== targetYear) continue;
      const monthOffset = fiscalMonthOffsetForDate(bucketDate, fiscalYearStart);
      if (!memberMonthlyPaid.has(tx.memberId)) {
        memberMonthlyPaid.set(tx.memberId, new Set());
      }
      memberMonthlyPaid.get(tx.memberId)!.add(monthOffset);
    }

    let totalExpectedSlots = 0;
    let totalPaidSlots = 0;

    const paymentMatrix = targetMembers.map((m) => {
      const months: Record<string, "PAID" | "PENDING" | "MISSED"> = {};
      const paidSet = memberMonthlyPaid.get(m.id) || new Set();

      // Obligation model: a member only owes the months (a) from their join
      // month forward, and (b) on a MONTHLY schedule. Non-monthly members are
      // skipped by exactly the same rule governance applies
      // (lib/governance/status-service.ts — flagged skippedFrequency there);
      // the old grid marked a quarterly member 9 months MISSED and a
      // mid-year joiner's early months MISSED too.
      const monthly = isMonthlySchedule(m.depositFrequency);
      // Obligation starts at the JOIN MONTH (month granularity, like the
      // governance period keys): a member who joins mid-July still owes July.
      const joinDate = m.joinDate ? new Date(m.joinDate) : null;
      const joinMonthTs =
        joinDate && !Number.isNaN(joinDate.getTime())
          ? Date.UTC(joinDate.getUTCFullYear(), joinDate.getUTCMonth(), 1)
          : null;

      let paidCount = 0;
      let evaluatedSlots = 0;

      for (let i = 0; i < 12; i++) {
        const fiscalMonth = fiscalMonths[i];
        if (!fiscalMonth) continue;
        const { slotYear, slotMonth0 } = slotOfYear(i);
        const joinedAfterSlot = joinMonthTs !== null && Date.UTC(slotYear, slotMonth0, 1) < joinMonthTs;
        const isEvaluated = monthly && !joinedAfterSlot && isSlotEvaluated(i);

        if (paidSet.has(i)) {
          months[fiscalMonth.key] = "PAID";
          if (isEvaluated) {
            paidCount++;
            totalPaidSlots++;
            evaluatedSlots++;
          }
        } else if (isEvaluated) {
          months[fiscalMonth.key] = "MISSED";
          evaluatedSlots++;
        } else {
          months[fiscalMonth.key] = "PENDING";
        }

        if (isEvaluated) totalExpectedSlots++;
      }

      // null = nothing was due to be evaluated (future FY, pre-join, or a
      // non-monthly schedule). 100 was a lie: an unevaluated year is not a
      // perfectly punctual one.
      const punctualityScore = evaluatedSlots > 0 ? Number(((paidCount / evaluatedSlots) * 100).toFixed(0)) : null;

      return {
        id: m.id,
        memberId: m.memberId,
        name: m.name,
        avatar: m.avatar || undefined,
        months,
        punctualityScore,
      };
    });

    const collectionEfficiency = totalExpectedSlots > 0
      ? Number(((totalPaidSlots / totalExpectedSlots) * 100).toFixed(1))
      : null;

    // 7. Leaderboard & Equity Percentages
    const totalSharesAll = allMembers.reduce((sum, m) => sum + (m.shares || 0), 0);
    const sortedMembers = [...allMembers].sort((a, b) => b.totalContributed - a.totalContributed);

    const leaderboard = sortedMembers.slice(0, 15).map((m, idx) => ({
      rank: idx + 1,
      id: m.id,
      memberId: m.memberId,
      name: m.name,
      avatar: m.avatar || undefined,
      shares: m.shares,
      totalContributed: Number(m.totalContributed.toFixed(2)),
      equitySharePercent: totalSharesAll > 0 ? Number(((m.shares / totalSharesAll) * 100).toFixed(2)) : 0,
    }));

    // 8. Overall Financial Metrics
    const totalInvested = allTimeTxAgg[0]?.totalDeposits ?? 0;
    const totalDividends = allTimeTxAgg[0]?.totalDividends ?? 0;
    const netReserves = activeFunds[0]?.netReserves ?? 0;
    // Consolidated Portfolio Value = the tenant's total treasury.
    //
    // It must NOT be `totalProjectCapital + netReserves`: creating a project
    // CREDITS its starting capital to the linked fund (app/api/projects/route.ts
    // line ~251) while the SAME amount is also stored as
    // `projects.currentFundBalance` (line ~275). Summing both counted that money
    // twice — Analysis read 195,000 where the Funds module correctly read
    // 180,000 (report issue 13). Fund balances are the single source of truth
    // and already contain every project's capital, so the consolidated value is
    // the treasury itself.
    const totalAssetValue = Number(netReserves.toFixed(2));
    const netProfit = Number((totalAssetValue + totalDividends - totalInvested).toFixed(2));
    const roi = totalInvested > 0 ? Number(((netProfit / totalInvested) * 100).toFixed(1)) : 0;
    const activeProjectsCount = allProjects.filter((p) => p.status === "In Progress").length;

    const responseData: AnalysisData = {
      metrics: {
        totalInvested: Number(totalInvested.toFixed(2)),
        totalAssetValue,
        netProfit,
        roi,
        totalDividends: Number(totalDividends.toFixed(2)),
        activeProjects: activeProjectsCount,
        collectionEfficiency,
        // Lets the view say "Top 15 of N" when the roster is truncated.
        totalShareholders: allMembers.length,
      },
      monthlyTrends,
      sectorAllocations,
      riskDistribution,
      paymentMatrix,
      leaderboard,
      // Server-authoritative calendar label: the client no longer re-derives
      // the FY label from its own (cached) settings copy.
      fiscalYearLabel: fiscalBounds.label,
      // Scope marker: when a member is selected, the KPI cards that CANNOT be
      // scoped to one member (treasury, net return, ROI) and the sector /
      // risk / leaderboard tabs stay tenant-wide — the view badges them so a
      // tenant-wide figure is never misread as the selected member's.
      scope: {
        memberScoped: selectedMemberId !== "all",
        memberName: selectedMemberId === "all" ? null : (targetMembers[0]?.name ?? null),
      },
    };

    return NextResponse.json(responseData);
  } catch (err: unknown) {
    const error = err as Error & { statusCode?: number };
    console.error("[ANALYTICS ANALYSIS GET ERROR]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to compile financial analysis" },
      { status: error.statusCode || 500 },
    );
  }
}
