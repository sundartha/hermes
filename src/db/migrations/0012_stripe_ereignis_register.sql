SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS stripe_ereignis_register (
  schluessel TEXT PRIMARY KEY,
  ereignis_id TEXT,
  erstellt_s BIGINT,
  aktion TEXT,
  angewendet_um TIMESTAMPTZ,
  sperre_inhaber TEXT,
  sperre_bis TIMESTAMPTZ
);

ALTER TABLE stripe_ereignis_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_ereignis_register FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_ereignis_register_global ON stripe_ereignis_register;
CREATE POLICY stripe_ereignis_register_global ON stripe_ereignis_register USING (true) WITH CHECK (true);
