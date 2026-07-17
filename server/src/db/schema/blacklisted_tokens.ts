import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const blacklistedTokens = pgTable('blacklisted_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  token: text('token').notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  reason: varchar('reason', { length: 50 }).default('logout'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  expiresAtIdx: index('idx_blacklisted_tokens_expires_at').on(table.expiresAt),
  userIdIdx: index('idx_blacklisted_tokens_user_id').on(table.userId),
}));
