SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS widerruf_beginn_at TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS widerruf_beginn_text TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS abo_bestaetigung_fuer TEXT;
