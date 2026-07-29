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
	"account_id_path" text,
	"account_label_path" text,
	"client_id_encrypted" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
