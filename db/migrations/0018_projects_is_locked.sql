-- 0018: permanent completion lock for settled projects.
--
-- A "Distribute Complete Project" (settle & close) run pays the project's
-- entire remaining balance, marks the project Completed, and flips this flag.
-- The flag is one-way: every project write door (edit, delete, postings,
-- distributions, ledger-row delete/restore) rejects locked projects, and no
-- code path ever clears it.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
