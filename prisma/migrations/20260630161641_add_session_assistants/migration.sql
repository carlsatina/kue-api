-- CreateEnum
CREATE TYPE "SessionMemberRole" AS ENUM ('owner', 'assistant');

-- CreateEnum
CREATE TYPE "AssistantInviteStatus" AS ENUM ('pending', 'accepted', 'revoked');

-- CreateTable
CREATE TABLE "session_members" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "SessionMemberRole" NOT NULL DEFAULT 'assistant',
    "invited_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_assistant_invites" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "AssistantInviteStatus" NOT NULL DEFAULT 'pending',
    "invited_by" UUID,
    "expires_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "accepted_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_assistant_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_members_user_id_idx" ON "session_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_members_session_id_user_id_key" ON "session_members"("session_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_assistant_invites_token_hash_key" ON "session_assistant_invites"("token_hash");

-- CreateIndex
CREATE INDEX "session_assistant_invites_session_id_idx" ON "session_assistant_invites"("session_id");

-- CreateIndex
CREATE INDEX "session_assistant_invites_email_idx" ON "session_assistant_invites"("email");

-- AddForeignKey
ALTER TABLE "session_members" ADD CONSTRAINT "session_members_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_members" ADD CONSTRAINT "session_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_assistant_invites" ADD CONSTRAINT "session_assistant_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
