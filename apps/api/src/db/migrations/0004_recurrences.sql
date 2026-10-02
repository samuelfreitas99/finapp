CREATE TABLE "recurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"day_rule" jsonb,
	"adjust" text DEFAULT 'none' NOT NULL,
	"parts" jsonb,
	"start_date" date NOT NULL,
	"end_date" date,
	"account_id" uuid,
	"card_id" uuid,
	"category_id" uuid,
	"payment_method" text,
	"variable_amount" boolean DEFAULT false NOT NULL,
	"generated_until" date,
	CONSTRAINT "recurrences_type_check" CHECK ("recurrences"."type" in ('income', 'expense')),
	CONSTRAINT "recurrences_frequency_check" CHECK ("recurrences"."frequency" in ('monthly', 'weekly', 'yearly', 'every_n_months')),
	CONSTRAINT "recurrences_adjust_check" CHECK ("recurrences"."adjust" in ('none', 'previous', 'next')),
	CONSTRAINT "recurrences_payment_method_check" CHECK ("recurrences"."payment_method" is null or "recurrences"."payment_method" in ('pix', 'debit', 'credit', 'cash', 'boleto', 'ted', 'other')),
	CONSTRAINT "recurrences_amount_check" CHECK ("recurrences"."amount" > 0),
	CONSTRAINT "recurrences_interval_check" CHECK ("recurrences"."interval" between 1 and 120),
	CONSTRAINT "recurrences_dates_check" CHECK ("recurrences"."end_date" is null or "recurrences"."end_date" >= "recurrences"."start_date"),
	CONSTRAINT "recurrences_account_xor_card" CHECK (("recurrences"."account_id" is null) <> ("recurrences"."card_id" is null)),
	CONSTRAINT "recurrences_rule_check" CHECK ("recurrences"."day_rule" is not null or "recurrences"."parts" is not null or "recurrences"."frequency" = 'weekly')
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurrence_key" text;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurrences_space_idx" ON "recurrences" USING btree ("space_id","deleted_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurrence_id_recurrences_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."recurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_recurrence_key_uq" ON "transactions" USING btree ("recurrence_id","recurrence_key");