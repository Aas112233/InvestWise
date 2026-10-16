/** Kinds of printable documents the Document module supports. */
export type DocumentKind = "deposit" | "project" | "project-update";

/**
 * Printable-document opener with a popup-blocker-safe pre-open pattern.
 *
 * Browsers only allow `window.open()` inside a user gesture. The success
 * handlers that fire the print tab run after a network round-trip, by which
 * time the gesture is gone and the tab gets blocked. So the caller reserves
 * the tab at click/submit time (`reservePrintWindow`) and this module only
 * navigates it once the request succeeds (`openPrintTab`). Failed requests
 * close the reserved blank tab again (`releasePrintWindow`).
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

/** Reserve the print tab. Call from the click/submit handler, before the mutation. */
export function reservePrintWindow(): void {
  if (typeof window === "undefined") return;
  if (reservedWindow && !reservedWindow.closed) return; // keep an existing reservation
  try {
    reservedWindow = window.open("", "_blank") || null;
  } catch {
    reservedWindow = null; // blocked even on click — openPrintTab falls back
  }
}

/** Release the reserved tab without opening a document (call on mutation error). */
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
