import { pgTable, uuid, varchar, jsonb, timestamp, boolean, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  password: varchar('password', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).default('Member'),
  status: varchar('status', { length: 50 }).default('active'),
  permissions: jsonb('permissions').default({}),
  lastLogin: timestamp('last_login', { withTimezone: true }),
  avatar: varchar('avatar'),
  memberId: varchar('member_id', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_users_role_status').on(table.role, table.status),
  index('idx_users_member_id').on(table.memberId),
  index('idx_users_created_at').on(table.createdAt),
]);
