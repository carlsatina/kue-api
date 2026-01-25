-- AlterTable
ALTER TABLE "bracket_overrides" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "bracket_overrides_session_id_match_id_bracket_type_match_format" RENAME TO "bracket_overrides_session_id_match_id_bracket_type_match_fo_key";
