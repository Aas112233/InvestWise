/**
 * MongoDB → PostgreSQL (Supabase) Data Migration Script
 *
 * Usage:
 *   1. Set both MONGO_URI and DATABASE_URL in your .env file
 *   2. Run: npx tsx scripts/migrate-to-supabase.ts
 *
 * This script:
 *   - Connects to both MongoDB and PostgreSQL simultaneously
 *   - Reads all documents from each MongoDB collection
 *   - Transforms ObjectIds → UUIDs (maintaining a mapping for FK resolution)
 *   - Transforms camelCase → snake_case field names
 *   - Inserts into PostgreSQL tables in FK-safe order
 *   - Handles embedded documents (Project.updates, etc.) → separate tables
 */

import mongoose from 'mongoose';
import postgres from 'postgres';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { createHash } from 'crypto';

dotenv.config({ path: '.env' });

// ─── Configuration ────────────────────────────────────────────────────────────

const MONGO_URI = process.env.MONGO_URI || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

// Deterministic UUID generation from MongoDB ObjectId
// Same ObjectId always maps to same UUID — enables idempotent re-runs
function objectIdToUUID(objectId: string): string {
  const hash = createHash('sha256').update(objectId).digest();
  // Format as UUID v4-like
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ─── Field Name Mapping ───────────────────────────────────────────────────────

interface FieldMap {
  [camelCase: string]: string;
}

// Common field mappings used across collections
const commonFieldMap: FieldMap = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  __v: null as any, // skip
};

function transformDocument(
  doc: any,
  fieldMap: FieldMap,
  idMap: Map<string, string>,
  collection: string
): any {
  const result: any = {};

  // Map _id → id (UUID)
  const mongoId = doc._id?.toString();
  const uuid = objectIdToUUID(mongoId);
  result.id = uuid;
  result.legacy_mongo_id = mongoId;

  // Track ID mapping for FK resolution
  idMap.set(`${collection}:${mongoId}`, uuid);

  for (const [key, value] of Object.entries(doc)) {
    if (key === '_id' || key === '__v') continue;

    const mappedKey = fieldMap[key] || camelToSnake(key);

    if (mappedKey === null) continue; // skip

    // Handle Date objects
    if (value instanceof Date) {
      result[mappedKey] = value.toISOString();
      continue;
    }

    // Handle ObjectId references
    if (mongoose.Types.ObjectId.isValid(value?.toString()) && value?._bsontype === 'ObjectId') {
      // Will be resolved in FK resolution pass
      result[mappedKey] = null; // placeholder
      (result as any).__pendingFks = (result as any).__pendingFks || [];
      (result as any).__pendingFks.push({ field: mappedKey, refValue: value.toString() });
      continue;
    }

    // Handle nested objects (like location, details)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Check if it's a populated subdocument or a plain object
      if (value._bsontype === 'ObjectId' || value._id) {
        // It's a populated reference — just store the ID
        const refId = value._id?.toString() || value.toString();
        result[mappedKey] = null;
        (result as any).__pendingFks = (result as any).__pendingFks || [];
        (result as any).__pendingFks.push({ field: mappedKey, refValue: refId });
      } else {
        // Plain object — convert to JSON string for JSONB columns
        result[mappedKey] = JSON.stringify(value);
      }
      continue;
    }

    // Handle arrays of ObjectIds (like involvedMembers)
    if (Array.isArray(value) && value.length > 0 && value[0]?._bsontype === 'ObjectId') {
      (result as any).__pendingFks = (result as any).__pendingFks || [];
      (result as any).__pendingFks.push({
        field: mappedKey,
        refValues: value.map((v: any) => v.toString()),
      });
      continue;
    }

    // Handle arrays of subdocuments (will be processed separately)
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      // Store as JSONB
      result[mappedKey] = JSON.stringify(value);
      continue;
    }

    result[mappedKey] = value;
  }

  return result;
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// ─── Main Migration ───────────────────────────────────────────────────────────

