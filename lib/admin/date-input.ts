/**
 * Date-time input validation for platform-controlled deadlines.
 *
 * Shared by the billing override endpoint and the subscription expiry engine so
 * an impossible calendar date is rejected the same way everywhere. `new Date()`
 * silently rolls "2026-02-30" over to March 2nd, which would store a paid-through
 * date three days earlier than the operator typed.
 */

export type DateInputResult = { ok: true; date: Date } | { ok: false; message: string };

export function parseDateTimeInput(value: unknown, field = 'date'): DateInputResult {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: `[Field '${field}', Code: invalid_type] A date-time string is required` };
  }
  const v = value.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);

  if (local) {
    const [, ys, ms, ds, hs, mis, ss] = local;
    const year = Number(ys);
    const month = Number(ms);
    const day = Number(ds);
    const hour = Number(hs);
    const minute = Number(mis);
    const second = Number(ss || 0);

    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const maxDay = daysInMonth[month - 1] ?? 0;
    if (month < 1 || month > 12 || day < 1 || day > maxDay) {
      return { ok: false, message: `[Field '${field}', Code: invalid_date] ${v} is not a real calendar date` };
    }
    if (hour > 23 || minute > 59 || second > 59) {
      return { ok: false, message: `[Field '${field}', Code: invalid_time] ${v} has an out-of-range time` };
    }
  }

  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: `[Field '${field}', Code: invalid_date] ${v} could not be parsed` };
  }
  return { ok: true, date: parsed };
}

/** ISO instant -> the `YYYY-MM-DDTHH:mm` shape a datetime-local input expects. */
export function toDateTimeLocal(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whole days from now until `iso`; negative once it has passed. */
export function daysUntil(iso: string | Date | null | undefined): number | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}
