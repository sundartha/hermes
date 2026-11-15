SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS anruf_schluessel (
  call_id TEXT NOT NULL REFERENCES call(id) ON DELETE CASCADE,
  art TEXT NOT NULL,
  wert_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  PRIMARY KEY (call_id, art)
);

CREATE INDEX IF NOT EXISTS anruf_schluessel_suche_idx ON anruf_schluessel (art, wert_hash);

ALTER TABLE anruf_schluessel ENABLE ROW LEVEL SECURITY;
ALTER TABLE anruf_schluessel FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anruf_schluessel_global ON anruf_schluessel;
CREATE POLICY anruf_schluessel_global ON anruf_schluessel USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION anruf_schluessel_pflegen() RETURNS trigger SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.stream_token = NEW.stream_token AND OLD.tenant_id = NEW.tenant_id
     AND OLD.twilio_sid IS NOT DISTINCT FROM NEW.twilio_sid THEN
    RETURN NULL;
  END IF;
  DELETE FROM anruf_schluessel WHERE call_id = NEW.id;
  INSERT INTO anruf_schluessel (call_id, art, wert_hash, tenant_id)
    VALUES (NEW.id, 'stream_token', encode(sha256(convert_to(NEW.stream_token, 'UTF8')), 'hex'), NEW.tenant_id);
  IF NEW.twilio_sid IS NOT NULL THEN
    INSERT INTO anruf_schluessel (call_id, art, wert_hash, tenant_id)
      VALUES (NEW.id, 'twilio_sid', encode(sha256(convert_to(NEW.twilio_sid, 'UTF8')), 'hex'), NEW.tenant_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS anruf_schluessel_pflegen ON call;
CREATE TRIGGER anruf_schluessel_pflegen AFTER INSERT OR UPDATE OF stream_token, twilio_sid, tenant_id ON call
  FOR EACH ROW EXECUTE FUNCTION anruf_schluessel_pflegen();
