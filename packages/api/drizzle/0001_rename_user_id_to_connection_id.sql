ALTER TABLE "oauth_connections" RENAME COLUMN "user_id" TO "connection_id";--> statement-breakpoint
ALTER TABLE "oauth_states" RENAME COLUMN "user_id" TO "connection_id";--> statement-breakpoint
ALTER INDEX "oauth_connections_user_provider_idx" RENAME TO "oauth_connections_connection_provider_idx";--> statement-breakpoint
ALTER INDEX "oauth_connections_user_idx" RENAME TO "oauth_connections_connection_idx";
