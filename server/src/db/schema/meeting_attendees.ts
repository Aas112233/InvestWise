import { pgTable, uuid, varchar, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { meetings } from './meetings.js';
import { members } from './members.js';

export const meetingAttendees = pgTable('meeting_attendees', {
  id: uuid('id').defaultRandom().primaryKey(),
  meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'cascade' }).notNull(),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  attendanceStatus: varchar('attendance_status', { length: 50 }).default('ABSENT').notNull(), // PRESENT, ABSENT, EXCUSED
  depositStatus: varchar('deposit_status', { length: 50 }).default('PENDING').notNull(), // PAID_ON_TIME, PAID_LATE, PENDING
  notes: varchar('notes', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_attendees_meeting_status').on(table.meetingId, table.attendanceStatus),
  index('idx_attendees_member').on(table.memberId),
  unique('uq_meeting_member').on(table.meetingId, table.memberId),
]);
