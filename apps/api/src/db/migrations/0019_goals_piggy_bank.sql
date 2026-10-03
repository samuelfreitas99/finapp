CREATE TABLE "goal_deposits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "goal_deposits_amount_check" CHECK ("goal_deposits"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_saved_check";--> statement-breakpoint
ALTER TABLE "goal_deposits" ADD CONSTRAINT "goal_deposits_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_deposits" ADD CONSTRAINT "goal_deposits_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_deposits" ADD CONSTRAINT "goal_deposits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_deposits_goal_idx" ON "goal_deposits" USING btree ("goal_id","deleted_at");--> statement-breakpoint
-- Metas já existentes: o valor marcado à mão vira o primeiro aporte ("Valor inicial").
INSERT INTO "goal_deposits" ("id", "space_id", "goal_id", "amount", "date", "note", "created_by")
SELECT gen_random_uuid(), "space_id", "id", "saved_amount_manual", CURRENT_DATE, 'Valor inicial', "created_by"
FROM "goals" WHERE "saved_amount_manual" > 0;--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "saved_amount_manual";