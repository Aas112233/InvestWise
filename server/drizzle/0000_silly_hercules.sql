CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_name" varchar(255),
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100),
	"resource_id" varchar(255),
	"details" jsonb,
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"status" varchar(20) DEFAULT 'SUCCESS',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blacklisted_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"type" varchar(20) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reason" varchar(50) DEFAULT 'logout',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deleted_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_id" varchar(255) NOT NULL,
	"collection_name" varchar(100) NOT NULL,
	"data" jsonb NOT NULL,
	"reason" varchar(500),
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" varchar(50) DEFAULT 'OPEN',
	"total_deposits" numeric(15, 2) DEFAULT '0',
	"total_withdrawals" numeric(15, 2) DEFAULT '0',
	"total_earnings" numeric(15, 2) DEFAULT '0',
	"total_expenses" numeric(15, 2) DEFAULT '0',
	"net_surplus" numeric(15, 2) DEFAULT '0',
	"statutory_reserve" numeric(15, 2) DEFAULT '0',
	"distributable_surplus" numeric(15, 2) DEFAULT '0',
	"actual_distributed" numeric(15, 2) DEFAULT '0',
	"retained_earnings" numeric(15, 2) DEFAULT '0',
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"notes" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) DEFAULT 'OTHER',
	"status" varchar(50) DEFAULT 'ACTIVE',
	"currency" varchar(10) DEFAULT '',
	"linked_project_id" uuid,
	"account_number" varchar(255),
	"balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"reconciliation_status" varchar(50) DEFAULT 'PENDING',
	"handling_officer" varchar(255),
	"description" text,
	"is_system_asset" boolean DEFAULT false,
	"minimum_balance" numeric(15, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "funds_account_number_unique" UNIQUE("account_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "global_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"total_deposits" numeric(15, 2) DEFAULT '0',
	"invested_capital" numeric(15, 2) DEFAULT '0',
	"total_members" integer DEFAULT 0,
	"total_shares" integer DEFAULT 0,
	"yield_index" numeric(10, 2) DEFAULT '0',
	"fund_stability" numeric(5, 2) DEFAULT '100',
	"last_updated" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "global_stats_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"global_stats_id" uuid NOT NULL,
	"category" varchar(255) NOT NULL,
	"value" numeric(15, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "global_stats_trends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"global_stats_id" uuid NOT NULL,
	"month" varchar(50) NOT NULL,
	"inflow" numeric(15, 2) DEFAULT '0',
	"outflow" numeric(15, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"target_amount" numeric(15, 2) NOT NULL,
	"current_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"deadline" date,
	"status" varchar(50) DEFAULT 'In Progress' NOT NULL,
	"type" varchar(50) DEFAULT 'Other' NOT NULL,
	"linked_project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"ip_address" varchar(45) NOT NULL,
	"success" boolean NOT NULL,
	"failure_reason" varchar(50),
	"timestamp" timestamp with time zone DEFAULT now(),
	"user_agent" text,
	"location_country" varchar(255),
	"location_city" varchar(255),
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_arrears" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"period_key" varchar(7) NOT NULL,
	"required_amount" numeric(15, 2) NOT NULL,
	"actual_deposited" numeric(15, 2) DEFAULT '0',
	"shortfall" numeric(15, 2) NOT NULL,
	"status" varchar(50) DEFAULT 'OUTSTANDING',
	"waived_by" uuid,
	"waived_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"role" varchar(50) DEFAULT 'Member',
	"shares" integer DEFAULT 0 NOT NULL,
	"total_contributed" numeric(15, 2) DEFAULT '0',
	"status" varchar(50) DEFAULT 'active',
	"avatar" varchar,
	"last_active" timestamp with time zone DEFAULT now(),
	"monthly_deposit_target" numeric(15, 2) DEFAULT '0',
	"deposit_frequency" varchar(20) DEFAULT 'monthly',
	"join_date" timestamp with time zone DEFAULT now(),
	"last_deposit_month" varchar(7),
	"total_arrears" numeric(15, 2) DEFAULT '0',
	"withdrawal_requests" integer DEFAULT 0,
	"created_by" uuid,
	"updated_by" uuid,
	"user_id" uuid,
	"has_user_access" boolean DEFAULT false,
	"nid_or_passport" varchar(100),
	"father_name" varchar(255),
	"address" varchar(500),
	"nominee_name" varchar(255),
	"nominee_relation" varchar(100),
	"nominee_nid_or_passport" varchar(100),
	"nominee_phone" varchar(50),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "members_member_id_unique" UNIQUE("member_id"),
	CONSTRAINT "members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profit_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fiscal_period_id" uuid,
	"member_id" uuid NOT NULL,
	"allocation_type" varchar(50) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"shares_at_time" integer NOT NULL,
	"rate_per_share" numeric(15, 6) NOT NULL,
	"notes" varchar(500),
	"allocated_by" uuid,
	"allocated_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_members" (
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"shares_invested" integer DEFAULT 0,
	"ownership_percentage" numeric(5, 2) DEFAULT '0',
	CONSTRAINT "project_members_project_id_member_id_pk" PRIMARY KEY("project_id","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" varchar(500) NOT NULL,
	"date" timestamp with time zone DEFAULT now(),
	"balance_before" numeric(15, 2),
	"balance_after" numeric(15, 2),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"category" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"initial_investment" numeric(15, 2) DEFAULT '0' NOT NULL,
	"budget" numeric(15, 2) DEFAULT '0' NOT NULL,
	"expected_roi" numeric(5, 2) DEFAULT '0',
	"total_shares" integer DEFAULT 0 NOT NULL,
	"status" varchar(50) DEFAULT 'In Progress' NOT NULL,
	"health" varchar(50) DEFAULT 'Stable' NOT NULL,
	"start_date" date NOT NULL,
	"completion_date" date,
	"total_earnings" numeric(15, 2) DEFAULT '0',
	"total_expenses" numeric(15, 2) DEFAULT '0',
	"project_fund_handler" varchar(255),
	"linked_fund_id" uuid,
	"current_fund_balance" numeric(15, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"ip_address" varchar(50) NOT NULL,
	"user_agent" varchar(500) NOT NULL,
	"location_country" varchar(100) DEFAULT 'Unknown',
	"location_city" varchar(100) DEFAULT 'Unknown',
	"location_region" varchar(100) DEFAULT 'Unknown',
	"login_time" timestamp with time zone DEFAULT now(),
	"last_activity" timestamp with time zone DEFAULT now(),
	"logout_time" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"is_expired" boolean DEFAULT false,
	"device_info" varchar(100) DEFAULT 'Unknown',
	"os_info" varchar(100) DEFAULT 'Unknown',
	"browser_info" varchar(100) DEFAULT 'Unknown',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fiscal_year_start" varchar(50) DEFAULT 'July',
	"fiscal_year_end" varchar(50) DEFAULT 'June',
	"base_currency" varchar(10) DEFAULT '',
	"tax_rate" numeric(5, 2) DEFAULT '15.0',
	"accounting_method" varchar(50) DEFAULT 'Cash',
	"share_value_bdt" numeric(15, 2) DEFAULT '1000',
	"is_share_value_locked" boolean DEFAULT false,
	"withdrawal_limit_percent" numeric(5, 2) DEFAULT '25',
	"withdrawal_notice_days" integer DEFAULT 30,
	"max_withdrawal_per_request" numeric(15, 2) DEFAULT '100000',
	"statutory_reserve_percent" numeric(5, 2) DEFAULT '10',
	"last_fiscal_close_date" timestamp with time zone,
	"language" varchar(50) DEFAULT 'English',
	"refresh_interval" varchar(50) DEFAULT 'Real-time',
	"theme" varchar(50) DEFAULT 'System Default',
	"date_format" varchar(50) DEFAULT 'DD/MM/YYYY',
	"is_maintenance_mode" boolean DEFAULT false,
	"last_updated_by" uuid,
	"last_updated_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" text NOT NULL,
	"category" varchar(100),
	"reference_number" varchar(255),
	"date" timestamp with time zone DEFAULT now(),
	"status" varchar(50) DEFAULT 'Completed',
	"member_id" uuid,
	"project_id" uuid,
	"fund_id" uuid,
	"handling_officer" varchar(255),
	"deposit_method" varchar(50),
	"authorized_by" uuid,
	"balance_before" numeric(15, 2),
	"balance_after" numeric(15, 2),
	"created_by" uuid,
	"updated_by" uuid,
	"is_deleted" boolean DEFAULT false,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deletion_reason" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'Member',
	"status" varchar(50) DEFAULT 'active',
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"last_login" timestamp with time zone,
	"avatar" varchar,
	"member_id" varchar(50),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blacklisted_tokens" ADD CONSTRAINT "blacklisted_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deleted_records" ADD CONSTRAINT "deleted_records_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "global_stats_sectors" ADD CONSTRAINT "global_stats_sectors_global_stats_id_global_stats_id_fk" FOREIGN KEY ("global_stats_id") REFERENCES "public"."global_stats"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "global_stats_trends" ADD CONSTRAINT "global_stats_trends_global_stats_id_global_stats_id_fk" FOREIGN KEY ("global_stats_id") REFERENCES "public"."global_stats"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_arrears" ADD CONSTRAINT "member_arrears_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_arrears" ADD CONSTRAINT "member_arrears_waived_by_members_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_allocated_by_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_members" ADD CONSTRAINT "project_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_last_updated_by_users_id_fk" FOREIGN KEY ("last_updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action_resource_created" ON "audit_logs" USING btree ("action","resource_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created_at" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user_id" ON "audit_logs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_logs_resource" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blacklisted_tokens_expires_at" ON "blacklisted_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blacklisted_tokens_user_id" ON "blacklisted_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deleted_records_collection" ON "deleted_records" USING btree ("collection_name","deleted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deleted_records_original" ON "deleted_records" USING btree ("collection_name","original_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fiscal_year" ON "fiscal_periods" USING btree ("year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fiscal_status" ON "fiscal_periods" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_funds_type_status" ON "funds" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_funds_linked_project" ON "funds" USING btree ("linked_project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_funds_type" ON "funds" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stats_sectors_stats_id" ON "global_stats_sectors" USING btree ("global_stats_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stats_trends_stats_id" ON "global_stats_trends" USING btree ("global_stats_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stats_trends_month" ON "global_stats_trends" USING btree ("month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_goals_user_status" ON "goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_goals_status_deadline" ON "goals" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_goals_type" ON "goals" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_attempts_email_timestamp" ON "login_attempts" USING btree ("email","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_login_attempts_ip_timestamp" ON "login_attempts" USING btree ("ip_address","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arrears_member_period" ON "member_arrears" USING btree ("member_id","period_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arrears_status" ON "member_arrears" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_members_status_name" ON "members" USING btree ("status","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_members_email_status" ON "members" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_members_name" ON "members" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_members_user_id" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_members_role_status" ON "members" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_members_created_at" ON "members" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_allocation_period" ON "profit_allocations" USING btree ("fiscal_period_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_allocation_member" ON "profit_allocations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_allocation_type" ON "profit_allocations" USING btree ("allocation_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_members_member" ON "project_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_updates_project" ON "project_updates" USING btree ("project_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_status_created" ON "projects" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_category_status" ON "projects" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_created" ON "projects" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_linked_fund" ON "projects" USING btree ("linked_fund_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_search" ON "projects" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("category", '')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_user_active" ON "sessions" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_session_active" ON "sessions" USING btree ("session_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_logout_time" ON "sessions" USING btree ("logout_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_last_activity" ON "sessions" USING btree ("last_activity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trans_member_type_status_deleted_date" ON "transactions" USING btree ("member_id","type","status","is_deleted","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trans_fund_type_status_deleted_date" ON "transactions" USING btree ("fund_id","type","status","is_deleted","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trans_project_type_status_deleted_date" ON "transactions" USING btree ("project_id","type","status","is_deleted","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trans_type_status_deleted_date" ON "transactions" USING btree ("type","status","is_deleted","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trans_member_fund_type_date" ON "transactions" USING btree ("member_id","fund_id","type","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trans_date_status" ON "transactions" USING btree ("date" DESC NULLS LAST,"status","is_deleted");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_role_status" ON "users" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_member_id" ON "users" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_created_at" ON "users" USING btree ("created_at");