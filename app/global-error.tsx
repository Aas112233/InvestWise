"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary. Next.js requires this file to render its OWN
 * <html>/<body>: when it fires the root layout is gone, so no fonts, themes or
 * providers are available here.
 *
 * Issue #55: without this file Next 15 + Turbopack fell back to the *builtin*
 * `global-error` module, which it failed to resolve from the React Client
 * Manifest after a stale `.next` — producing a total blank screen on the first
 * paint. Defining our own boundary removes that failure class and gives the
 * user something actionable instead of a white page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the browser console and any attached error reporter.
    console.error("[GLOBAL ERROR]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            border: "1px solid #e2e8f0",
            borderRadius: "1rem",
            background: "#ffffff",
            padding: "1.75rem",
            boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: "2.5rem",
              height: "2.5rem",
              borderRadius: "0.75rem",
              background: "rgba(225,29,72,0.1)",
              color: "#e11d48",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.25rem",
              fontWeight: 700,
            }}
          >
            !
          </div>
          <h1
            style={{
              margin: "1rem 0 0.375rem",
              fontSize: "1.0625rem",
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            Something went wrong
          </h1>
          <p style={{ margin: 0, fontSize: "0.8125rem", lineHeight: 1.55, color: "#64748b" }}>
            The application hit an unexpected error and could not finish loading.
            Your data has not been changed — try again, and if it persists reload
            the page.
          </p>
          {error.digest && (
            <p
              style={{
                margin: "0.75rem 0 0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.6875rem",
                color: "#94a3b8",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                border: 0,
                borderRadius: "0.625rem",
                background: "#0f172a",
                color: "#ffffff",
                padding: "0.5rem 0.875rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.assign("/");
              }}
              style={{
                borderRadius: "0.625rem",
                border: "1px solid #e2e8f0",
                background: "#ffffff",
                color: "#334155",
                padding: "0.5rem 0.875rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
