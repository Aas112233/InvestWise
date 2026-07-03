import { pgTable, uuid, varchar, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }).notNull(),
  success: boolean('success').notNull(),
  failureReason: varchar('failure_reason', { length: 50 }),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  userAgent: varchar('user_agent', { length: 500 }),
  location: jsonb('location'),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  emailTimestampIdx: index('idx_login_attempts_email_timestamp').on(table.email, table.timestamp.desc()),
  ipTimestampIdx: index('idx_login_attempts_ip_timestamp').on(table.ipAddress, table.timestamp.desc()),
}));
