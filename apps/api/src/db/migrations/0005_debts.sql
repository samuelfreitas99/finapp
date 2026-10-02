CREATE TABLE "debt_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"debt_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" bigint,
	"date" date NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "debt_events_type_check" CHECK ("debt_events"."type" in ('amortization', 'payoff', 'index_correction', 'completion_date_change'))
);
--> statement-breakpoint
CREATE TABLE "debt_installments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"debt_id" uuid NOT NULL,
	"phase_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"principal_part" bigint DEFAULT 0 NOT NULL,
	"interest_part" bigint DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	"paid_date" date,
	"discount" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transaction_id" uuid,
	CONSTRAINT "debt_installments_status_check" CHECK ("debt_installments"."status" in ('pending', 'paid', 'late', 'partial')),
	CONSTRAINT "debt_installments_amount_check" CHECK ("debt_installments"."amount" >= 0),
	CONSTRAINT "debt_installments_parts_check" CHECK ("debt_installments"."principal_part" >= 0 and "debt_installments"."interest_part" >= 0),
	CONSTRAINT "debt_installments_paid_check" CHECK ("debt_installments"."paid_amount" >= 0 and "debt_installments"."discount" >= 0),
	CONSTRAINT "debt_installments_number_check" CHECK ("debt_installments"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "debt_phases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"debt_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"system" text NOT NULL,
	"principal" bigint,
	"rate_monthly" numeric(16, 12) DEFAULT 0 NOT NULL,
	"index" text DEFAULT 'none' NOT NULL,
	"installments" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"installment_amount" bigint,
	"ends_at_completion" boolean DEFAULT false NOT NULL,
	"starts_after_completion" boolean DEFAULT false NOT NULL,
	CONSTRAINT "debt_phases_position_uq" UNIQUE("debt_id","position"),
	CONSTRAINT "debt_phases_system_check" CHECK ("debt_phases"."system" in ('fixed', 'price', 'sac', 'variable', 'balloon')),
	CONSTRAINT "debt_phases_index_check" CHECK ("debt_phases"."index" in ('none', 'incc', 'ipca', 'igpm')),
	CONSTRAINT "debt_phases_rate_check" CHECK ("debt_phases"."rate_monthly" >= 0 and "debt_phases"."rate_monthly" < 1),
	CONSTRAINT "debt_phases_installments_check" CHECK ("debt_phases"."installments" is null or "debt_phases"."installments" between 1 and 600),
	CONSTRAINT "debt_phases_principal_check" CHECK ("debt_phases"."principal" is null or "debt_phases"."principal" >= 0),
	CONSTRAINT "debt_phases_dates_check" CHECK ("debt_phases"."end_date" is null or "debt_phases"."end_date" >= "debt_phases"."start_date")
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"contact_id" uuid,
	"institution" text,
	"principal" bigint DEFAULT 0 NOT NULL,
	"payment_account_id" uuid,
	"payment_card_id" uuid,
	"completion_date" date,
	"asset_value" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	CONSTRAINT "debts_direction_check" CHECK ("debts"."direction" in ('i_owe', 'owed_to_me')),
	CONSTRAINT "debts_kind_check" CHECK ("debts"."kind" in ('bank_loan', 'card_loan', 'personal_loan', 'third_party_card', 'financing', 'agreement', 'consortium', 'property', 'other')),
	CONSTRAINT "debts_status_check" CHECK ("debts"."status" in ('active', 'paid_off', 'cancelled')),
	CONSTRAINT "debts_principal_check" CHECK ("debts"."principal" >= 0),
	CONSTRAINT "debts_asset_value_check" CHECK ("debts"."asset_value" is null or "debts"."asset_value" >= 0),
	CONSTRAINT "debts_account_or_card" CHECK ("debts"."payment_account_id" is null or "debts"."payment_card_id" is null)
);
--> statement-breakpoint
CREATE TABLE "index_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"index" text NOT NULL,
	"month" text NOT NULL,
	"value" numeric(12, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "index_values_index_month_uq" UNIQUE("index","month"),
	CONSTRAINT "index_values_index_check" CHECK ("index_values"."index" in ('incc', 'ipca', 'igpm')),
	CONSTRAINT "index_values_month_check" CHECK ("index_values"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "index_values_value_check" CHECK ("index_values"."value" > -1 and "index_values"."value" < 1)
);
--> statement-breakpoint
ALTER TABLE "debt_events" ADD CONSTRAINT "debt_events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_events" ADD CONSTRAINT "debt_events_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_events" ADD CONSTRAINT "debt_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_installments" ADD CONSTRAINT "debt_installments_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_installments" ADD CONSTRAINT "debt_installments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_installments" ADD CONSTRAINT "debt_installments_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_installments" ADD CONSTRAINT "debt_installments_phase_id_debt_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."debt_phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_installments" ADD CONSTRAINT "debt_installments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_phases" ADD CONSTRAINT "debt_phases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_phases" ADD CONSTRAINT "debt_phases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_phases" ADD CONSTRAINT "debt_phases_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_payment_card_id_credit_cards_id_fk" FOREIGN KEY ("payment_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_values" ADD CONSTRAINT "index_values_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debt_events_debt_idx" ON "debt_events" USING btree ("debt_id","date");--> statement-breakpoint
CREATE INDEX "debt_installments_debt_due_idx" ON "debt_installments" USING btree ("debt_id","due_date");--> statement-breakpoint
CREATE INDEX "debt_installments_space_due_idx" ON "debt_installments" USING btree ("space_id","due_date");--> statement-breakpoint
CREATE INDEX "debts_space_idx" ON "debts" USING btree ("space_id","deleted_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_debt_installment_id_debt_installments_id_fk" FOREIGN KEY ("debt_installment_id") REFERENCES "public"."debt_installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_debt_installment_idx" ON "transactions" USING btree ("debt_installment_id");