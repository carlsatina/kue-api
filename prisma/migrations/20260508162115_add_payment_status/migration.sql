-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'confirmed');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'confirmed';