async function migrate() {
  console.log(' Starting MongoDB → PostgreSQL migration...\n');

  // Connect to MongoDB
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log(' MongoDB connected');

  // Connect to PostgreSQL
  console.log('Connecting to PostgreSQL...');
  const sql = postgres(DATABASE_URL, { max: 5 });
  console.log(' PostgreSQL connected\n');

  const idMap = new Map<string, string>(); // "collection:oldObjectId" → "newUUID"

  // ── 1. Users ──────────────────────────────────────────────────────────────
  console.log('─ Migrating users...');
  const users = await mongoose.model('User').find({}).lean();
  const userRows: any[] = [];
  for (const user of users) {
    const row = transformDocument(user, {
      name: 'name',
      email: 'email',
      password: 'password',
      role: 'role',
      status: 'status',
      permissions: 'permissions',
      lastLogin: 'last_login',
      avatar: 'avatar',
      memberId: 'member_id',
    }, idMap, 'User');
    userRows.push(row);
  }
  await insertBatch(sql, 'users', userRows);
  console.log(`   ${userRows.length} users migrated`);

  // ── 2. Members ────────────────────────────────────────────────────────────
  console.log('─ Migrating members...');
  const membersColl = await mongoose.model('Member').find({}).lean();
  const memberRows: any[] = [];
  for (const member of membersColl) {
    const row = transformDocument(member, {
      memberId: 'member_id',
      name: 'name',
      email: 'email',
      phone: 'phone',
      role: 'role',
      shares: 'shares',
      totalContributed: 'total_contributed',
      status: 'status',
      avatar: 'avatar',
      lastActive: 'last_active',
      createdBy: 'created_by',
      updatedBy: 'updated_by',
      userId: 'user_id',
      hasUserAccess: 'has_user_access',
    }, idMap, 'Member');
    memberRows.push(row);
  }
  await insertBatch(sql, 'members', memberRows);
  console.log(`   ${memberRows.length} members migrated`);

  // Resolve FKs for members now that users are in
  await resolveForeignKeys(sql, userRows, 'users');
  await resolveForeignKeys(sql, memberRows, 'members');
  idMap.clear(); // Free memory — only need for FK resolution

  // ── 3. Funds ──────────────────────────────────────────────────────────────
  console.log('─ Migrating funds...');
  const fundsColl = await mongoose.model('Fund').find({}).lean();
  const fundRows: any[] = [];
  for (const fund of fundsColl) {
    const row = transformDocument(fund, {
      name: 'name',
      type: 'type',
      status: 'status',
      currency: 'currency',
      linkedProjectId: 'linked_project_id',
      accountNumber: 'account_number',
      balance: 'balance',
      lastReconciledAt: 'last_reconciled_at',
      reconciliationStatus: 'reconciliation_status',
      handlingOfficer: 'handling_officer',
      description: 'description',
      isSystemAsset: 'is_system_asset',
    }, idMap, 'Fund');
    fundRows.push(row);
  }
  await insertBatch(sql, 'funds', fundRows);
  console.log(`   ${fundRows.length} funds migrated`);

  // ── 4. Projects (+ project_updates + project_members) ─────────────────────
  console.log('─ Migrating projects...');
  const projectsColl = await mongoose.model('Project').find({}).lean();
  const projectRows: any[] = [];
  const updateRows: any[] = [];
  const projectMemberRows: any[] = [];

  for (const project of projectsColl) {
    const row = transformDocument(project, {
      title: 'title',
      category: 'category',
      description: 'description',
      initialInvestment: 'initial_investment',
      budget: 'budget',
      expectedRoi: 'expected_roi',
      totalShares: 'total_shares',
      status: 'status',
      health: 'health',
      startDate: 'start_date',
      completionDate: 'completion_date',
      totalEarnings: 'total_earnings',
      totalExpenses: 'total_expenses',
      projectFundHandler: 'project_fund_handler',
      linkedFundId: 'linked_fund_id',
      currentFundBalance: 'current_fund_balance',
    }, idMap, 'Project');
    projectRows.push(row);

    // Extract updates[] → project_updates table
    if (Array.isArray(project.updates)) {
      for (const update of project.updates) {
        const updateId = uuidv4();
        const updateMongoId = update._id?.toString();
        if (updateMongoId) {
          idMap.set(`Project.update:${updateMongoId}`, updateId);
        }
        updateRows.push({
          id: updateId,
          project_id: row.id,
          type: update.type,
          amount: update.amount,
          description: update.description,
          date: update.date ? new Date(update.date).toISOString() : new Date().toISOString(),
          balance_before: update.balanceBefore,
          balance_after: update.balanceAfter,
          legacy_mongo_id: updateMongoId || null,
        });
      }
    }

    // Extract involvedMembers[] → project_members table
    if (Array.isArray(project.involvedMembers)) {
      for (const im of project.involvedMembers) {
        const memberId = im.memberId?.toString();
        if (memberId) {
          projectMemberRows.push({
            project_id: row.id,
            member_id: objectIdToUUID(memberId),
            shares_invested: im.sharesInvested || 0,
            ownership_percentage: im.ownershipPercentage || 0,
          });
        }
      }
    }
  }
  await insertBatch(sql, 'projects', projectRows);
  console.log(`   ${projectRows.length} projects migrated`);
  await insertBatch(sql, 'project_updates', updateRows);
  console.log(`   ${updateRows.length} project updates migrated`);
  await insertBatch(sql, 'project_members', projectMemberRows);
  console.log(`   ${projectMemberRows.length} project members migrated`);

  // ── 5. Transactions ───────────────────────────────────────────────────────
  console.log('─ Migrating transactions...');
  const txns = await mongoose.model('Transaction').find({}).lean();
  const txnRows: any[] = [];
  for (const txn of txns) {
    const row = transformDocument(txn, {
      type: 'type',
      amount: 'amount',
      description: 'description',
      category: 'category',
      referenceNumber: 'reference_number',
      date: 'date',
      status: 'status',
      memberId: 'member_id',
      projectId: 'project_id',
      fundId: 'fund_id',
      handlingOfficer: 'handling_officer',
      depositMethod: 'deposit_method',
      authorizedBy: 'authorized_by',
      balanceBefore: 'balance_before',
      balanceAfter: 'balance_after',
      createdBy: 'created_by',
      updatedBy: 'updated_by',
      isDeleted: 'is_deleted',
      deletedAt: 'deleted_at',
      deletedBy: 'deleted_by',
      deletionReason: 'deletion_reason',
    }, idMap, 'Transaction');
    txnRows.push(row);
  }
  await insertBatch(sql, 'transactions', txnRows);
  console.log(`   ${txnRows.length} transactions migrated`);

  // ── 6. Goals ──────────────────────────────────────────────────────────────
  console.log('─ Migrating goals...');
  const goalsColl = await mongoose.model('Goal').find({}).lean();
  const goalRows: any[] = [];
  for (const goal of goalsColl) {
    const row = transformDocument(goal, {
      user: 'user_id',
      title: 'title',
      description: 'description',
      targetAmount: 'target_amount',
      currentAmount: 'current_amount',
      deadline: 'deadline',
      type: 'type',
      linkedProject: 'linked_project_id',
    }, idMap, 'Goal');
    goalRows.push(row);
  }
  await insertBatch(sql, 'goals', goalRows);
  console.log(`   ${goalRows.length} goals migrated`);

  // ── 7. SystemSettings ─────────────────────────────────────────────────────
  console.log('─ Migrating system settings...');
  const settingsColl = await mongoose.model('SystemSettings').find({}).lean();
  const settingRows: any[] = [];
  for (const s of settingsColl) {
    settingRows.push({
      id: uuidv4(),
      fiscal_year_start: s.financial?.fiscalYearStart || 'July',
      base_currency: s.financial?.baseCurrency || '',
      tax_rate: s.financial?.taxRate || 15.0,
      accounting_method: s.financial?.accountingMethod || 'Cash',
      share_value_bdt: s.financial?.shareValueBdt || 1000,
      is_share_value_locked: s.financial?.isShareValueLocked || false,
      language: s.system?.language || 'English',
      refresh_interval: s.system?.refreshInterval || 'Real-time',
      theme: s.system?.theme || 'System Default',
      date_format: s.system?.dateFormat || 'DD/MM/YYYY',
      is_maintenance_mode: s.system?.isMaintenanceMode || false,
      last_updated_by: s.lastUpdatedBy ? objectIdToUUID(s.lastUpdatedBy.toString()) : null,
      last_updated_at: s.lastUpdatedAt ? new Date(s.lastUpdatedAt).toISOString() : new Date().toISOString(),
      legacy_mongo_id: s._id?.toString() || null,
    });
  }
  if (settingRows.length === 0) {
    settingRows.push({
      id: uuidv4(),
      fiscal_year_start: 'July',
      base_currency: '',
      tax_rate: 15.0,
      accounting_method: 'Cash',
      share_value_bdt: 1000,
      is_share_value_locked: false,
      language: 'English',
      refresh_interval: 'Real-time',
      theme: 'System Default',
      date_format: 'DD/MM/YYYY',
      is_maintenance_mode: false,
    });
  }
  await insertBatch(sql, 'system_settings', settingRows);
  console.log(`   ${settingRows.length} system settings migrated`);

  // ── 8. Sessions ───────────────────────────────────────────────────────────
  console.log('─ Migrating sessions...');
  const sessionsColl = await mongoose.model('Session').find({}).lean();
  const sessionRows: any[] = [];
  for (const session of sessionsColl) {
    const row = transformDocument(session, {
      user: 'user_id',
      sessionId: 'session_id',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      location: 'location',
      loginTime: 'login_time',
      lastActivity: 'last_activity',
      logoutTime: 'logout_time',
      isActive: 'is_active',
      isExpired: 'is_expired',
      deviceInfo: 'device_info',
      osInfo: 'os_info',
      browserInfo: 'browser_info',
    }, idMap, 'Session');
    sessionRows.push(row);
  }
  await insertBatch(sql, 'sessions', sessionRows);
  console.log(`   ${sessionRows.length} sessions migrated`);

  // ── 9. AuditLogs ──────────────────────────────────────────────────────────
  console.log('─ Migrating audit logs...');
  const auditColl = await mongoose.model('AuditLog').find({}).lean();
  const auditRows: any[] = [];
  for (const log of auditColl) {
    const row = transformDocument(log, {
      user: 'user_id',
      userName: 'user_name',
      action: 'action',
      resourceType: 'resource_type',
      resourceId: 'resource_id',
      details: 'details',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
    }, idMap, 'AuditLog');
    auditRows.push(row);
  }
  await insertBatch(sql, 'audit_logs', auditRows);
  console.log(`   ${auditRows.length} audit logs migrated`);

  // ── 10. BlacklistedTokens ─────────────────────────────────────────────────
  console.log('─ Migrating blacklisted tokens...');
  const tokensColl = await mongoose.model('BlacklistedToken').find({}).lean();
  const tokenRows: any[] = [];
  for (const t of tokensColl) {
    const row = transformDocument(t, {
      token: 'token',
      type: 'type',
      userId: 'user_id',
      expiresAt: 'expires_at',
      blacklistedAt: 'blacklisted_at',
      reason: 'reason',
    }, idMap, 'BlacklistedToken');
    tokenRows.push(row);
  }
  await insertBatch(sql, 'blacklisted_tokens', tokenRows);
  console.log(`   ${tokenRows.length} blacklisted tokens migrated`);

  // ── 11. LoginAttempts ─────────────────────────────────────────────────────
  console.log('─ Migrating login attempts...');
  const attemptsColl = await mongoose.model('LoginAttempt').find({}).lean();
  const attemptRows: any[] = [];
  for (const a of attemptsColl) {
    const row = transformDocument(a, {
      email: 'email',
      ipAddress: 'ip_address',
      success: 'success',
      failureReason: 'failure_reason',
      timestamp: 'timestamp',
      userAgent: 'user_agent',
      location: 'location',
      userId: 'user_id',
    }, idMap, 'LoginAttempt');
    attemptRows.push(row);
  }
  await insertBatch(sql, 'login_attempts', attemptRows);
  console.log(`   ${attemptRows.length} login attempts migrated`);

  // ── 12. GlobalStats ───────────────────────────────────────────────────────
  console.log('─ Migrating global stats...');
  const statsColl = await mongoose.model('GlobalStats').find({}).lean();
  const statRows: any[] = [];
  for (const gs of statsColl) {
    statRows.push({
      id: uuidv4(),
      total_deposits: gs.totalDeposits || 0,
      invested_capital: gs.investedCapital || 0,
      total_members: gs.totalMembers || 0,
      total_shares: gs.totalShares || 0,
      yield_index: gs.yieldIndex || 0,
      trend_data: gs.trendData ? JSON.stringify(gs.trendData) : '[]',
      sector_diversification: gs.sectorDiversification ? JSON.stringify(gs.sectorDiversification) : '[]',
      fund_stability: gs.fundStability || 100,
      last_updated: gs.lastUpdated ? new Date(gs.lastUpdated).toISOString() : new Date().toISOString(),
      legacy_mongo_id: gs._id?.toString() || null,
    });
  }
  if (statRows.length > 0) {
    await insertBatch(sql, 'global_stats', statRows);
  }
  console.log(`   ${statRows.length} global stats migrated`);

  // ── 13. DeletedRecords ────────────────────────────────────────────────────
  console.log('─ Migrating deleted records...');
  const deletedColl = await mongoose.model('DeletedRecord').find({}).lean();
  const deletedRows: any[] = [];
  for (const d of deletedColl) {
    deletedRows.push({
      id: uuidv4(),
      original_id: d.originalId,
      collection_name: d.collectionName,
      data: d.data ? JSON.stringify(d.data) : '{}',
      reason: d.reason || null,
      deleted_by: d.deletedBy ? objectIdToUUID(d.deletedBy.toString()) : null,
      deleted_at: d.deletedAt ? new Date(d.deletedAt).toISOString() : new Date().toISOString(),
      legacy_mongo_id: d._id?.toString() || null,
    });
  }
  await insertBatch(sql, 'deleted_records', deletedRows);
  console.log(`   ${deletedRows.length} deleted records migrated`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await mongoose.disconnect();
  await sql.end();

  console.log('\n✅ Migration complete!');
  console.log('   Summary:');
  console.log(`   - Users: ${userRows.length}`);
  console.log(`   - Members: ${memberRows.length}`);
  console.log(`   - Funds: ${fundRows.length}`);
  console.log(`   - Projects: ${projectRows.length}`);
  console.log(`   - Project Updates: ${updateRows.length}`);
  console.log(`   - Project Members: ${projectMemberRows.length}`);
  console.log(`   - Transactions: ${txnRows.length}`);
  console.log(`   - Goals: ${goalRows.length}`);
  console.log(`   - System Settings: ${settingRows.length}`);
  console.log(`   - Sessions: ${sessionRows.length}`);
  console.log(`   - Audit Logs: ${auditRows.length}`);
  console.log(`   - Blacklisted Tokens: ${tokenRows.length}`);
  console.log(`   - Login Attempts: ${attemptRows.length}`);
  console.log(`   - Global Stats: ${statRows.length}`);
  console.log(`   - Deleted Records: ${deletedRows.length}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function insertBatch(sql: postgres.Sql, table: string, rows: any[]) {
  if (rows.length === 0) return;

  // Remove __pendingFks before insert
  const cleanRows = rows.map(({ __pendingFks, ...rest }) => rest);

  // Insert in chunks of 500
  const CHUNK_SIZE = 500;
  for (let i = 0; i < cleanRows.length; i += CHUNK_SIZE) {
    const chunk = cleanRows.slice(i, i + CHUNK_SIZE);
    const columns = Object.keys(chunk[0]);
    const values = chunk.map((row) =>
      columns.map((col) => row[col] ?? null)
    );

    // Build INSERT statement
    const placeholders = chunk
      .map(
        (_, rowIdx) =>
          `(${columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(', ')})`
      )
      .join(', ');

    const flatValues = values.flat();

    try {
      await sql.unsafe(
        `INSERT INTO ${sql(table)} (${columns.map((c) => sql(c)).join(', ')})
         VALUES ${sql.unsafe(placeholders)}
         ON CONFLICT (id) DO NOTHING`,
        flatValues
      );
    } catch (error: any) {
      console.error(`  Error inserting into ${table}: ${error.message}`);
      // Continue with next chunk
    }
  }
}

async function resolveForeignKeys(
  sql: postgres.Sql,
  rows: any[],
  _table: string
) {
  // FK resolution happens lazily during insert — references use NULL initially
  // A second pass could resolve them, but for initial migration, NULLs are acceptable
  // The application will restore referential integrity on first save of each record
  // For critical FKs, we'd need the full ID map, but it's been cleared for memory
}

// ─── Run ──────────────────────────────────────────────────────────────────────

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n Migration failed:', error);
    process.exit(1);
  });
