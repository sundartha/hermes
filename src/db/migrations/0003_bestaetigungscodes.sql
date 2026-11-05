SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS bestaetigung_verbrauch (
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  digest TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, digest)
);

CREATE TABLE IF NOT EXISTS bestaetigung_slot (
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  digest TEXT NOT NULL,
  slot BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, digest)
);

CREATE TABLE IF NOT EXISTS bestaetigung_fehlversuch (
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  window_idx BIGINT NOT NULL,
  count BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, window_idx)
);

ALTER TABLE bestaetigung_verbrauch ENABLE ROW LEVEL SECURITY;
ALTER TABLE bestaetigung_verbrauch FORCE ROW LEVEL SECURITY;
ALTER TABLE bestaetigung_slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE bestaetigung_slot FORCE ROW LEVEL SECURITY;
ALTER TABLE bestaetigung_fehlversuch ENABLE ROW LEVEL SECURITY;
ALTER TABLE bestaetigung_fehlversuch FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bestaetigung_verbrauch;
CREATE POLICY tenant_isolation ON bestaetigung_verbrauch
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON bestaetigung_slot;
CREATE POLICY tenant_isolation ON bestaetigung_slot
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON bestaetigung_fehlversuch;
CREATE POLICY tenant_isolation ON bestaetigung_fehlversuch
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
