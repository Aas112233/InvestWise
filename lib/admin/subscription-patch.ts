/**
 * Subscription lifecycle patch builder (pure).
 *
 * Turns the subscription control panel's draft into the exact payload
 * POST /api/admin/billing expects, applying the API's anchor rule: a
 * gracePeriodDays change is only valid together with a currentPeriodEnd in the
 * same request (the endpoint resolves the grace window against that value, not
 * against the stored row). Keeping this logic out of the component makes it
 * unit-testable and keeps the component a thin renderer.
 *
 * datetime-local strings ("YYYY-MM-DDTHH:mm") are converted through the shared
 * parseDateTimeInput so an impossible date is rejected client-side with the
 * same message the API would return, instead of a wasted round trip.
 */
import { parseDateTimeInput } from '@/lib/admin/date-input';

export interface SubscriptionBaseline {
  status: string | null;
  planSlug: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
}

export interface SubscriptionDraft {
  status: string;
  planSlug: string | null;
  /** datetime-local value or '' (cleared). */
  currentPeriodEnd: string;
  /** datetime-local value or '' (cleared). */
  trialEndsAt: string;
  /** integer string, or '' to leave the grace window untouched. */
  graceDays: string;
  reason: string;
}

export type PatchResult =
  | { ok: true; patch: Record<string, unknown>; changedFields: string[] }
  | { ok: false; message: string };

/** ISO → local datetime-local input value. '' for null/invalid. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local datetime-local value → ISO string. null for '' (explicit clear). */
export function localInputToIso(value: string): { ok: true; iso: string | null } | { ok: false; message: string } {
  const v = value.trim();
  if (!v) return { ok: true, iso: null };
  const r = parseDateTimeInput(v, 'date');
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, iso: r.date.toISOString() };
}

/**
 * Whole grace days implied by the stored window, shown as the input's initial
 * value. The column is derived (graceEndsAt − currentPeriodEnd), so this is a
 * display aid; the saved value always re-anchors on the period end.
 */
export function deriveGraceDays(base: Pick<SubscriptionBaseline, 'graceEndsAt' | 'currentPeriodEnd'>): number | null {
  if (!base.graceEndsAt || !base.currentPeriodEnd) return null;
  const g = new Date(base.graceEndsAt).getTime();
  const p = new Date(base.currentPeriodEnd).getTime();
  if (Number.isNaN(g) || Number.isNaN(p) || g < p) return null;
  return Math.round((g - p) / 86_400_000);
}

function datesEqual(a: string | null | undefined, bIso: string | null): boolean {
  if (!a && bIso === null) return true;
  if (!a || bIso === null) return false;
  // Minute precision on both sides: datetime-local inputs carry no seconds, so
  // a stored value with seconds must not read as "changed" merely because the
  // control cannot display them.
  return (
    Math.floor(new Date(a).getTime() / 60_000) ===
    Math.floor(new Date(bIso).getTime() / 60_000)
  );
}

export function buildSubscriptionPatch(
  base: SubscriptionBaseline,
  draft: SubscriptionDraft,
): PatchResult {
  const patch: Record<string, unknown> = {};
  const changedFields: string[] = [];
  const errors: string[] = [];

  if (draft.status && draft.status !== base.status) {
    patch.status = draft.status;
    changedFields.push('status');
  }

  if (draft.planSlug !== (base.planSlug ?? null)) {
    patch.planSlug = draft.planSlug;
    changedFields.push('plan');
  }

  // Dates: '' means "cleared" only when the baseline had a value.
  const period = localInputToIso(draft.currentPeriodEnd);
  if (!period.ok) errors.push(period.message.replace("Field 'date'", "Field 'currentPeriodEnd'"));
  else if (!datesEqual(base.currentPeriodEnd, period.iso)) {
    patch.currentPeriodEnd = period.iso;
    changedFields.push('currentPeriodEnd');
  }

  const trial = localInputToIso(draft.trialEndsAt);
  if (!trial.ok) errors.push(trial.message.replace("Field 'date'", "Field 'trialEndsAt'"));
  else if (!datesEqual(base.trialEndsAt, trial.iso)) {
    patch.trialEndsAt = trial.iso;
    changedFields.push('trialEndsAt');
  }

  const baseGraceDays = deriveGraceDays(base);
  const graceRaw = draft.graceDays.trim();
  if (graceRaw !== '') {
    const graceDays = Number(graceRaw);
    if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 3650) {
      errors.push("Grace days must be a whole number between 0 and 3650");
    } else if (graceDays !== baseGraceDays) {
      // Grace is only meaningful relative to a paid-through date. The billing
      // endpoint demands currentPeriodEnd in the same request as the anchor,
      // so resend the existing value when the operator did not edit it.
      const anchor =
        'currentPeriodEnd' in patch && patch.currentPeriodEnd !== null
          ? String(patch.currentPeriodEnd)
          : base.currentPeriodEnd;
      if (!anchor) {
        errors.push(
          'Set a paid-through end date first — the grace window is measured from it.',
        );
      } else {
        patch.gracePeriodDays = graceDays;
        changedFields.push('gracePeriodDays');
        if (!('currentPeriodEnd' in patch)) {
          patch.currentPeriodEnd = new Date(anchor).toISOString();
        }
      }
    }
  }

  const reason = draft.reason.trim();
  if (reason) patch.reason = reason.slice(0, 500);

  if (errors.length > 0) return { ok: false, message: errors.join(' · ') };
  return { ok: true, patch, changedFields };
}
