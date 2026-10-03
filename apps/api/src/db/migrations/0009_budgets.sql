CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"month" text,
	"amount" bigint NOT NULL,
	"rollover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "budgets_amount_check" CHECK ("budgets"."amount" >= 0),
	CONSTRAINT "budgets_month_check" CHECK ("budgets"."month" is null or "budgets"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budgets_space_idx" ON "budgets" USING btree ("space_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_month_uq" ON "budgets" USING btree ("space_id","category_id",coalesce("month", '')) WHERE "budgets"."deleted_at" is null;