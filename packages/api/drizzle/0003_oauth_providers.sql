CREATE TABLE "oauth_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"authorize_url" text NOT NULL,
	"token_url" text NOT NULL,
	"default_scopes" text[] DEFAULT '{}' NOT NULL,
	"scope_separator" text DEFAULT ' ' NOT NULL,
	"token_request_format" text DEFAULT 'form' NOT NULL,
	"client_auth" text DEFAULT 'body' NOT NULL,
	"use_pkce" boolean DEFAULT false NOT NULL,
	"supports_refresh" boolean DEFAULT true NOT NULL,
	"authorize_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"account_id_field" text,
	"account_label_field" text,
	"client_id_encrypted" text,
	"client_secret_encrypted" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "oauth_providers_enabled_idx" ON "oauth_providers" USING btree ("enabled");
--> statement-breakpoint
INSERT INTO "oauth_providers" (
	"id", "label", "authorize_url", "token_url", "default_scopes", "scope_separator",
	"token_request_format", "client_auth", "use_pkce", "supports_refresh",
	"authorize_params", "account_id_field", "account_label_field"
) VALUES
	(
		'notion',
		'Notion',
		'https://api.notion.com/v1/oauth/authorize',
		'https://api.notion.com/v1/oauth/token',
		'{}',
		' ',
		'json',
		'basic',
		false,
		false,
		'{"owner":"user"}'::jsonb,
		'workspace_id',
		'workspace_name'
	),
	(
		'linear',
		'Linear',
		'https://linear.app/oauth/authorize',
		'https://api.linear.app/oauth/token',
		'{read,write}',
		',',
		'form',
		'body',
		false,
		true,
		'{}'::jsonb,
		NULL,
		NULL
	),
	(
		'google',
		'Google',
		'https://accounts.google.com/o/oauth2/v2/auth',
		'https://oauth2.googleapis.com/token',
		'{openid,email,profile,https://www.googleapis.com/auth/drive.readonly}',
		' ',
		'form',
		'body',
		true,
		true,
		'{"access_type":"offline","prompt":"consent"}'::jsonb,
		NULL,
		NULL
	);
