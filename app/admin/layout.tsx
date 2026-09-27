import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyEdgeAccessToken } from "@/lib/edge-auth";
import { isPlatformOwnerEmail } from "@/lib/platform-owner";
import { isSuperAdminRole } from "@/lib/roles";
import { AdminShell } from "@/components/admin/admin-shell";

// Platform console gate: mirrors lib/admin-guard requireSuperAdmin strictly
// (SuperAdmin role or SUPERADMIN_EMAILS allowlist). Runs on top of the edge
// /admin fence in middleware.ts and the per-API requireSuperAdmin checks.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get("accessToken")?.value;
  const claims = token ? await verifyEdgeAccessToken(token) : null;
  if (!claims) redirect("/login?redirect=/admin");
  if (!isSuperAdminRole(claims.role) && !isPlatformOwnerEmail(claims.email)) redirect("/");

  return <AdminShell email={claims.email ?? ""}>{children}</AdminShell>;
}
