CREATE SCHEMA IF NOT EXISTS "hookfish";
--> statement-breakpoint
ALTER TABLE "public"."access_grants" SET SCHEMA "hookfish";
--> statement-breakpoint
ALTER TABLE "public"."broker_access_tokens" SET SCHEMA "hookfish";
--> statement-breakpoint
ALTER TABLE "public"."connections" SET SCHEMA "hookfish";
--> statement-breakpoint
ALTER TABLE "public"."oauth_states" SET SCHEMA "hookfish";
