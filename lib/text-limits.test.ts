import { describe, it, expect } from 'vitest';
import {
  FUND_NAME_MAX,
  FUND_DESCRIPTION_MAX,
  FUND_HANDLING_OFFICER_MAX,
  FUND_ACCOUNT_NUMBER_MAX,
  createFundSchema,
  updateFundSchema,
// Relative import on purpose: the tsc alias maps @/server/* to ./server/src/*
// while the vitest alias maps @ to the root — each breaks the other's
// spelling. A relative path is the one form both tools resolve identically.
} from '../server/src/modules/funds/validation';
import { GOAL_TITLE_MAX, GOAL_DESCRIPTION_MAX, assertGoalText, assertGoalDescription } from './goal-text';

/**
 * Text-ceiling guards. These live at the API layer because the database's own
 * limit (varchar(n)) rejects with Postgres 22001 — a value-too-long the client
 * used to receive as a raw 500. Every assertion here is "the API refuses the
 * value BEFORE it reaches Postgres, with a message naming the limit".
 */

describe('fund create/update schemas enforce column ceilings', () => {
  it('accepts a fund at exactly the name limit and rejects one character more', () => {
    expect(createFundSchema.safeParse({ name: 'A'.repeat(FUND_NAME_MAX) }).success).toBe(true);

    const tooLong = createFundSchema.safeParse({ name: 'A'.repeat(FUND_NAME_MAX + 1) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toContain(String(FUND_NAME_MAX));
  });

  it('rejects an over-long description on create (the old hand-rolled path had no bound at all)', () => {
    const res = createFundSchema.safeParse({
      name: 'Reserve Fund',
      description: 'D'.repeat(FUND_DESCRIPTION_MAX + 1),
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['description']);
  });

  it('rejects over-long handlingOfficer and accountNumber, which are varchar in the DB', () => {
    const officer = createFundSchema.safeParse({
      name: 'Reserve Fund',
      handlingOfficer: 'O'.repeat(FUND_HANDLING_OFFICER_MAX + 1),
    });
    expect(officer.success).toBe(false);
    expect(officer.error?.issues[0]?.path).toEqual(['handlingOfficer']);

    const account = createFundSchema.safeParse({
      name: 'Reserve Fund',
      accountNumber: '9'.repeat(FUND_ACCOUNT_NUMBER_MAX + 1),
    });
    expect(account.success).toBe(false);
    expect(account.error?.issues[0]?.path).toEqual(['accountNumber']);
  });

  it('still trims the name and defaults an absent type to OTHER', () => {
    const parsed = createFundSchema.parse({ name: '  Reserve Fund  ' });
    expect(parsed.name).toBe('Reserve Fund');
    expect(parsed.type).toBe('OTHER');
  });

  it('bounds the same fields on update, so an edit is not a way around create', () => {
    expect(updateFundSchema.safeParse({ description: 'D'.repeat(FUND_DESCRIPTION_MAX + 1) }).success).toBe(false);
    expect(updateFundSchema.safeParse({ name: 'A'.repeat(FUND_NAME_MAX + 1) }).success).toBe(false);
    expect(updateFundSchema.safeParse({ accountNumber: '9'.repeat(FUND_ACCOUNT_NUMBER_MAX + 1) }).success).toBe(false);
  });

  it('keeps description nullable/optional so a fund without one still saves', () => {
    expect(createFundSchema.safeParse({ name: 'Reserve Fund', description: null }).success).toBe(true);
    expect(createFundSchema.safeParse({ name: 'Reserve Fund' }).success).toBe(true);
    expect(updateFundSchema.safeParse({ description: null }).success).toBe(true);
  });
});

describe('goal text ceilings', () => {
  it('accepts a title at the limit and rejects one character more', () => {
    expect(() => assertGoalText('T'.repeat(GOAL_TITLE_MAX), null)).not.toThrow();
    expect(() => assertGoalText('T'.repeat(GOAL_TITLE_MAX + 1), null)).toThrow(/1-200/);
  });

  it('rejects an empty or non-string title', () => {
    expect(() => assertGoalText('', null)).toThrow();
    expect(() => assertGoalText('   ', null)).toThrow();
    expect(() => assertGoalText(42, null)).toThrow();
  });

  it('rejects an over-long description, which the column cannot bound (it is unbounded text)', () => {
    expect(() => assertGoalText('Valid', 'D'.repeat(GOAL_DESCRIPTION_MAX))).not.toThrow();
    expect(() => assertGoalText('Valid', 'D'.repeat(GOAL_DESCRIPTION_MAX + 1))).toThrow(/at most 10000/);
  });

  it('allows a null description but rejects a non-string one', () => {
    expect(() => assertGoalDescription(null)).not.toThrow();
    expect(() => assertGoalDescription(undefined)).not.toThrow();
    expect(() => assertGoalDescription({ nope: true })).toThrow(/must be a string/);
  });
});

/**
 * The regression this guards: handleCreateFund used to hand-roll
 * `String(body.description)` with no length cap while handleUpdateFund used
 * updateFundSchema. createFundSchema existed but was imported by nothing, so
 * an oversized create died in the INSERT as 22001 (a 500). This asserts the
 * schema the create path now parses with actually carries the ceilings.
 */
describe('fund create path uses the bounded schema', () => {
  it('rejects the exact payload the old hand-rolled path accepted', () => {
    const oversized = { name: 'Reserve Fund', description: 'D'.repeat(FUND_DESCRIPTION_MAX + 1) };
    expect(createFundSchema.safeParse(oversized).success).toBe(false);
  });

  it('is no longer dead code — handleCreateFund imports it', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('server/src/modules/members/handlers.ts', 'utf8'),
    );
    expect(src).toMatch(/import\s*\{\s*createFundSchema[\s,}]/);
    // And the create handler must parse through it, not read the raw body.
    const createFn = src.slice(src.indexOf('export async function handleCreateFund'));
    const body = createFn.slice(0, createFn.indexOf('export async function', 1));
    expect(body).toMatch(/validateBody\(request,\s*createFundSchema\)/);
  });
});
