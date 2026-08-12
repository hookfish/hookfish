CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"namespace" text NOT NULL,
	"provider_id" text NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"oauth_issuer" text,
	"oauth_client_id" text,
	"oauth_client_secret_encrypted" text,
	"secret_encrypted" text,
	"refresh_token_encrypted" text,
	"token_type" text DEFAULT 'Bearer' NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_account_id" text,
	"external_account_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "oauth_states" CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_connections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_providers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "oauth_connections" CASCADE;--> statement-breakpoint
DROP TABLE "oauth_providers" CASCADE;--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"namespace" text NOT NULL,
	"provider_id" text NOT NULL,
	"code_verifier" text,
	"redirect_uri" text NOT NULL,
	"return_to" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"issuer" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_status" integer,
	"error_code" text,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "connections_identity_idx" ON "connections" USING btree ("organization","namespace","provider_id");--> statement-breakpoint
CREATE INDEX "connections_organization_idx" ON "connections" USING btree ("organization");--> statement-breakpoint
CREATE INDEX "connections_provider_idx" ON "connections" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "oauth_states_expires_idx" ON "oauth_states" USING btree ("expires_at");
