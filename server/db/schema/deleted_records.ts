import { pgTable, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const deletedRecords = pgTable('deleted_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  originalId: varchar('original_id', { length: 255 }).notNull(),
  collectionName: varchar('collection_name', { length: 100 }).notNull(),
  data: jsonb('data').notNull(),
  reason: varchar('reason', { length: 500 }),
  deletedBy: uuid('deleted_by').references(() => users.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
