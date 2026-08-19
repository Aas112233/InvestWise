import { useGlobalState } from '../context/GlobalStateContext';
import { AppScreen, AccessLevel } from '../types';
import { checkUserPermission } from '../utils/permissions';

/**
 * Custom hook to check if the current user has the required permission level for a screen.
 * Seamlessly resolves Super Admin overrides, explicit permissions, and role defaults.
 * 
 * @param screen - The screen to check permissions for
 * @param requiredLevel - The minimum required access level (defaults to WRITE)
 * @returns boolean - true if user has sufficient permission, false otherwise
 */
export function usePermission(screen: AppScreen | string, requiredLevel: AccessLevel = AccessLevel.WRITE): boolean {
  const { currentUser } = useGlobalState();
  return checkUserPermission(currentUser, screen, requiredLevel);
}
