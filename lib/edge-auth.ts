import { jwtVerify } from 'jose';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';
import { isSuperAdminRole } from '@/lib/roles';

// Edge-safe token verification (Pathshala-Pro proxy.ts port).
// Edge runtime has no Node builtins and no database: this verifies the
// signature and reads the claims embedded at issuance (login/refresh).
// Route handlers re-verify authoritatively via getAuthContext().

export interface EdgeAuthClaims {
  id: string;
  role?: string;
  email?: string;
  tenantId?: string | null;
  subscriptionBlocked?: boolean;
  impersonatedBy?: string;
}

export async function verifyEdgeAccessToken(token: string): Promise<EdgeAuthClaims | null> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (payload.type !== 'access' || typeof payload.id !== 'string') return null;
    return {
      id: payload.id,
      role: typeof payload.role === 'string' ? payload.role : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
      subscriptionBlocked: payload.subscriptionBlocked === true,
      impersonatedBy: typeof payload.impersonatedBy === 'string' ? payload.impersonatedBy : undefined,
    };
  } catch {
    return null;
  }
}

export function isPlatformEdge(claims: EdgeAuthClaims): boolean {
  return (
    isSuperAdminRole(claims.role) ||
    isPlatformOwnerEmail(claims.email) ||
    !!claims.impersonatedBy
  );
}
