-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('admin', 'staff');

-- CreateEnum
CREATE TYPE "AssistantInviteStatus" AS ENUM ('pending', 'accepted', 'revoked');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('draft', 'open', 'closed');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('usual', 'tournament');

-- CreateEnum
CREATE TYPE "FeeMode" AS ENUM ('flat', 'per_game');

-- CreateEnum
CREATE TYPE "CourtStatus" AS ENUM ('available', 'in_match', 'maintenance');

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('pending_payment', 'waitlisted', 'checked_in', 'present', 'away', 'done');

-- CreateEnum
CREATE TYPE "QueueType" AS ENUM ('singles', 'doubles');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('queued', 'assigned', 'removed');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('proposed', 'active', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('singles', 'doubles');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'confirmed', 'rejected');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" "RoleName" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "email_verify_token_hash" TEXT,
    "email_verify_token_expires_at" TIMESTAMP(3),
    "password_reset_token_hash" TEXT,
    "password_reset_token_expires_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "active_workspace_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL,
    "mode" "SessionMode" NOT NULL DEFAULT 'usual',
    "game_type" "MatchType" NOT NULL DEFAULT 'doubles',
    "fee_mode" "FeeMode" NOT NULL,
    "fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "require_payment_to_join" BOOLEAN NOT NULL DEFAULT false,
    "payment_deadline" TIMESTAMP(3),
    "default_bracket_type" TEXT,
    "regular_join_limit" INTEGER NOT NULL DEFAULT 0,
    "new_joiner_limit" INTEGER NOT NULL DEFAULT 0,
    "return_to_queue" BOOLEAN NOT NULL DEFAULT true,
    "announcements" TEXT,
    "created_by" UUID,
    "workspace_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bracket_overrides" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "match_id" TEXT NOT NULL,
    "bracket_type" TEXT NOT NULL,
    "match_format" TEXT NOT NULL,
    "winner_id" TEXT,
    "score_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bracket_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_invite_links" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "invited_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_assistant_invites" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "session_id" UUID,
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

-- CreateTable
CREATE TABLE "courts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "workspace_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "courts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court_sessions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "court_id" UUID NOT NULL,
    "status" "CourtStatus" NOT NULL,
    "current_match_id" UUID,
    "next_match_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "court_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_by" UUID,
    "workspace_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "nickname" TEXT,
    "skill_level" TEXT,
    "contact" TEXT,
    "team_id" UUID,
    "created_by" UUID,
    "workspace_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_players" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "status" "PlayerStatus" NOT NULL,
    "is_new_player" BOOLEAN NOT NULL DEFAULT false,
    "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_played_at" TIMESTAMP(3),
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "total_queue_seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "session_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "type" "QueueType" NOT NULL,
    "status" "QueueStatus" NOT NULL,
    "position" INTEGER NOT NULL,
    "manual_order" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entry_players" (
    "entry_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,

    CONSTRAINT "queue_entry_players_pkey" PRIMARY KEY ("entry_id","player_id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "court_session_id" UUID,
    "status" "MatchStatus" NOT NULL,
    "match_type" "MatchType" NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "score_json" JSONB,
    "winner_team" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "match_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "team_id" UUID,
    "team_number" INTEGER NOT NULL,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("match_id","player_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "proof_image_url" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'confirmed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_share_links" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_verify_token_hash_idx" ON "users"("email_verify_token_hash");

-- CreateIndex
CREATE INDEX "users_password_reset_token_hash_idx" ON "users"("password_reset_token_hash");

-- CreateIndex
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE INDEX "sessions_workspace_id_idx" ON "sessions"("workspace_id");

-- CreateIndex
CREATE INDEX "bracket_overrides_session_id_idx" ON "bracket_overrides"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "bracket_overrides_session_id_match_id_bracket_type_match_fo_key" ON "bracket_overrides"("session_id", "match_id", "bracket_type", "match_format");

-- CreateIndex
CREATE UNIQUE INDEX "session_invite_links_token_key" ON "session_invite_links"("token");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_idx" ON "workspace_members"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_assistant_invites_token_hash_key" ON "session_assistant_invites"("token_hash");

-- CreateIndex
CREATE INDEX "session_assistant_invites_workspace_id_idx" ON "session_assistant_invites"("workspace_id");

-- CreateIndex
CREATE INDEX "session_assistant_invites_session_id_idx" ON "session_assistant_invites"("session_id");

-- CreateIndex
CREATE INDEX "session_assistant_invites_email_idx" ON "session_assistant_invites"("email");

-- CreateIndex
CREATE INDEX "courts_created_by_idx" ON "courts"("created_by");

-- CreateIndex
CREATE INDEX "courts_workspace_id_idx" ON "courts"("workspace_id");

-- CreateIndex
CREATE INDEX "court_sessions_session_id_idx" ON "court_sessions"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "court_sessions_session_id_court_id_key" ON "court_sessions"("session_id", "court_id");

-- CreateIndex
CREATE INDEX "teams_created_by_idx" ON "teams"("created_by");

-- CreateIndex
CREATE INDEX "teams_workspace_id_idx" ON "teams"("workspace_id");

-- CreateIndex
CREATE INDEX "players_created_by_idx" ON "players"("created_by");

-- CreateIndex
CREATE INDEX "players_team_id_idx" ON "players"("team_id");

-- CreateIndex
CREATE INDEX "players_workspace_id_idx" ON "players"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_players_session_id_player_id_key" ON "session_players"("session_id", "player_id");

-- CreateIndex
CREATE INDEX "queue_entries_session_id_idx" ON "queue_entries"("session_id");

-- CreateIndex
CREATE INDEX "queue_entries_session_id_position_idx" ON "queue_entries"("session_id", "position");

-- CreateIndex
CREATE INDEX "matches_session_id_idx" ON "matches"("session_id");

-- CreateIndex
CREATE INDEX "match_participants_team_id_idx" ON "match_participants"("team_id");

-- CreateIndex
CREATE INDEX "payments_session_id_player_id_idx" ON "payments"("session_id", "player_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE UNIQUE INDEX "session_share_links_token_key" ON "session_share_links"("token");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_active_workspace_id_fkey" FOREIGN KEY ("active_workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_overrides" ADD CONSTRAINT "bracket_overrides_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_invite_links" ADD CONSTRAINT "session_invite_links_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_assistant_invites" ADD CONSTRAINT "session_assistant_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_assistant_invites" ADD CONSTRAINT "session_assistant_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courts" ADD CONSTRAINT "courts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courts" ADD CONSTRAINT "courts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_sessions" ADD CONSTRAINT "court_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_sessions" ADD CONSTRAINT "court_sessions_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_players" ADD CONSTRAINT "session_players_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_players" ADD CONSTRAINT "session_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entry_players" ADD CONSTRAINT "queue_entry_players_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "queue_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entry_players" ADD CONSTRAINT "queue_entry_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_share_links" ADD CONSTRAINT "session_share_links_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
