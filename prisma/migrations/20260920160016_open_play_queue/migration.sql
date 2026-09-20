-- CreateEnum
CREATE TYPE "QueueMode" AS ENUM ('pairs', 'open_play');

-- CreateEnum
CREATE TYPE "PairingStrategy" AS ENUM ('arrival', 'balanced', 'avoid_repeat');

-- CreateEnum
CREATE TYPE "QueueSource" AS ENUM ('staff', 'player', 'auto_requeue');

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "locked_teams" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "QueueSource" NOT NULL DEFAULT 'staff';

-- AlterTable
ALTER TABLE "queue_entry_players" ADD COLUMN     "team_no" INTEGER;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "pairing_strategy" "PairingStrategy" NOT NULL DEFAULT 'arrival',
ADD COLUMN     "queue_mode" "QueueMode" NOT NULL DEFAULT 'pairs';

-- CreateTable
CREATE TABLE "queue_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "entry_id" UUID,
    "type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queue_events_session_id_created_at_idx" ON "queue_events"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
