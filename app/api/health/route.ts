import { NextResponse } from "next/server";

/**
 * Lightweight liveness probe used by the offline banner (#50) to detect when
 * the backend is reachable again. Intentionally public (no auth, no DB) so it
 * answers even when the auth stack or database is degraded — the question it
 * answers is "is the server process responding at all?".
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
