SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS webhook_zustellung (
  anker TEXT PRIMARY KEY,
  kennung TEXT NOT NULL,
  angenommen_um TIMESTAMPTZ NOT NULL DEFAULT now(),
  status INTEGER,
  content_type TEXT,
  iv BYTEA,
  koerper BYTEA,
  tag BYTEA
);

CREATE INDEX IF NOT EXISTS webhook_zustellung_angenommen_um_idx ON webhook_zustellung (angenommen_um);
CREATE INDEX IF NOT EXISTS webhook_zustellung_kennung_idx ON webhook_zustellung (kennung);

ALTER TABLE webhook_zustellung ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_zustellung FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_zustellung_global ON webhook_zustellung;
CREATE POLICY webhook_zustellung_global ON webhook_zustellung USING (true) WITH CHECK (true);
