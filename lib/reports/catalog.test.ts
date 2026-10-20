import { describe, expect, it } from 'vitest';
import {
  MEMBER_ALL,
  ReportParamError,
  parseMemberSelection,
  resolveReportPeriod,
  serializeMemberSelection,
} from './catalog';

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

  it('rejects implausible fiscal years (0000 would resolve into 1970)', () => {
    expect(() => resolveReportPeriod({
      periodType: 'Yearly',
      fiscalYear: '0000',
    })).toThrowError(ReportParamError);
    expect(() => resolveReportPeriod({
      periodType: 'Quarterly',
      fiscalYear: '0000',
      fiscalQuarter: 'Q1',
    })).toThrowError(ReportParamError);
  });

  it('still accepts a normal fiscal year', () => {
    const period = resolveReportPeriod({ periodType: 'Yearly', fiscalYear: '2026' });
    expect(Number.isNaN(period.start.getTime())).toBe(false);
    expect(Number.isNaN(period.end.getTime())).toBe(false);
  });
});

describe('member scope wire format (one / many / all)', () => {
  it('treats an absent or blank param as unscoped (whole book)', () => {
    expect(parseMemberSelection(null)).toEqual({ all: false, ids: [] });
    expect(parseMemberSelection(undefined)).toEqual({ all: false, ids: [] });
    expect(parseMemberSelection('')).toEqual({ all: false, ids: [] });
    expect(parseMemberSelection('   ')).toEqual({ all: false, ids: [] });
  });

  it('parses the all sentinel', () => {
    expect(MEMBER_ALL).toBe('all');
    expect(parseMemberSelection('all')).toEqual({ all: true, ids: [] });
    expect(parseMemberSelection(' all ')).toEqual({ all: true, ids: [] });
  });

  it('parses a legacy single id unchanged', () => {
    expect(parseMemberSelection('member-1')).toEqual({ all: false, ids: ['member-1'] });
  });

  it('parses a comma list, trimming blanks and de-duplicating', () => {
    expect(parseMemberSelection('m-1, m-2 ,m-1,,m-3')).toEqual({
      all: false,
      ids: ['m-1', 'm-2', 'm-3'],
    });
    // Comma junk with no real ids degrades to unscoped, not a bogus filter.
    expect(parseMemberSelection(' , ,, ')).toEqual({ all: false, ids: [] });
  });

  it('round-trips through serialization', () => {
    expect(serializeMemberSelection({ all: true, ids: [] })).toBe('all');
    expect(serializeMemberSelection({ all: false, ids: ['m-1'] })).toBe('m-1');
    expect(serializeMemberSelection({ all: false, ids: ['m-1', 'm-2'] })).toBe('m-1,m-2');
    expect(serializeMemberSelection({ all: false, ids: [] })).toBeNull();
  });
});
