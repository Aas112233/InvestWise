import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const meetings = pgTable('meetings', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  meetingDate: timestamp('meeting_date', { withTimezone: true }).notNull(),
  meetingType: varchar('meeting_type', { length: 50 }).notNull(), // FOUNDING_MEMBER, SHAREHOLDER, INVESTOR, GENERAL
  location: varchar('location', { length: 255 }).default('HQ / Online'),
  agenda: text('agenda'),
  notes: text('notes'),
  status: varchar('status', { length: 50 }).default('SCHEDULED').notNull(), // SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED
  conductedBy: uuid('conducted_by').references(() => users.id),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_meetings_date_status').on(table.meetingDate.desc(), table.status),
  index('idx_meetings_type').on(table.meetingType),
  index('idx_meetings_status').on(table.status),
]);
