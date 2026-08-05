CREATE TABLE "broker_access_tokens" (
	"name" text PRIMARY KEY NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "broker_access_tokens_expires_idx" ON "broker_access_tokens" USING btree ("expires_at");