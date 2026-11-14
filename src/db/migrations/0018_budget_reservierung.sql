SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS budget_reservierung (
  call_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  cents BIGINT NOT NULL,
  angelegt_um TIMESTAMPTZ NOT NULL DEFAULT now(),
  ablauf_um TIMESTAMPTZ NOT NULL
);

ALTER TABLE budget_reservierung ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_reservierung FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON budget_reservierung;
CREATE POLICY tenant_isolation ON budget_reservierung
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
