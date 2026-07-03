import { pgTable, uuid, varchar, integer, decimal, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const members = pgTable('members', {
  id: uuid('id').defaultRandom().primaryKey(),
  memberId: varchar('member_id', { length: 50 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  role: varchar('role', { length: 50 }).default('Member'),
  shares: integer('shares').default(0).notNull(),
  totalContributed: decimal('total_contributed', { precision: 15, scale: 2 }).default('0'),
  status: varchar('status', { length: 50 }).default('active'),
  avatar: varchar('avatar'),
  lastActive: timestamp('last_active', { withTimezone: true }).defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  userId: uuid('user_id').references(() => users.id),
  hasUserAccess: boolean('has_user_access').default(false),
  legacyMongoId: varchar('legacy_mongo_id', { length: 24 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_members_status_name').on(table.status, table.name),
  index('idx_members_email_status').on(table.email, table.status),
  index('idx_members_name').on(table.name),
]);
