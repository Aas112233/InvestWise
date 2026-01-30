import { useGlobalState } from '../context/GlobalStateContext';
import { AppScreen, AccessLevel } from '../types';

/**
 * Custom hook to check if the current user has the required permission level for a screen
 * @param screen - The screen to check permissions for
 * @param requiredLevel - The minimum required access level (defaults to WRITE)
 * @returns boolean - true if user has sufficient permission, false otherwise
 */
export function usePermission(screen: AppScreen, requiredLevel: AccessLevel = AccessLevel.WRITE): boolean {
    const { currentUser } = useGlobalState();

    if (!currentUser) {
        return false;
    }

    // Permissions can be either a Map or a plain object (from backend)
    const userPermission = currentUser.permissions instanceof Map
        ? currentUser.permissions.get(screen)
        : currentUser.permissions?.[screen];

    // No access
    if (!userPermission || userPermission === AccessLevel.NONE) {
        return false;
    }

    // Check required level
    if (requiredLevel === AccessLevel.WRITE) {
        return userPermission === AccessLevel.WRITE;
    }

    if (requiredLevel === AccessLevel.READ) {
        return userPermission === AccessLevel.READ || userPermission === AccessLevel.WRITE;
    }

    return false;
}
