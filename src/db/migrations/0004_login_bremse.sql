SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS login_bremse (
  schluessel TEXT PRIMARY KEY,
  anzahl BIGINT NOT NULL,
  beginn_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS login_bremse_beginn_ms_idx ON login_bremse (beginn_ms);

ALTER TABLE login_bremse ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_bremse FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS login_bremse_global ON login_bremse;
CREATE POLICY login_bremse_global ON login_bremse USING (true) WITH CHECK (true);
