import { pgTable, uuid, varchar, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Per-tenant counters behind the human-facing ledger reference
 * (`transactions.doc_number`, e.g. `DEP-2026-00042`).
 *
 * Why a counter table instead of a native Postgres SEQUENCE:
 *   * A SEQUENCE is not transactional. `nextval()` commits even when the
 *     surrounding INSERT rolls back, so every failed or reverted posting would
 *     burn a number. For printed financial documents a gap in the series is an
 *     audit question that has to be answered every time it comes up, so gaps
 *     are worse than the contention the sequence avoids.
 *   * A SEQUENCE would also need one object per (tenant, type, year), i.e.
 *     dynamic DDL inside request traffic on the first deposit of each year for
 *     each tenant.
 *
 * This table gives the same atomicity through row locks: the allocation is an
 * `INSERT .. ON CONFLICT DO UPDATE .. RETURNING` (see `app_next_doc_number` in
 * db/migrations/0026_doc_number.sql), which serialises concurrent allocations
 * on one counter row and rolls back with the posting that asked for it.
 *
 * Allocation happens in a BEFORE INSERT trigger on `transactions`, NOT in
 * application code, because the ledger is written from 20+ call sites across
 * both the Next.js routes and `server/src/modules/**`. An invariant that must
 * hold for every row belongs in the database; a per-site helper would eventually
 * miss one, and the symptom of a miss is a blank reference on a receipt.
 */
export const documentSequences = pgTable('document_sequences', {
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  /** Short code derived from `transactions.type` — DEP / EXP / DVD / TFO .. */
  docType: varchar('doc_type', { length: 10 }).notNull(),
  /** Accounting year taken from `transactions.date` (the canonical money date). */
  periodYear: integer('period_year').notNull(),
  lastSeq: integer('last_seq').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  // The composite key IS the uniqueness guarantee the allocator's ON CONFLICT
  // target relies on — no separate unique index is needed.
  primaryKey({ columns: [table.tenantId, table.docType, table.periodYear] }),
]);
