/**
 * Tenant-aware date handling (date-handling Tier 1).
 *
 * Two primitives, kept strictly separate:
 *  - INSTANTS  (createdAt, updatedAt, loginTime): real moments, stored as
 *    timestamptz, always compared in UTC.
 *  - BUSINESS DAYS (transactions.date, collectedDate, transfer date, …):
 *    calendar days on the tenant's wall clock. Users pick them with a date
 *    picker and expect "the 23rd" to mean the 23rd IN THEIR TIMEZONE — not
 *    UTC midnight, which silently shifts the day for every non-UTC tenant.
 *
 * Every function here is pure (no DB, no React, no locale files) so it can be
 * imported from API routes, server modules and client components alike.
 */

/** Tenant clock: the YYYY-MM-DD the wall shows at `instant` in `tz`. */
export function calendarDayForInstant(instant: Date, tz: string): string {
  try {
    // en-CA renders `YYYY-MM-DD`; only the day part is used, so the locale
    // tag cannot leak separators into the wire format.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
    // Validate the zone explicitly — Intl falls back to UTC silently for
    // unknown ids, which would silently misattribute days instead.
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(instant);
    return day;
  } catch {
    return instant.toISOString().slice(0, 10); // unknown zone → UTC, never throw
  }
}

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDay(value: string): boolean {
  return ISO_DAY_RE.test(value);
}

/**
 * The inclusive UTC window covering a whole calendar day `iso` in `tz`.
 *
 * `tz` = 'UTC' (or any unparseable value) reproduces lib/formatters'
 * endOfRangeUtc convention exactly, so callers can pass the tenant zone
 * through without branching. Full ISO timestamps pass through untouched —
 * the caller already chose an exact instant.
 */
export function dayRangeUtc(iso: string, tz: string): { start: Date; end: Date } {
  const m = ISO_DAY_RE.exec(iso);
  if (!m) {
    const d = new Date(iso);
    return { start: d, end: d };
  }
  const utcDayStart = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    // Probe the zone's offset at noon-UTC of that day (midnight probes land
    // on a DST boundary in zones that have one; noon never does), then walk
    // the tenant's 00:00 back into UTC. Daylight-free zones (Asia/Dhaka,
    // Asia/Riyadh — every cooperative tenant so far) are exact; a DST zone is
    // off by at most an hour, which cannot misplace a business timestamp.
    const offsetMs = tzOffsetMs(new Date(utcDayStart + 12 * 60 * 60 * 1000), tz);
    const start = new Date(utcDayStart - offsetMs);
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1) };
  } catch {
    return {
      start: new Date(utcDayStart),
      end: new Date(utcDayStart + 24 * 60 * 60 * 1000 - 1),
    };
  }
}

/** Inclusive end of the tenant day — replaces endOfRangeUtc when tz-aware. */
export function dayEndUtc(iso: string, tz: string): Date {
  return dayRangeUtc(iso, tz).end;
}

/**
 * Parse a user-supplied business date (yyyy-mm-dd or full ISO).
 *
 * Back-dating is allowed (back-entry is normal bookkeeping); future-dating is
 * rejected beyond `futureSlackMs` (default 12h: picker timezone skew, not
 * time travel) — a future posting date would desync the row from balance
 * checks and period totals computed against today's books. Same rule the
 * project-updates route (#107) and the fund-transfer desk already enforce,
 * centralised here so every money write gets it.
 */
export function parseBusinessDate(
  value: string | null | undefined,
  opts: { now?: Date; futureSlackMs?: number } = {},
): { date: Date | null; error?: string; code?: string } {
  if (!value || !value.trim()) return { date: null };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: null, error: 'date must be a valid ISO date (yyyy-mm-dd)', code: 'INVALID_DATE' };
  }
  const now = opts.now ?? new Date();
  const slack = opts.futureSlackMs ?? 12 * 60 * 60 * 1000;
  if (parsed.getTime() > now.getTime() + slack) {
    return { date: null, error: 'date cannot be in the future', code: 'FUTURE_DATE' };
  }
  return { date: parsed };
}

/** `instant` as wall-clock reading in `tz`, expressed back as a UTC epoch ms. */
function wallClockAsUtc(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    era: 'short',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

/** Zone offset (ms ahead of UTC) at `instant`. Throws on an unknown zone. */
function tzOffsetMs(instant: Date, tz: string): number {
  // Validate the zone first — Intl silently falls back to UTC otherwise.
  new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(instant);
  return wallClockAsUtc(instant, tz) - instant.getTime();
}
