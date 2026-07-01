/*
  Warnings:

  - You are about to drop the `session_members` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "session_members" DROP CONSTRAINT "session_members_session_id_fkey";

-- DropForeignKey
ALTER TABLE "session_members" DROP CONSTRAINT "session_members_user_id_fkey";

-- DropTable
DROP TABLE "session_members";

-- DropEnum
DROP TYPE "SessionMemberRole";

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "invited_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_user_id_key" ON "workspace_members"("user_id");

-- CreateIndex
CREATE INDEX "workspace_members_owner_id_idx" ON "workspace_members"("owner_id");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
