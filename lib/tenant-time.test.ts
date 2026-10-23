import { describe, expect, it } from 'vitest';
import {
  calendarDayForInstant,
  dayEndUtc,
  dayRangeUtc,
  isIsoDay,
  parseBusinessDate,
} from './tenant-time';

// Cooperative tenants live on daylight-free zones (Asia/Dhaka UTC+6,
// Asia/Riyadh UTC+3) — the exact offsets the boundary tests pin.
describe('calendarDayForInstant', () => {
  it('shifts early-UTC-morning instants back a day east of Greenwich', () => {
    const instant = new Date('2026-10-23T02:00:00Z'); // 08:00 Dhaka
    expect(calendarDayForInstant(instant, 'Asia/Dhaka')).toBe('2026-10-23');
    expect(calendarDayForInstant(new Date('2026-10-22T20:00:00Z'), 'Asia/Dhaka')).toBe('2026-10-23');
  });

  it('falls back to the UTC day for an unknown zone instead of throwing', () => {
    expect(calendarDayForInstant(new Date('2026-10-23T02:00:00Z'), 'Not/AZone')).toBe('2026-10-23');
  });
});

describe('dayRangeUtc', () => {
  it('covers the whole Dhaka day, not the UTC day', () => {
    const { start, end } = dayRangeUtc('2026-10-23', 'Asia/Dhaka');
    expect(start.toISOString()).toBe('2026-10-22T18:00:00.000Z'); // 23rd 00:00 +06
    expect(end.toISOString()).toBe('2026-10-23T17:59:59.999Z');
  });

  it('matches endOfRangeUtc convention for UTC tenants', () => {
    const { start, end } = dayRangeUtc('2026-03-31', 'UTC');
    expect(start.toISOString()).toBe('2026-03-31T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('passes full ISO timestamps through untouched', () => {
    const iso = '2026-10-23T09:15:00.000Z';
    const { start, end } = dayRangeUtc(iso, 'Asia/Dhaka');
    expect(start.toISOString()).toBe(iso);
    expect(end.toISOString()).toBe(iso);
  });

  it('dayEndUtc is the range end', () => {
    expect(dayEndUtc('2026-10-23', 'Asia/Riyadh').toISOString()).toBe('2026-10-23T20:59:59.999Z');
  });
});

describe('parseBusinessDate', () => {
  const now = new Date('2026-10-23T09:00:00Z');

  it('accepts back-dated and same-day values', () => {
    expect(parseBusinessDate('2026-10-01', { now }).date?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseBusinessDate(null, { now }).date).toBeNull();
    expect(parseBusinessDate('  ', { now }).date).toBeNull();
  });

  it('rejects junk and future dates beyond the slack', () => {
    expect(parseBusinessDate('not-a-date', { now }).code).toBe('INVALID_DATE');
    expect(parseBusinessDate('2026-10-25', { now }).code).toBe('FUTURE_DATE');
    // 12h slack absorbs picker timezone skew, not time travel.
    expect(parseBusinessDate('2026-10-23T18:00:00Z', { now }).date).not.toBeNull();
    expect(parseBusinessDate('2026-10-23T22:00:00Z', { now }).code).toBe('FUTURE_DATE');
  });

  it('isIsoDay only accepts bare calendar days', () => {
    expect(isIsoDay('2026-10-23')).toBe(true);
    expect(isIsoDay('2026-10-23T00:00:00Z')).toBe(false);
  });
});
