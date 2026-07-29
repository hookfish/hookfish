ALTER TABLE "oauth_connections" RENAME COLUMN "user_id" TO "connection_group_id";--> statement-breakpoint
ALTER TABLE "oauth_states" RENAME COLUMN "user_id" TO "connection_group_id";--> statement-breakpoint
DROP INDEX "oauth_connections_user_provider_idx";--> statement-breakpoint
DROP INDEX "oauth_connections_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connections_group_provider_idx" ON "oauth_connections" USING btree ("connection_group_id","provider");--> statement-breakpoint
CREATE INDEX "oauth_connections_group_idx" ON "oauth_connections" USING btree ("connection_group_id");
