CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "import_key" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_rules_space_idx" ON "category_rules" USING btree ("space_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_space_pattern_uq" ON "category_rules" USING btree ("space_id","pattern") WHERE "category_rules"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_import_key_uq" ON "transactions" USING btree ("account_id","import_key");