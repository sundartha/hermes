SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS nummer_schluessel (
  e164_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL
);

ALTER TABLE nummer_schluessel ENABLE ROW LEVEL SECURITY;
ALTER TABLE nummer_schluessel FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nummer_schluessel_global ON nummer_schluessel;
CREATE POLICY nummer_schluessel_global ON nummer_schluessel USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION nummer_schluessel_pflegen() RETURNS trigger SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.e164 IS NOT NULL THEN
    DELETE FROM nummer_schluessel WHERE e164_hash = encode(sha256(convert_to(OLD.e164, 'UTF8')), 'hex');
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.e164 IS NOT NULL THEN
    INSERT INTO nummer_schluessel (e164_hash, tenant_id)
      VALUES (encode(sha256(convert_to(NEW.e164, 'UTF8')), 'hex'), NEW.tenant_id)
      ON CONFLICT (e164_hash) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nummer_schluessel_pflegen ON number;
CREATE TRIGGER nummer_schluessel_pflegen AFTER INSERT OR UPDATE OF e164, tenant_id OR DELETE ON number
  FOR EACH ROW EXECUTE FUNCTION nummer_schluessel_pflegen();

DO $$
DECLARE
  mandant TEXT;
BEGIN
  FOR mandant IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.current_tenant', mandant, true);
    INSERT INTO nummer_schluessel (e164_hash, tenant_id)
      SELECT encode(sha256(convert_to(e164, 'UTF8')), 'hex'), tenant_id FROM number WHERE e164 IS NOT NULL
      ON CONFLICT (e164_hash) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END LOOP;
END $$;
