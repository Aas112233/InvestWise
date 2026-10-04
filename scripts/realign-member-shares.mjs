/**
 * FATAL / DEPRECATED:
 * Realigning member shares from money contributions violates core domain invariants.
 *
 * In InvestWise:
 * 1. The tenant settings define the money value of 1 share (e.g. 10, 40, 1000, 10000).
 * 2. Member shares (`members.shares`) are fixed equity allocations set at creation.
 * 3. Monthly deposits increase `totalContributed`, but NEVER alter `shares`.
 * 4. Deriving shares from `floor(totalContributed / shareValue)` corrupts member share
 *    counts because cumulative contributions accumulate over months and years while
 *    share counts remain invariant.
 */

console.error(
  'FATAL: Member shares cannot be realigned from money contributions. ' +
  'In InvestWise, member shares are fixed equity allocations and must never be altered by calculations or deposits.'
);
process.exit(1);
