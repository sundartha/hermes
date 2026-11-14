SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS konsult_platz (
  platz_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  ablauf_um TIMESTAMPTZ NOT NULL
);

ALTER TABLE konsult_platz ENABLE ROW LEVEL SECURITY;
ALTER TABLE konsult_platz FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS konsult_platz_global ON konsult_platz;
CREATE POLICY konsult_platz_global ON konsult_platz USING (true) WITH CHECK (true);
