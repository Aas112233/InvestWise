import { describe, it, expect } from 'vitest';
import { getPaginationParams } from '../middleware/api.js';

/**
 * Guards the dropdown-vs-table limit contract.
 *
 * Regression context: the client's member/fund dropdowns request limit=500 /
 * limit=200, but getPaginationParams hard-clamped every endpoint to 100. The
 * requests either 400'd against the Zod schema or silently truncated, so
 * dropdowns were slow (retry) and incomplete. maxLimit now lets a feed opt
 * into a higher, still-bounded ceiling while tables stay at 100.
 */
describe('getPaginationParams limit ceilings', () => {
  it('defaults to a 100-row ceiling for table endpoints', () => {
    expect(getPaginationParams({ limit: '500' }).limit).toBe(100);
    expect(getPaginationParams({ limit: '100' }).limit).toBe(100);
  });

  it('honors a higher maxLimit for dropdown feeds', () => {
    expect(getPaginationParams({ limit: '500' }, { maxLimit: 500 }).limit).toBe(500);
    expect(getPaginationParams({ limit: '200' }, { maxLimit: 200 }).limit).toBe(200);
  });

  it('still clamps above the declared maxLimit', () => {
    expect(getPaginationParams({ limit: '9999' }, { maxLimit: 500 }).limit).toBe(500);
    expect(getPaginationParams({ limit: '9999' }, { maxLimit: 200 }).limit).toBe(200);
  });

  it('falls back to the default limit when absent or invalid', () => {
    expect(getPaginationParams({}).limit).toBe(20);
    expect(getPaginationParams({ limit: 'abc' }, { limit: 50 }).limit).toBe(50);
  });

  it('never returns a limit below 1', () => {
    // '0' is falsy after parse -> falls back to the default; negatives clamp to 1.
    expect(getPaginationParams({ limit: '0' }).limit).toBe(20);
    expect(getPaginationParams({ limit: '-5' }).limit).toBe(1);
  });

  it('derives skip from page and limit', () => {
    const p = getPaginationParams({ page: '3', limit: '20' });
    expect(p.page).toBe(3);
    expect(p.skip).toBe(40);
  });
});
