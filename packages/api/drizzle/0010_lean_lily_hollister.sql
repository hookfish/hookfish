DROP INDEX "connections_organization_idx";--> statement-breakpoint
DROP INDEX "vault_secrets_organization_path_idx";--> statement-breakpoint
DROP INDEX "vault_secrets_organization_idx";--> statement-breakpoint
DROP INDEX "connections_identity_idx";--> statement-breakpoint
UPDATE "connections"
SET "namespace" = CASE
  WHEN "organization" = '' THEN "namespace"
  WHEN "namespace" = '' THEN 'organizations/' || "organization"
  ELSE 'organizations/' || "organization" || '/' || "namespace"
END;--> statement-breakpoint
UPDATE "oauth_states"
SET "namespace" = CASE
  WHEN "organization" = '' THEN "namespace"
  WHEN "namespace" = '' THEN 'organizations/' || "organization"
  ELSE 'organizations/' || "organization" || '/' || "namespace"
END;--> statement-breakpoint
UPDATE "vault_secrets"
SET "path" = CASE
  WHEN "organization" = '' THEN "path"
  WHEN "path" = "organization" OR starts_with("path", "organization" || '/')
    THEN 'organizations/' || "path"
  ELSE 'organizations/' || "organization" || '/' || "path"
END;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_secrets_path_idx" ON "vault_secrets" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_identity_idx" ON "connections" USING btree ("namespace","provider_id");--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "organization";--> statement-breakpoint
ALTER TABLE "oauth_states" DROP COLUMN "organization";--> statement-breakpoint
ALTER TABLE "vault_secrets" DROP COLUMN "organization";
