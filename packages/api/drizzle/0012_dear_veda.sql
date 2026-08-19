CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_grant_id" uuid,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "broker_access_tokens_expires_idx";--> statement-breakpoint
ALTER TABLE "broker_access_tokens" ADD COLUMN "grant_id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
INSERT INTO "access_grants" ("id", "scopes", "created_at", "expires_at")
SELECT "grant_id", "scopes", "created_at", "expires_at"
FROM "broker_access_tokens";--> statement-breakpoint
ALTER TABLE "broker_access_tokens" ALTER COLUMN "grant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "broker_access_tokens" ALTER COLUMN "grant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_parent_grant_id_access_grants_id_fk" FOREIGN KEY ("parent_grant_id") REFERENCES "public"."access_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grants_parent_idx" ON "access_grants" USING btree ("parent_grant_id");--> statement-breakpoint
CREATE INDEX "access_grants_expires_idx" ON "access_grants" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "broker_access_tokens" ADD CONSTRAINT "broker_access_tokens_grant_id_access_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."access_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broker_access_tokens_grant_idx" ON "broker_access_tokens" USING btree ("grant_id");--> statement-breakpoint
ALTER TABLE "broker_access_tokens" DROP COLUMN "scopes";--> statement-breakpoint
ALTER TABLE "broker_access_tokens" DROP COLUMN "expires_at";
