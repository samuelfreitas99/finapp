ALTER TABLE "debts" ADD COLUMN "completion_deadline" date;--> statement-breakpoint
ALTER TABLE "debts" ADD COLUMN "completion_confirmed" boolean DEFAULT false NOT NULL;