-- AlterEnum
ALTER TYPE "PlayerStatus" ADD VALUE 'waitlisted';

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "join_fee",
ADD COLUMN     "capacity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payment_deadline" TIMESTAMP(3);
