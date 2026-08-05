CREATE TABLE "broker_access_tokens" (
	"name" text PRIMARY KEY NOT NULL,
	"token_id_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "broker_access_tokens_token_id_hash_idx" ON "broker_access_tokens" USING btree ("token_id_hash");
--> statement-breakpoint
CREATE INDEX "broker_access_tokens_expires_idx" ON "broker_access_tokens" USING btree ("expires_at");
