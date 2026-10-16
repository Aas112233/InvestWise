import { pgTable, uuid, varchar, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

// Canonical sessions table. server/src/db/schema/sessions.ts mirrors this file
// (both runtimes share one PostgreSQL table) — keep the two in lockstep,
// especially the uniqueIndex name below: a `drizzle-kit push` run from either
// side rewrites constraint names, so the two files must declare the same one.
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  ipAddress: varchar('ip_address', { length: 50 }).notNull(),
  userAgent: varchar('user_agent', { length: 500 }).notNull(),
  locationCountry: varchar('location_country', { length: 100 }).default('Unknown'),
  locationCity: varchar('location_city', { length: 100 }).default('Unknown'),
  locationRegion: varchar('location_region', { length: 100 }).default('Unknown'),
  loginTime: timestamp('login_time', { withTimezone: true }).defaultNow(),
  lastActivity: timestamp('last_activity', { withTimezone: true }).defaultNow(),
  logoutTime: timestamp('logout_time', { withTimezone: true }),
  isActive: boolean('is_active').default(true),
  isExpired: boolean('is_expired').default(false),
  deviceInfo: varchar('device_info', { length: 100 }).default('Unknown'),
  osInfo: varchar('os_info', { length: 100 }).default('Unknown'),
  browserInfo: varchar('browser_info', { length: 100 }).default('Unknown'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('sessions_session_id_unique').on(table.sessionId),
  index('idx_sessions_user_active').on(table.userId, table.isActive),
  index('idx_sessions_session_active').on(table.sessionId, table.isActive),
  index('idx_sessions_logout_time').on(table.logoutTime),
  index('idx_sessions_last_activity').on(table.lastActivity),
]);