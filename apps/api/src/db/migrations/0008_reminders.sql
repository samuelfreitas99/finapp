CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_at" timestamp with time zone,
	"repeat" text DEFAULT 'none' NOT NULL,
	"done_at" timestamp with time zone,
	"notified_for" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reminders_repeat_check" CHECK ("reminders"."repeat" in ('none', 'daily', 'weekly', 'monthly', 'yearly'))
);
--> statement-breakpoint
ALTER TABLE "notification_settings" DROP CONSTRAINT "notification_settings_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("due_at");--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_type_check" CHECK ("notification_settings"."type" in ('due_soon', 'overdue', 'invoice_closing', 'invoice_closed', 'invoice_due', 'income_unconfirmed', 'negative_forecast', 'budget', 'card_limit', 'split_pending', 'reminder'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('due_soon', 'overdue', 'invoice_closing', 'invoice_closed', 'invoice_due', 'income_unconfirmed', 'negative_forecast', 'budget', 'card_limit', 'split_pending', 'reminder'));