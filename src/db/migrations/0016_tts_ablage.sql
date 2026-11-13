SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS tts_ablage (
  token_hash TEXT PRIMARY KEY,
  content_type TEXT,
  bytes BYTEA,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS tts_ablage_expires_at_idx ON tts_ablage (expires_at);

ALTER TABLE tts_ablage ENABLE ROW LEVEL SECURITY;
ALTER TABLE tts_ablage FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tts_ablage_global ON tts_ablage;
CREATE POLICY tts_ablage_global ON tts_ablage USING (true) WITH CHECK (true);
