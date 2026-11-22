SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS vorspann_zustand (
  call_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  callee_id TEXT,
  token TEXT NOT NULL,
  text TEXT NOT NULL,
  stand JSONB NOT NULL DEFAULT '{}'::jsonb,
  aufgelegt JSONB NOT NULL DEFAULT '[]'::jsonb,
  abgehoben BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS vorspann_zustand_tenant_id_idx ON vorspann_zustand (tenant_id);
CREATE INDEX IF NOT EXISTS vorspann_zustand_expires_at_idx ON vorspann_zustand (expires_at);

ALTER TABLE vorspann_zustand ENABLE ROW LEVEL SECURITY;
ALTER TABLE vorspann_zustand FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vorspann_zustand_mandant ON vorspann_zustand;
CREATE POLICY vorspann_zustand_mandant ON vorspann_zustand
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
