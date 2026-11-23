SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS offener_auftrag_schluessel (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS offener_auftrag_schluessel_tenant_idx ON offener_auftrag_schluessel (tenant_id);

ALTER TABLE offener_auftrag_schluessel ENABLE ROW LEVEL SECURITY;
ALTER TABLE offener_auftrag_schluessel FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offener_auftrag_schluessel_global ON offener_auftrag_schluessel;
CREATE POLICY offener_auftrag_schluessel_global ON offener_auftrag_schluessel USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION offener_auftrag_schluessel_pflegen() RETURNS trigger SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    DELETE FROM offener_auftrag_schluessel WHERE job_id = OLD.id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status = 'queued' THEN
    INSERT INTO offener_auftrag_schluessel (job_id, tenant_id)
      VALUES (NEW.id, NEW.tenant_id)
      ON CONFLICT (job_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS offener_auftrag_schluessel_pflegen ON provisioning_job;
CREATE TRIGGER offener_auftrag_schluessel_pflegen AFTER INSERT OR UPDATE OF id, status, tenant_id OR DELETE ON provisioning_job
  FOR EACH ROW EXECUTE FUNCTION offener_auftrag_schluessel_pflegen();

DO $$
DECLARE
  mandant TEXT;
BEGIN
  FOR mandant IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.current_tenant', mandant, true);
    INSERT INTO offener_auftrag_schluessel (job_id, tenant_id)
      SELECT id, tenant_id FROM provisioning_job WHERE status = 'queued'
      ON CONFLICT (job_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END LOOP;
END $$;
