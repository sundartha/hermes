SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS nummer_lebend (
  number_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL
);

ALTER TABLE nummer_lebend ENABLE ROW LEVEL SECURITY;
ALTER TABLE nummer_lebend FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nummer_lebend_global ON nummer_lebend;
CREATE POLICY nummer_lebend_global ON nummer_lebend USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION nummer_lebend_pflegen() RETURNS trigger SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    DELETE FROM nummer_lebend WHERE number_id = OLD.id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status NOT IN ('released', 'failed') THEN
    INSERT INTO nummer_lebend (number_id, tenant_id)
      VALUES (NEW.id, NEW.tenant_id)
      ON CONFLICT (number_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nummer_lebend_pflegen ON number;
CREATE TRIGGER nummer_lebend_pflegen AFTER INSERT OR UPDATE OF id, status, tenant_id OR DELETE ON number
  FOR EACH ROW EXECUTE FUNCTION nummer_lebend_pflegen();

CREATE OR REPLACE FUNCTION nummern_lebend_gesamt(ausser TEXT) RETURNS integer SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM nummer_lebend WHERE number_id <> ausser;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  mandant TEXT;
BEGIN
  FOR mandant IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.current_tenant', mandant, true);
    INSERT INTO nummer_lebend (number_id, tenant_id)
      SELECT id, tenant_id FROM number WHERE status NOT IN ('released', 'failed')
      ON CONFLICT (number_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END LOOP;
END $$;
