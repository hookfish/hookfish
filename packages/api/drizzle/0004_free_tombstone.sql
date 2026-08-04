CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"encryption_version" text DEFAULT 'v1' NOT NULL,
	"fields" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "credentials_owner_idx" ON "credentials" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "credentials_owner_kind_idx" ON "credentials" USING btree ("owner_id","kind");