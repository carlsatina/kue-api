-- AlterTable
ALTER TABLE "courts" ADD COLUMN     "created_by" UUID;

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "created_by" UUID;

-- CreateIndex
CREATE INDEX "courts_created_by_idx" ON "courts"("created_by");

-- CreateIndex
CREATE INDEX "players_created_by_idx" ON "players"("created_by");

-- AddForeignKey
ALTER TABLE "courts" ADD CONSTRAINT "courts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
