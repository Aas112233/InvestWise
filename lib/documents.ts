import { toast } from "sonner";

/** Kinds of printable documents the Document module supports. */
export type DocumentKind = "deposit" | "project" | "project-update" | "voucher";

/**
 * Offer the document AFTER the write succeeded, instead of pre-opening a tab
 * for a result that has not happened yet.
 *
 * The reserve/navigate pattern in this module exists only because browsers
 * honour `window.open` inside a user gesture, so a tab had to be pre-opened
 * before the request. The consequence was that a blank browser tab appeared the
 * moment Save was pressed and sat there through the whole round-trip, and if the
 * write failed it had to be closed again — so a failed deposit still visibly
 * "opened a print window". Issuing a financial document should never look like a
 * side effect of something that did not happen.
 *
 * A toast action is itself a real user gesture, so `openPrintTab` works from it
 * with no reservation at all. Nothing opens unless the transaction succeeded AND
 * the user wants the paper. If the toast is dismissed, every document stays
 * reachable from the row's own Print action, so nothing is lost.
 *
 * `title` / `actionLabel` are passed in already translated rather than resolved
 * here, so this module stays free of a locale dependency (it is imported by
 * plain callbacks, not components).
 */
export function offerPrintDocument(opts: {
  kind: DocumentKind;
  id: string;
  title: string;
  actionLabel: string;
  /** Reference to show as the detail line, e.g. the generated deposit number. */
  reference?: string;
}): void {
  if (!opts.id) return;
  toast.success(opts.title, {
    description: opts.reference,
    // Long enough to read and act on, short enough that a stale offer does not
    // linger over the next action.
    duration: 20_000,
    action: {
      label: opts.actionLabel,
      onClick: () => openPrintTab(opts.kind, opts.id),
    },
  });
}

/**
 * Print-tab plumbing.
 *
 * `openPrintTab` is the live entry point: it is called from a click — a row's
 * Print action, or the button inside {@link offerPrintDocument}'s toast — so the
 * browser gesture is still in force and no reservation is needed.
 *
 * The reserved-window pair below is the older mechanism, retained only while
 * other branches stop using it. It existed for the same gesture problem, but it
 * opened the tab BEFORE the write resolved, which is exactly what
 * {@link offerPrintDocument} replaces. Do not add new callers.
 */
let reservedWindow: Window | null = null;

function isReservedBlank(win: Window): boolean {
  try {
    const href = win.location.href;
    return href === "about:blank" || href === "";
  } catch {
    // Cross-origin (user navigated it away) — don't close a tab the user owns.
    return false;
  }
}

/**
 * Reserve the print tab before the mutation runs.
 * @deprecated Use {@link offerPrintDocument}. Reserving a tab up front opens a
 * browser window for a result that has not been decided yet, so a failed
 * transaction visibly "opened a print window" and then had to close it again.
 */
export function reservePrintWindow(): void {
  if (typeof window === "undefined") return;
  if (reservedWindow && !reservedWindow.closed) return; // keep an existing reservation
  try {
    reservedWindow = window.open("", "_blank") || null;
  } catch {
    reservedWindow = null; // blocked even on click — openPrintTab falls back
  }
}

/**
 * Release the reserved tab without opening a document (call on mutation error).
 * @deprecated Unnecessary with {@link offerPrintDocument} — nothing is opened
 * before the write succeeds, so there is nothing to take back.
 */
export function releasePrintWindow(): void {
  if (typeof window === "undefined") return;
  if (reservedWindow && !reservedWindow.closed && isReservedBlank(reservedWindow)) {
    reservedWindow.close();
  }
  reservedWindow = null;
}

/**
 * Open a printable document in a new tab (or the pre-reserved one). The tab
 * renders a chrome-free A4 sheet with a Print / Close toolbar
 * (see app/print/[kind]/[id]/page.tsx).
 */
export function openPrintTab(kind: DocumentKind, id: string): void {
  if (typeof window === "undefined" || !id) return;
  const url = `/print/${kind}/${id}`;
  if (reservedWindow && !reservedWindow.closed) {
    try {
      reservedWindow.location.replace(url);
      reservedWindow = null;
      return;
    } catch {
      // fall through to a fresh open
    }
  }
  reservedWindow = null;
  const win = window.open(url, "_blank");
  if (!win) {
    // Even the click-time reservation was blocked — degrade to in-tab navigation.
    window.location.href = url;
  }
}
