CREATE TABLE "bracket_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "match_id" TEXT NOT NULL,
  "bracket_type" TEXT NOT NULL,
  "match_format" TEXT NOT NULL,
  "winner_id" TEXT,
  "score_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bracket_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bracket_overrides_session_id_match_id_bracket_type_match_format_key"
ON "bracket_overrides" ("session_id", "match_id", "bracket_type", "match_format");

CREATE INDEX "bracket_overrides_session_id_idx" ON "bracket_overrides" ("session_id");

ALTER TABLE "bracket_overrides"
ADD CONSTRAINT "bracket_overrides_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
