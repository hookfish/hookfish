ALTER TABLE "connections" ADD COLUMN "refresh_lock_owner" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "refresh_lock_expires_at" timestamp with time zone;