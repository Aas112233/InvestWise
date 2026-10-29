/**
 * One date picker, one display format.
 *
 * AGENTS.md §8: dates are shown in the tenant's `dateFormat` and edited through
 * the shared ERPDatePicker. A raw `<input type="date">` renders in the browser's
 * own locale (mm/dd/yyyy on an en-US machine), ignores the tenant setting and
 * looks nothing like the calendar every other form uses. That is exactly how
 * the Deposit form and the Project Financial Update form drifted apart.
 *
 * `datetime-local` is not covered: meetings and trial windows need a time of
 * day, and there is no shared datetime picker yet.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/** Line comments are excluded: the picker documents the input it replaced. */
const codeOf = (src: string) => src.replace(/^\s*\/\/.*$/gm, '');

describe('every date-only field uses the shared tenant-aware picker', () => {
  it('no screen renders a native date input', () => {
    const offenders = [...sourceFiles('components'), ...sourceFiles('app')].filter((file) =>
      /type=["']date["']/.test(codeOf(readFileSync(file, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  it('the forms that once had a native input now pass the tenant display format', () => {
    for (const path of [
      'components/projects/project-update-modal.tsx',
      'components/expenses/expense-modal.tsx',
      'components/goals/goal-form-modal.tsx',
    ]) {
      const source = read(path);
      expect(source, `${path} must use the shared date picker`).toContain('ERPDatePicker');
      expect(source, `${path} must read the tenant date format`).toContain('useTenantDateFormat');
      expect(source, `${path} must hand the tenant format to the picker`).toMatch(
        /displayFormat=\{dateFormat\}/,
      );
    }
  });

  it('every picker instance passes the tenant display format', () => {
    // The picker's DD/MM/YYYY default is not the tenant's choice; a MM/DD/YYYY
    // tenant saw two different date orders depending on the screen.
    const users = [...sourceFiles('components'), ...sourceFiles('app')].filter((file) =>
      readFileSync(file, 'utf8').includes('<ERPDatePicker'),
    );
    expect(users.length).toBeGreaterThan(0);
    for (const path of users) {
      expect(readFileSync(path, 'utf8'), `${path} must pass displayFormat`).toContain('displayFormat');
    }
  });
});
