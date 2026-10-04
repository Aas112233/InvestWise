/**
 * Platform action-log vocabulary.
 *
 * Lives outside the route file on purpose: Next.js generates per-route type
 * validators and rejects any non-HTTP named export from a `route.ts`.
 */
export const ADMIN_ACTION_TYPES = [
  'TENANT_SUSPEND',
  'TENANT_ACTIVATE',
  'TENANT_UPDATE',
  'TENANT_FORCE_DELETE',
  'TENANT_ONBOARD',
  'TENANT_MAINTENANCE',
  'TENANT_IMPERSONATE_START',
  'TENANT_IMPERSONATE_END',
  'SUBSCRIPTION_CHANGE',
  'SUBSCRIPTION_EXPIRY',
  'USER_UPDATE',
  'USER_PASSWORD_RESET',
  'USER_IMPERSONATE',
  'MODULE_ACCESS_CHANGE',
  'PLATFORM_SETTINGS_UPDATE',
  'PLAN_CREATE',
  'PLAN_UPDATE',
] as const;

/**
 * Broadcasts are stored in the same table for historical reasons but are
 * CONTENT, not admin actions — excluded from the operator action view so it
 * shows only actions taken on the platform.
 */
export const CONTENT_ACTION_TYPES = [
  'BROADCAST_NOTICE',
  'BROADCAST_NOTICE_EDIT',
  'BROADCAST_NOTICE_RETRACTED',
] as const;
