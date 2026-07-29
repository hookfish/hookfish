DROP INDEX "oauth_connections_connection_provider_idx";--> statement-breakpoint
DROP INDEX "oauth_connections_connection_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connections_connection_id_idx" ON "oauth_connections" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "oauth_connections_provider_idx" ON "oauth_connections" USING btree ("provider");
