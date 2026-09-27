/**
 * Platform Owner / SuperAdmin resolution helper (Pathshala-Pro design port).
 * Reads the SUPERADMIN_EMAILS allowlist (comma-separated, fallback to the
 * legacy singular SUPERADMIN_EMAIL) to provide deterministic,
 * infrastructure-level superadmin authorization that survives database
 * wipes and role tampering.
 */

export function getPlatformOwnerEmails(): string[] {
  const raw = [
    ...(process.env.SUPERADMIN_EMAILS || '').split(','),
    process.env.SUPERADMIN_EMAIL || '',
  ];
  return raw.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isPlatformOwnerEmail(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false;
  return getPlatformOwnerEmails().includes(email.trim().toLowerCase());
}
