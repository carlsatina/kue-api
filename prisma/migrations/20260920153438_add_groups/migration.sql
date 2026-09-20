-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('owner', 'manager', 'member');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "group_id" UUID;

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workspace_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_invite_links" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "group_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "groups_workspace_id_idx" ON "groups"("workspace_id");

-- CreateIndex
CREATE INDEX "groups_created_by_idx" ON "groups"("created_by");

-- CreateIndex
CREATE INDEX "group_members_player_id_idx" ON "group_members"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_group_id_player_id_key" ON "group_members"("group_id", "player_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_invite_links_token_key" ON "group_invite_links"("token");

-- CreateIndex
CREATE INDEX "group_invite_links_group_id_idx" ON "group_invite_links"("group_id");

-- CreateIndex
CREATE INDEX "sessions_group_id_idx" ON "sessions"("group_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_invite_links" ADD CONSTRAINT "group_invite_links_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
