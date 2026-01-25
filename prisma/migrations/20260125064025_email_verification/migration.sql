-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "email_verify_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "email_verify_token_hash" TEXT;

-- CreateIndex
CREATE INDEX "users_email_verify_token_hash_idx" ON "users"("email_verify_token_hash");
