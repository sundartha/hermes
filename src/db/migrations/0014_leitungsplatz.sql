SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS leitungsplatz (
  call_id TEXT NOT NULL,
  anbieter TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  ablauf_um TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (call_id, anbieter)
);

ALTER TABLE leitungsplatz ENABLE ROW LEVEL SECURITY;
ALTER TABLE leitungsplatz FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leitungsplatz_global ON leitungsplatz;
CREATE POLICY leitungsplatz_global ON leitungsplatz USING (true) WITH CHECK (true);
