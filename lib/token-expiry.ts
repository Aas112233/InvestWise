// Shared JWT expiry reader (token payload `exp`, seconds since epoch).
// Lives outside route modules: Next.js route files may only export HTTP
// method handlers, so helpers shared between routes belong here.
export function getTokenExpiry(token: string): Date {
  try {
    const part = token.split('.')[1];
    if (part) {
      const decoded = JSON.parse(Buffer.from(part, 'base64').toString()) as { exp?: number } | null;
      if (decoded?.exp) {
        return new Date(decoded.exp * 1000);
      }
    }
  } catch {
    // Fall through to default
  }
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}
