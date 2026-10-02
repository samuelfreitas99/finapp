CREATE TABLE "notification_settings" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"days_before" integer DEFAULT 3 NOT NULL,
	"quiet_start" text,
	"quiet_end" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_user_id_type_pk" PRIMARY KEY("user_id","type"),
	CONSTRAINT "notification_settings_type_check" CHECK ("notification_settings"."type" in ('due_soon', 'overdue', 'invoice_closing', 'invoice_closed', 'invoice_due', 'income_unconfirmed', 'negative_forecast', 'budget', 'card_limit', 'split_pending')),
	CONSTRAINT "notification_settings_days_check" CHECK ("notification_settings"."days_before" between 0 and 30),
	CONSTRAINT "notification_settings_quiet_check" CHECK (("notification_settings"."quiet_start" is null or "notification_settings"."quiet_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and ("notification_settings"."quiet_end" is null or "notification_settings"."quiet_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"entity_type" text,
	"entity_id" uuid,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('due_soon', 'overdue', 'invoice_closing', 'invoice_closed', 'invoice_due', 'income_unconfirmed', 'negative_forecast', 'budget', 'card_limit', 'split_pending'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");