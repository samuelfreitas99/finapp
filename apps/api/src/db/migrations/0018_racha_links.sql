CREATE TABLE "split_expense_postings" (
	"expense_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	CONSTRAINT "split_expense_postings_expense_id_user_id_pk" PRIMARY KEY("expense_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "split_group_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "split_expense_postings" ADD CONSTRAINT "split_expense_postings_expense_id_split_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."split_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expense_postings" ADD CONSTRAINT "split_expense_postings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_expense_postings" ADD CONSTRAINT "split_expense_postings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_group_links" ADD CONSTRAINT "split_group_links_group_id_split_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."split_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_group_links" ADD CONSTRAINT "split_group_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_group_links" ADD CONSTRAINT "split_group_links_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_group_links" ADD CONSTRAINT "split_group_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split_group_links" ADD CONSTRAINT "split_group_links_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "split_group_links_group_user_uq" ON "split_group_links" USING btree ("group_id","user_id");