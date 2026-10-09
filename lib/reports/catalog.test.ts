import { describe, expect, it } from 'vitest';
import { ReportParamError, resolveReportPeriod } from './catalog';

describe('report period resolution', () => {
  it('resolves a custom inclusive range in UTC', () => {
    const period = resolveReportPeriod({
      periodType: 'Custom',
      startDate: '2026-02-28',
      endDate: '2026-03-01',
    });

    expect(period.start.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-03-01T23:59:59.999Z');
  });

  it('rejects impossible calendar dates rather than normalizing them', () => {
    expect(() => resolveReportPeriod({
      periodType: 'Custom',
      startDate: '2026-02-29',
      endDate: '2026-03-01',
    })).toThrowError(ReportParamError);
  });

  it('rejects unknown period types instead of treating them as custom', () => {
    expect(() => resolveReportPeriod({ periodType: 'Weekly' })).toThrowError(ReportParamError);
  });
});
