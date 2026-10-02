CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"brand" text,
	"limit_amount" bigint NOT NULL,
	"closing_day" integer NOT NULL,
	"due_day" integer NOT NULL,
	"closing_day_goes_to_next" boolean DEFAULT true NOT NULL,
	"payment_account_id" uuid,
	"color" text,
	"archived_at" timestamp with time zone,
	"parent_card_id" uuid,
	CONSTRAINT "credit_cards_brand_check" CHECK ("credit_cards"."brand" is null or "credit_cards"."brand" in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'other')),
	CONSTRAINT "credit_cards_limit_check" CHECK ("credit_cards"."limit_amount" >= 0),
	CONSTRAINT "credit_cards_closing_day_check" CHECK ("credit_cards"."closing_day" between 1 and 31),
	CONSTRAINT "credit_cards_due_day_check" CHECK ("credit_cards"."due_day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"description" text NOT NULL,
	"total_amount" bigint NOT NULL,
	"installments" integer NOT NULL,
	"first_date" date NOT NULL,
	"first_due_date" date,
	"card_id" uuid,
	"account_id" uuid,
	"category_id" uuid,
	"interest_amount" bigint DEFAULT 0 NOT NULL,
	"start_installment" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "installment_plans_status_check" CHECK ("installment_plans"."status" in ('active', 'finished', 'cancelled')),
	CONSTRAINT "installment_plans_total_check" CHECK ("installment_plans"."total_amount" > 0),
	CONSTRAINT "installment_plans_installments_check" CHECK ("installment_plans"."installments" between 1 and 420),
	CONSTRAINT "installment_plans_start_check" CHECK ("installment_plans"."start_installment" between 1 and "installment_plans"."installments"),
	CONSTRAINT "installment_plans_card_xor_account" CHECK (("installment_plans"."card_id" is null) <> ("installment_plans"."account_id" is null)),
	CONSTRAINT "installment_plans_interest_check" CHECK ("installment_plans"."interest_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"transaction_id" uuid,
	CONSTRAINT "invoice_payments_amount_check" CHECK ("invoice_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"card_id" uuid NOT NULL,
	"reference_month" text NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"closing_date_override" date,
	"due_date_override" date,
	"status" text DEFAULT 'open' NOT NULL,
	"carried_balance" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "invoices_card_month_uq" UNIQUE("card_id","reference_month"),
	CONSTRAINT "invoices_reference_month_check" CHECK ("invoices"."reference_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('open', 'closed', 'paid', 'partial', 'overdue')),
	CONSTRAINT "invoices_dates_check" CHECK ("invoices"."closing_date" <= "invoices"."due_date")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "anticipated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_parent_card_id_credit_cards_id_fk" FOREIGN KEY ("parent_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_cards_space_idx" ON "credit_cards" USING btree ("space_id","deleted_at");--> statement-breakpoint
CREATE INDEX "installment_plans_space_idx" ON "installment_plans" USING btree ("space_id","deleted_at");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_space_due_idx" ON "invoices" USING btree ("space_id","due_date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_plan_id_installment_plans_id_fk" FOREIGN KEY ("installment_plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_payment_id_invoice_payments_id_fk" FOREIGN KEY ("invoice_payment_id") REFERENCES "public"."invoice_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_card_idx" ON "transactions" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "transactions_installment_plan_idx" ON "transactions" USING btree ("installment_plan_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_check" CHECK (("transactions"."installment_plan_id" is null) = ("transactions"."installment_number" is null));