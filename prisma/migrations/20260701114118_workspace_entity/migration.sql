-- Multi-workspace ownership: introduce a first-class Workspace entity and
-- repoint all workspace-scoped data from "created_by user" to "workspace_id".
-- Ordered as: additive DDL -> data backfill -> enforce NOT NULL / drop old / FKs.

-- 1) Workspaces table (one row will exist per user after backfill).
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Give every existing user a personal workspace they own.
INSERT INTO "workspaces" ("id", "name", "owner_id", "created_at")
SELECT gen_random_uuid(),
       COALESCE(NULLIF(TRIM(u."full_name"), ''), split_part(u."email", '@', 1)) || '''s workspace',
       u."id",
       now()
FROM "users" u;

-- 3) Add nullable workspace_id columns (backfilled below).
ALTER TABLE "sessions" ADD COLUMN "workspace_id" UUID;
ALTER TABLE "courts" ADD COLUMN "workspace_id" UUID;
ALTER TABLE "teams" ADD COLUMN "workspace_id" UUID;
ALTER TABLE "players" ADD COLUMN "workspace_id" UUID;
ALTER TABLE "workspace_members" ADD COLUMN "workspace_id" UUID;
ALTER TABLE "session_assistant_invites" ADD COLUMN "workspace_id" UUID;

-- 4) Backfill scoped resources. A resource belongs to the workspace owned by the
--    ROOT of its creator: if the creator is an assistant, that's the owner who
--    invited them; otherwise the creator themselves.
UPDATE "sessions" x SET "workspace_id" = w."id" FROM "workspaces" w
 WHERE x."created_by" IS NOT NULL
   AND w."owner_id" = COALESCE(
        (SELECT wm."owner_id" FROM "workspace_members" wm WHERE wm."user_id" = x."created_by" LIMIT 1),
        x."created_by");
UPDATE "courts" x SET "workspace_id" = w."id" FROM "workspaces" w
 WHERE x."created_by" IS NOT NULL
   AND w."owner_id" = COALESCE(
        (SELECT wm."owner_id" FROM "workspace_members" wm WHERE wm."user_id" = x."created_by" LIMIT 1),
        x."created_by");
UPDATE "teams" x SET "workspace_id" = w."id" FROM "workspaces" w
 WHERE x."created_by" IS NOT NULL
   AND w."owner_id" = COALESCE(
        (SELECT wm."owner_id" FROM "workspace_members" wm WHERE wm."user_id" = x."created_by" LIMIT 1),
        x."created_by");
UPDATE "players" x SET "workspace_id" = w."id" FROM "workspaces" w
 WHERE x."created_by" IS NOT NULL
   AND w."owner_id" = COALESCE(
        (SELECT wm."owner_id" FROM "workspace_members" wm WHERE wm."user_id" = x."created_by" LIMIT 1),
        x."created_by");

-- 4b) Fallback for rows with NULL/orphaned creator (e.g. seeded courts/players):
--     assign to the oldest user's workspace so the NOT NULL constraint holds.
UPDATE "sessions" SET "workspace_id" =
    (SELECT w."id" FROM "workspaces" w JOIN "users" u ON u."id" = w."owner_id" ORDER BY u."created_at" ASC LIMIT 1)
    WHERE "workspace_id" IS NULL;
UPDATE "courts" SET "workspace_id" =
    (SELECT w."id" FROM "workspaces" w JOIN "users" u ON u."id" = w."owner_id" ORDER BY u."created_at" ASC LIMIT 1)
    WHERE "workspace_id" IS NULL;
UPDATE "teams" SET "workspace_id" =
    (SELECT w."id" FROM "workspaces" w JOIN "users" u ON u."id" = w."owner_id" ORDER BY u."created_at" ASC LIMIT 1)
    WHERE "workspace_id" IS NULL;
UPDATE "players" SET "workspace_id" =
    (SELECT w."id" FROM "workspaces" w JOIN "users" u ON u."id" = w."owner_id" ORDER BY u."created_at" ASC LIMIT 1)
    WHERE "workspace_id" IS NULL;

-- 5) Memberships move to the workspace owned by their old owner_id.
UPDATE "workspace_members" wm SET "workspace_id" = w."id"
 FROM "workspaces" w WHERE w."owner_id" = wm."owner_id";

-- 6) Invites move to the workspace owned by their old owner_id.
UPDATE "session_assistant_invites" i SET "workspace_id" = w."id"
 FROM "workspaces" w WHERE i."owner_id" IS NOT NULL AND w."owner_id" = i."owner_id";

-- 7) active_workspace_id previously held a root user id (or null) -> that user's workspace.
UPDATE "users" u SET "active_workspace_id" = w."id"
 FROM "workspaces" w WHERE u."active_workspace_id" IS NOT NULL AND w."owner_id" = u."active_workspace_id";
-- Null out anything that still doesn't reference a real workspace (safety for the FK below).
UPDATE "users" SET "active_workspace_id" = NULL
 WHERE "active_workspace_id" IS NOT NULL AND "active_workspace_id" NOT IN (SELECT "id" FROM "workspaces");

-- 8) Enforce NOT NULL on the now-populated scoping columns.
ALTER TABLE "sessions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "courts" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "teams" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "players" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "workspace_members" ALTER COLUMN "workspace_id" SET NOT NULL;

-- 9) Drop the old owner_id constructs now that data has moved.
ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_owner_id_fkey";
DROP INDEX "workspace_members_owner_id_idx";
DROP INDEX "workspace_members_owner_id_user_id_key";
ALTER TABLE "workspace_members" DROP COLUMN "owner_id";
DROP INDEX "session_assistant_invites_owner_id_idx";
ALTER TABLE "session_assistant_invites" DROP COLUMN "owner_id";

-- 10) New indexes.
CREATE INDEX "courts_workspace_id_idx" ON "courts"("workspace_id");
CREATE INDEX "players_workspace_id_idx" ON "players"("workspace_id");
CREATE INDEX "session_assistant_invites_workspace_id_idx" ON "session_assistant_invites"("workspace_id");
CREATE INDEX "sessions_workspace_id_idx" ON "sessions"("workspace_id");
CREATE INDEX "teams_workspace_id_idx" ON "teams"("workspace_id");
CREATE INDEX "workspace_members_workspace_id_idx" ON "workspace_members"("workspace_id");
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- 11) New foreign keys.
ALTER TABLE "users" ADD CONSTRAINT "users_active_workspace_id_fkey"
    FOREIGN KEY ("active_workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_assistant_invites" ADD CONSTRAINT "session_assistant_invites_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "courts" ADD CONSTRAINT "courts_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "players" ADD CONSTRAINT "players_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
