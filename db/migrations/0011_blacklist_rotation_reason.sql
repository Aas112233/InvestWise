-- 0011_blacklist_rotation_reason.sql
--
-- The refresh route rotates the session on every token refresh and records the
-- old refresh token in `blacklisted_tokens` with reason='rotation'. The
-- original CHECK constraint only allowed ('logout','password_change','security',
-- 'user_request'), so EVERY refresh raised 23514 ->
-- `{ code: 'REFRESH_FAILED' }` 500 -> the access cookie (15m) was never renewed
-- -> the user was bounced to /login roughly every 15 minutes of active use.
--
-- Widening the CHECK is the correct fix: 'rotation' is a genuine first-class
-- reason (token revoked because it was exchanged), and it must stay distinct
-- from 'logout' so audit tooling can tell the two apart. Idempotent.

ALTER TABLE blacklisted_tokens DROP CONSTRAINT IF EXISTS blacklisted_tokens_reason_check;

ALTER TABLE blacklisted_tokens
  ADD CONSTRAINT blacklisted_tokens_reason_check
  CHECK (reason::text = ANY (ARRAY[
    'logout'::character varying,
    'password_change'::character varying,
    'security'::character varying,
    'user_request'::character varying,
    'rotation'::character varying
  ]::text[]));
