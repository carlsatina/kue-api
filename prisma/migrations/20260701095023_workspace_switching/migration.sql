-- DropIndex
DROP INDEX "workspace_members_user_id_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active_workspace_id" UUID;

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_owner_id_user_id_key" ON "workspace_members"("owner_id", "user_id");

