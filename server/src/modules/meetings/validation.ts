import { z } from 'zod';

const uuidField = z.string().uuid('Must be a valid UUID');

export const createMeetingSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters').max(255),
  meetingDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid date format')),
  meetingType: z.string().min(1, 'Meeting type is required'),
  location: z.string().max(255).nullable().optional(),
  agenda: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const updateMeetingSchema = z.object({
  title: z.string().min(2).max(255).optional(),
  meetingDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  meetingType: z.string().min(1).optional(),
  location: z.string().max(255).nullable().optional(),
  agenda: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});

export const recordAttendanceSchema = z.object({
  records: z
    .array(
      z.object({
        memberId: uuidField,
        attendanceStatus: z.enum(['PRESENT', 'ABSENT', 'EXCUSED']),
        notes: z.string().max(500).nullable().optional(),
      }),
    )
    .min(1, 'At least one attendee record is required'),
});

export const completeMeetingSchema = z.object({
  notes: z.string().nullable().optional(),
});
