-- DropForeignKey
ALTER TABLE "session_assistant_invites" DROP CONSTRAINT "session_assistant_invites_session_id_fkey";

-- AlterTable
ALTER TABLE "session_assistant_invites" ADD COLUMN     "owner_id" UUID,
ALTER COLUMN "session_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "session_assistant_invites_owner_id_idx" ON "session_assistant_invites"("owner_id");

-- AddForeignKey
ALTER TABLE "session_assistant_invites" ADD CONSTRAINT "session_assistant_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
