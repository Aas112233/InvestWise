import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  isReservedCategory,
  DEFAULT_PROJECT_CATEGORIES,
  normalizeCategories,
  isAllowedCategory,
  categoryRejectionMessage,
  CATEGORY_LIST_MAX,
} from './categories';

describe('normalizeCategories', () => {
  it('falls back to the default vocabulary for null/garbage input', () => {
    expect(normalizeCategories(null, DEFAULT_EXPENSE_CATEGORIES)).toEqual(DEFAULT_EXPENSE_CATEGORIES);
    expect(normalizeCategories(undefined, DEFAULT_EXPENSE_CATEGORIES)).toEqual(DEFAULT_EXPENSE_CATEGORIES);
    expect(normalizeCategories('not-an-array', DEFAULT_EXPENSE_CATEGORIES)).toEqual(DEFAULT_EXPENSE_CATEGORIES);
    expect(normalizeCategories({ a: 1 }, DEFAULT_EXPENSE_CATEGORIES)).toEqual(DEFAULT_EXPENSE_CATEGORIES);
  });

  it('falls back to defaults when every entry normalises away', () => {
    expect(normalizeCategories(['', '   ', 42, null], DEFAULT_PROJECT_CATEGORIES)).toEqual(
      DEFAULT_PROJECT_CATEGORIES,
    );
  });

  it('trims, collapses inner whitespace, and drops blanks', () => {
    expect(normalizeCategories(['  Utilities  ', '', 'Real  Estate'], [])).toEqual([
      'Utilities',
      'Real Estate',
    ]);
  });

  it('dedupes case-insensitively, keeping the first casing', () => {
    expect(normalizeCategories(['Travel', 'travel', 'TRAVEL', 'Legal'], [])).toEqual([
      'Travel',
      'Legal',
    ]);
  });

  it('caps label length so a chip cannot become prose', () => {
    const long = 'x'.repeat(200);
    const [only] = normalizeCategories([long], []);
    expect(only).toHaveLength(60);
  });

  it('bounds the list length', () => {
    const many = Array.from({ length: CATEGORY_LIST_MAX + 25 }, (_, i) => `Category ${i + 1}`);
    expect(normalizeCategories(many, [])).toHaveLength(CATEGORY_LIST_MAX);
  });

  it('preserves a legitimately empty list only via explicit fallback', () => {
    // A tenant list that normalises to nothing can never leave an empty picker.
    expect(normalizeCategories([], DEFAULT_EXPENSE_CATEGORIES)).toEqual(DEFAULT_EXPENSE_CATEGORIES);
  });
});

describe('isAllowedCategory', () => {
  const configured = ['Operations', 'Travel', 'Other'];

  it('accepts a configured category', () => {
    expect(isAllowedCategory('Travel', configured)).toBe(true);
  });

  it('rejects an unknown category', () => {
    expect(isAllowedCategory('Bribes', configured)).toBe(false);
  });

  it('is case-sensitive — the stored string is the display label', () => {
    expect(isAllowedCategory('travel', configured)).toBe(false);
  });

  it('rejects null/empty/undefined', () => {
    expect(isAllowedCategory(null, configured)).toBe(false);
    expect(isAllowedCategory('', configured)).toBe(false);
    expect(isAllowedCategory(undefined, configured)).toBe(false);
  });

  // The whole point of the history set: editing the vocabulary must never
  // retroactively invalidate rows already in the ledger.
  it('accepts a removed category that historical rows still carry', () => {
    expect(isAllowedCategory('Travel', ['Operations', 'Other'])).toBe(false);
    expect(isAllowedCategory('Travel', ['Operations', 'Other'], ['Travel', 'Legal'])).toBe(true);
  });

  it('accepts the internally stamped Investment category even if unconfigured', () => {
    // The project ledger path writes this without user selection.
    expect(isAllowedCategory('Investment', [])).toBe(true);
  });

  it('accepts a legacy sector that predates tenant configuration', () => {
    // Real install has projects carrying sectors no default list contains; the
    // edit form resends the unchanged value on every save, so history is the
    // only thing keeping those projects editable.
    const history = ['Energy & Infrastructure', 'Agriculture & Farming'];
    expect(isAllowedCategory('Energy & Infrastructure', DEFAULT_PROJECT_CATEGORIES)).toBe(false);
    expect(isAllowedCategory('Energy & Infrastructure', DEFAULT_PROJECT_CATEGORIES, history)).toBe(
      true,
    );
  });
});

describe('categoryRejectionMessage', () => {
  it('names the configured list and truncates long ones', () => {
    const msg = categoryRejectionMessage('category', ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(msg).toContain('category must be one of the configured categories');
    expect(msg).toContain('A, B, C, D, E, …');
  });

  it('does not add an ellipsis for short lists', () => {
    expect(categoryRejectionMessage('category', ['A', 'B'])).not.toContain('…');
  });
});

describe('isReservedCategory', () => {
  it('flags the system-stamped ledger labels', () => {
    expect(isReservedCategory('Investment')).toBe(true);
    expect(isReservedCategory('Travel')).toBe(false);
  });

  it('is not in the expense default list, so it can never be posted as an expense', () => {
    expect(DEFAULT_EXPENSE_CATEGORIES).not.toContain('Investment');
  });
});
