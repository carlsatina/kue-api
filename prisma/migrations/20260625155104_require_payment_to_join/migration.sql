-- AlterEnum
ALTER TYPE "PlayerStatus" ADD VALUE 'pending_payment';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "join_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "require_payment_to_join" BOOLEAN NOT NULL DEFAULT false;
