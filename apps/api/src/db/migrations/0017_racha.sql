CREATE TABLE "split_expense_payers" (
	"expense_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "split_expense_payers_expense_id_participant_id_pk" PRIMARY KEY("expense_id","participant_id"),
	CONSTRAINT "split_expense_payers_amount_check" CHECK ("split_expense_payers"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "split_expense_shares" (
	"expense_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"weight" integer,
	CONSTRAINT "split_expense_shares_expense_id_participant_id_pk" PRIMARY KEY("expense_id","participant_id"),
	CONSTRAINT "split_expense_shares_amount_check" CHECK ("split_expense_shares"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "split_expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"split_mode" text NOT NULL,
	"category" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "split_expenses_amount_check" CHECK ("split_expenses"."amount" > 0),
	CONSTRAINT "split_expenses_mode_check" CHECK ("split_expenses"."split_mode" in ('equal', 'percent', 'amount', 'shares'))
);
--> statement-breakpoint
CREATE TABLE "split_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"join_code" text NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "split_groups_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "split_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"from_participant_id" uuid NOT NULL,
	"to_participant_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"method" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "split_settlements_amount_check" CHECK ("split_settlements"."amount" > 0),
	CONSTRAINT "split_settlements_parties_check" CHECK ("split_settlements"."from_participant_id" <> "split_settlements"."to_participant_id")
);
--> statement-breakpoint
ALTER TABLE "split_expense_payers" ADD CONSTRAINT "split_expense_payers_expense_id_split_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."split_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expense_payers" ADD CONSTRAINT "split_expense_payers_participant_id_split_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."split_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expense_shares" ADD CONSTRAINT "split_expense_shares_expense_id_split_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."split_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expense_shares" ADD CONSTRAINT "split_expense_shares_participant_id_split_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."split_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expenses" ADD CONSTRAINT "split_expenses_group_id_split_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."split_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expenses" ADD CONSTRAINT "split_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_groups" ADD CONSTRAINT "split_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_participants" ADD CONSTRAINT "split_participants_group_id_split_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."split_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_participants" ADD CONSTRAINT "split_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_group_id_split_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."split_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_from_participant_id_split_participants_id_fk" FOREIGN KEY ("from_participant_id") REFERENCES "public"."split_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_to_participant_id_split_participants_id_fk" FOREIGN KEY ("to_participant_id") REFERENCES "public"."split_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_settlements" ADD CONSTRAINT "split_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "split_expenses_group_idx" ON "split_expenses" USING btree ("group_id","deleted_at");--> statement-breakpoint
CREATE INDEX "split_groups_created_by_idx" ON "split_groups" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "split_participants_group_idx" ON "split_participants" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "split_participants_user_idx" ON "split_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "split_participants_group_user_uq" ON "split_participants" USING btree ("group_id","user_id") WHERE "split_participants"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "split_settlements_group_idx" ON "split_settlements" USING btree ("group_id","deleted_at");