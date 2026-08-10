CREATE TABLE "oauth_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"provider_id" text NOT NULL,
	"template_id" text NOT NULL,
	"label" text,
	"credential_mode" text DEFAULT 'inherit' NOT NULL,
	"client_id" text,
	"client_secret_path" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"path" text NOT NULL,
	"value_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_providers_organization_provider_id_idx" ON "oauth_providers" USING btree ("organization","provider_id");--> statement-breakpoint
CREATE INDEX "oauth_providers_organization_idx" ON "oauth_providers" USING btree ("organization");--> statement-breakpoint
CREATE INDEX "oauth_providers_template_id_idx" ON "oauth_providers" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_secrets_organization_path_idx" ON "vault_secrets" USING btree ("organization","path");--> statement-breakpoint
CREATE INDEX "vault_secrets_organization_idx" ON "vault_secrets" USING btree ("organization");