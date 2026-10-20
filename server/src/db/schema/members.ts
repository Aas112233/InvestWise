import { pgTable, uuid, varchar, integer, decimal, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { users } from './users';

export const members = pgTable('members', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  // Uniqueness is PER TENANT (uq_members_* below): global unique columns in a
  // shared-DB multi-tenant model mean one org cannot register a person whose
  // email exists in another org, and the 409 turns the endpoint into a
  // cross-tenant existence oracle.
  memberId: varchar('member_id', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  role: varchar('role', { length: 50 }).default('Member'),
  shares: integer('shares').default(0).notNull(),
  totalContributed: decimal('total_contributed', { precision: 15, scale: 2 }).default('0'),
  status: varchar('status', { length: 50 }).default('active'),
  // WHY the member is not active (lib/governance/status-rules.ts
  // MEMBER_STATUS_REASON): DEPOSIT_NON_COMPLIANCE | EQUITY_TRANSFERRED_OUT |
  // ADMIN_MANUAL. Null = active, or a legacy row predating this column. Kept
  // separate from `status` so the coarse lifecycle state is never overloaded
  // with the cause (two inactive members can be inactive for different
  // reasons, and the sweep must not auto-restore one it did not hold).
  statusReason: varchar('status_reason', { length: 50 }),
  avatar: varchar('avatar'),
  lastActive: timestamp('last_active', { withTimezone: true }).defaultNow(),
  monthlyDepositTarget: decimal('monthly_deposit_target', { precision: 15, scale: 2 }).default('0'),
  depositFrequency: varchar('deposit_frequency', { length: 20 }).default('monthly'),
  joinDate: timestamp('join_date', { withTimezone: true }).defaultNow(),
  lastDepositMonth: varchar('last_deposit_month', { length: 7 }),
  totalArrears: decimal('total_arrears', { precision: 15, scale: 2 }).default('0'),
  withdrawalRequests: integer('withdrawal_requests').default(0),
  warningCount: integer('warning_count').default(0).notNull(),
  performanceScore: decimal('performance_score', { precision: 5, scale: 2 }).default('100.00'),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  userId: uuid('user_id').references(() => users.id),
  hasUserAccess: boolean('has_user_access').default(false),
  nidOrPassport: varchar('nid_or_passport', { length: 100 }),
  fatherName: varchar('father_name', { length: 255 }),
  motherName: varchar('mother_name', { length: 255 }),
  spouseName: varchar('spouse_name', { length: 255 }),
  address: varchar('address', { length: 500 }),
  nomineeName: varchar('nominee_name', { length: 255 }),
  nomineeRelation: varchar('nominee_relation', { length: 100 }),
  nomineeNidOrPassport: varchar('nominee_nid_or_passport', { length: 100 }),
  nomineePhone: varchar('nominee_phone', { length: 50 }),
  // Soft delete (AGENTS.md §12, same pattern as transactions): the row and
  // its ledger/penalty history survive; directory reads, dropdown feeds and
  // dividend rosters filter on isDeleted = false. Hard-deleting members was
  // silently cascading away meeting attendance, project membership and
  // arrears via ON DELETE CASCADE FKs.
  isDeleted: boolean('is_deleted').default(false).notNull(),
  deletedBy: uuid('deleted_by').references(() => users.id),
  deletionReason: varchar('deletion_reason', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  // memberId is a permanent, user-facing code referenced across the app, so
  // it stays unique over live AND soft-deleted rows (a code is never reused).
  uniqueIndex('uq_members_tenant_member_id').on(table.tenantId, table.memberId),
  // Email is unique only among LIVE rows: soft-deleting a member frees their
  // email for re-registration (the code's dup-check filters is_deleted=false,
  // so this partial index keeps DB and application logic in lockstep).
  uniqueIndex('uq_members_tenant_email').on(table.tenantId, table.email).where(sql`is_deleted = false`),
  index('idx_members_tenant').on(table.tenantId),
  index('idx_members_status_name').on(table.status, table.name),
  index('idx_members_email_status').on(table.email, table.status),
  index('idx_members_name').on(table.name),
  // Ledger search box matches member names (GET /api/transactions ?search=) —
  // pg_trgm GIN, applied live via .workbuddy-ai/tmp/add-search-indexes.mjs.
  index('idx_members_name_trgm').using('gin', sql`${table.name} gin_trgm_ops`),
  index('idx_members_user_id').on(table.userId),
  index('idx_members_role_status').on(table.role, table.status),
  index('idx_members_created_at').on(table.createdAt),
]);
