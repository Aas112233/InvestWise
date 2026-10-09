-- 0014_projects_status_vocabulary.sql
--
-- `DELETE /api/projects/{id}` is the "cancel project" action: it soft-deletes
-- by setting status='Cancelled', health='Critical' (app/api/projects/[id]/
-- route.ts line ~212). `lib/utils/validation.ts` line 12 declares
-- PROJECT_STATUSES = ['In Progress','Review','Completed','Cancelled'] and uses
-- that enum for BOTH create and update — so 'Cancelled' is an official value
-- the application writes.
--
-- The live `projects_status_check`, however, only allowed
-- ('In Progress','Completed','Review'). Every project cancel therefore raised
-- 23514 -> a 500 the UI renders as "Failed to cancel project". This is the
-- same class of drift as 0008 (transactions status), 0011 (blacklist reason)
-- and 0012 (transactions type): the constraint was never widened to match the
-- vocabulary the application actually writes and reads back.
--
-- Widening is the correct fix here rather than dropping 'Cancelled' from the
-- enum: a cancelled project must remain distinguishable from a completed one
-- for reporting, and the value is already referenced by the API contract.
--
-- Purely additive — every previously allowed value stays allowed, so no legacy
-- row can start failing. No data UPDATE needed (no 'Cancelled' row could have
-- been written while the old check stood). Idempotent: DROP IF EXISTS + ADD.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status::text = ANY (ARRAY[
    'In Progress'::character varying,
    'Review'::character varying,
    'Completed'::character varying,
    'Cancelled'::character varying
  ]::text[]));
