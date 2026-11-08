SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE platform_tts_usage ADD COLUMN IF NOT EXISTS kostenstelle_zeichen BIGINT NOT NULL DEFAULT 0;
