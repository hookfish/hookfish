ALTER TABLE "oauth_states" ADD COLUMN "organization" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "return_to" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "error_status" integer;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "completed_at" timestamp with time zone;