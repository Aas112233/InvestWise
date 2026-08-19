import { User, AppScreen, AccessLevel } from '../types';

/**
 * Pure evaluator for user screen permissions on the client side.
 * Matches the exact backend logic in server/src/middleware/auth.ts to ensure 0% mismatch.
 */
export function checkUserPermission(
  user: User | null | undefined,
  screen: AppScreen | string,
  requiredLevel: AccessLevel = AccessLevel.WRITE
): boolean {
  if (!user) return false;

  const role = user.role || 'Member';
  // Super Admin & Admin have unconditional WRITE & READ everywhere
  if (role === 'Admin' || role === 'Administrator') {
    return true;
  }

  // Explicit user permission takes highest precedence (with parent screen fallback)
  let explicit = user.permissions instanceof Map
    ? user.permissions.get(screen)
    : user.permissions?.[screen];

  if (!explicit && user.permissions) {
    if (screen === AppScreen.MEETINGS || screen === AppScreen.GOVERNANCE) {
      explicit = user.permissions instanceof Map
        ? user.permissions.get(AppScreen.MEMBERS)
        : user.permissions[AppScreen.MEMBERS];
    } else if (screen === AppScreen.REQUEST_DEPOSIT || screen === AppScreen.TRANSACTIONS) {
      explicit = user.permissions instanceof Map
        ? user.permissions.get(AppScreen.DEPOSITS)
        : user.permissions[AppScreen.DEPOSITS];
    }
  }

  if (explicit === AccessLevel.WRITE) return true;
  if (explicit === AccessLevel.READ && requiredLevel === AccessLevel.READ) return true;
  if (explicit === AccessLevel.NONE) return false;

  // Role defaults when no explicit override is set for this screen
  if (role === 'Manager') {
    if (screen === AppScreen.SETTINGS) return false;
    return true; // Full WRITE for all operational modules
  }

  if (role === 'Audit') {
    return requiredLevel === AccessLevel.READ; // READ access across all modules
  }

  if (role === 'Investor') {
    const investorReadScreens: (AppScreen | string)[] = [
      AppScreen.DASHBOARD,
      AppScreen.DEPOSITS,
      AppScreen.PROJECT_MANAGEMENT,
      AppScreen.ANALYSIS,
      AppScreen.REPORTS,
      AppScreen.GOALS,
      AppScreen.TRANSACTIONS,
    ];
    return investorReadScreens.includes(screen) && requiredLevel === AccessLevel.READ;
  }

  if (role === 'Member' || role === 'Associate Member') {
    if (screen === AppScreen.REQUEST_DEPOSIT) return true;
    const memberReadScreens: (AppScreen | string)[] = [
      AppScreen.DASHBOARD,
      AppScreen.DEPOSITS,
      AppScreen.GOALS,
    ];
    return memberReadScreens.includes(screen) && requiredLevel === AccessLevel.READ;
  }

  return false;
}
