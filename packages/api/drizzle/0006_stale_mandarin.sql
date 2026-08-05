ALTER TABLE "oauth_connections" ADD COLUMN "organization" text;--> statement-breakpoint
CREATE INDEX "oauth_connections_organization_idx" ON "oauth_connections" USING btree ("organization");