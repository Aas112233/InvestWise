-- 0001_multitenant_foundation
-- Multi-tenant SaaS foundation (Pathshala-Pro design port).
-- Re-runnable: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING guarded.
-- Demo data is expendable, but this migration stays additive and non-destructive.

-- ---------------------------------------------------------------- tenants
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"plan" varchar(50) DEFAULT 'standard' NOT NULL,
	"is_maintenance_mode" boolean DEFAULT false NOT NULL,
	"max_users" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
CREATE INDEX IF NOT EXISTS "idx_tenants_status" ON "tenants" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_tenants_slug" ON "tenants" USING btree ("slug");

-- ------------------------------------------------------- billing (lean)
CREATE TABLE IF NOT EXISTS "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"price_monthly" numeric(15, 2) DEFAULT '0',
	"max_users" integer DEFAULT 100,
	"features" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "subscription_plans_slug_unique" UNIQUE("slug")
);
CREATE INDEX IF NOT EXISTS "idx_subscription_plans_slug" ON "subscription_plans" USING btree ("slug");

CREATE TABLE IF NOT EXISTS "tenant_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid,
	"status" varchar(50) DEFAULT 'trial' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_tenant_subscriptions_tenant" UNIQUE("tenant_id")
);
CREATE INDEX IF NOT EXISTS "idx_tenant_subscriptions_status" ON "tenant_subscriptions" USING btree ("status");

CREATE TABLE IF NOT EXISTS "subscription_change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_email" varchar(255),
	"action" varchar(100) NOT NULL,
	"from_plan_id" uuid,
	"to_plan_id" uuid,
	"from_status" varchar(50),
	"to_status" varchar(50),
	"reason" varchar(500),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_subscription_change_log_tenant" ON "subscription_change_log" USING btree ("tenant_id","created_at" DESC NULLS LAST);

-- ------------------------------------------- platform audit (survives tenant wipe)
CREATE TABLE IF NOT EXISTS "super_admin_action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"admin_email" varchar(255) NOT NULL,
	"action_type" varchar(100) NOT NULL,
	"target_type" varchar(100),
	"target_id" varchar(255),
	"tenant_id" uuid,
	"details" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_super_admin_log_admin" ON "super_admin_action_log" USING btree ("admin_user_id","created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_super_admin_log_tenant" ON "super_admin_action_log" USING btree ("tenant_id","created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_super_admin_log_action" ON "super_admin_action_log" USING btree ("action_type","created_at" DESC NULLS LAST);

-- ------------------------------------------------- tenant_id columns (fresh DBs too)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "funds" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "meeting_attendees" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "profit_allocations" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "member_arrears" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "member_penalties" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "project_updates" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;

-- ------------------------------------------------- tenant FKs (guarded: no ADD CONSTRAINT IF NOT EXISTS in PG)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'funds_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "funds" ADD CONSTRAINT "funds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meetings_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meeting_attendees_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goals_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profit_allocations_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_arrears_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "member_arrears" ADD CONSTRAINT "member_arrears_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_penalties_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "member_penalties" ADD CONSTRAINT "member_penalties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_periods_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_settings_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_updates_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_subscriptions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_subscriptions_plan_id_subscription_plans_id_fk') THEN
    ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_change_log_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "subscription_change_log" ADD CONSTRAINT "subscription_change_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_change_log_actor_user_id_users_id_fk') THEN
    ALTER TABLE "subscription_change_log" ADD CONSTRAINT "subscription_change_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_change_log_from_plan_id_subscription_plans_id_fk') THEN
    ALTER TABLE "subscription_change_log" ADD CONSTRAINT "subscription_change_log_from_plan_id_subscription_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_change_log_to_plan_id_subscription_plans_id_fk') THEN
    ALTER TABLE "subscription_change_log" ADD CONSTRAINT "subscription_change_log_to_plan_id_subscription_plans_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'super_admin_action_log_admin_user_id_users_id_fk') THEN
    ALTER TABLE "super_admin_action_log" ADD CONSTRAINT "super_admin_action_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'super_admin_action_log_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "super_admin_action_log" ADD CONSTRAINT "super_admin_action_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_system_settings_tenant') THEN
    ALTER TABLE "system_settings" ADD CONSTRAINT "uq_system_settings_tenant" UNIQUE("tenant_id");
  END IF;
END $$;

-- ------------------------------------------------- tenant indexes
CREATE INDEX IF NOT EXISTS "idx_meetings_tenant" ON "meetings" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_attendees_tenant" ON "meeting_attendees" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_goals_tenant" ON "goals" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_allocation_tenant" ON "profit_allocations" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_arrears_tenant" ON "member_arrears" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_penalties_tenant" ON "member_penalties" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_fiscal_tenant" ON "fiscal_periods" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_system_settings_tenant" ON "system_settings" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_tenant_created" ON "audit_logs" USING btree ("tenant_id","created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_project_updates_tenant" ON "project_updates" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_users_tenant" ON "users" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_members_tenant" ON "members" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_funds_tenant" ON "funds" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_projects_tenant" ON "projects" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_trans_tenant_date" ON "transactions" USING btree ("tenant_id","date" DESC NULLS LAST);

-- ------------------------------------------------- bootstrap rows
INSERT INTO "tenants" ("slug", "name", "status", "plan", "is_maintenance_mode", "max_users")
VALUES ('default', 'Default Organization', 'active', 'standard', false, 100)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "subscription_plans" ("slug", "name", "price_monthly", "max_users", "features", "is_active")
VALUES
  ('standard', 'Standard', '0', 100, '{"members": true, "funds": true, "reports": true}', true),
  ('premium', 'Premium', '4990', 1000, '{"members": true, "funds": true, "reports": true, "api": true, "priority": true}', true)
ON CONFLICT ("slug") DO NOTHING;

-- ------------------------------------------------- backfill demo rows to default tenant
DO $$
DECLARE default_tenant uuid;
BEGIN
  SELECT id INTO default_tenant FROM "tenants" WHERE slug = 'default' LIMIT 1;
  IF default_tenant IS NULL THEN RETURN; END IF;
  -- Platform operators (access_level 5) keep tenant_id NULL: they bypass
  -- tenant scope and act only through /api/admin.
  UPDATE "users" SET tenant_id = default_tenant WHERE tenant_id IS NULL AND (access_level IS NULL OR access_level < 5);
  UPDATE "members" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "funds" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "projects" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "transactions" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "meetings" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "meeting_attendees" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "goals" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "profit_allocations" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "member_arrears" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "member_penalties" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "fiscal_periods" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "system_settings" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "audit_logs" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE "project_updates" SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  INSERT INTO "tenant_subscriptions" ("tenant_id", "status")
  SELECT default_tenant, 'active' WHERE NOT EXISTS (SELECT 1 FROM "tenant_subscriptions" WHERE tenant_id = default_tenant);
END $$;
