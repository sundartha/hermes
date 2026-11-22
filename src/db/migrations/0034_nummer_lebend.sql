SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS nummer_lebend_zahl (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  anzahl INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE nummer_lebend_zahl ENABLE ROW LEVEL SECURITY;
ALTER TABLE nummer_lebend_zahl FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nummer_lebend_zahl_global ON nummer_lebend_zahl;
CREATE POLICY nummer_lebend_zahl_global ON nummer_lebend_zahl USING (true) WITH CHECK (true);

INSERT INTO nummer_lebend_zahl (id, anzahl) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION nummern_lebend_gesamt() RETURNS integer SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT anzahl FROM nummer_lebend_zahl WHERE id = 1;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION nummer_lebend_pflegen() RETURNS trigger SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  aenderung INTEGER := 0;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status NOT IN ('released', 'failed') THEN
    aenderung := aenderung + 1;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status NOT IN ('released', 'failed') THEN
    aenderung := aenderung - 1;
  END IF;
  IF aenderung <> 0 THEN
    UPDATE nummer_lebend_zahl SET anzahl = anzahl + aenderung WHERE id = 1;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nummer_lebend_pflegen ON number;
CREATE TRIGGER nummer_lebend_pflegen AFTER INSERT OR UPDATE OF status OR DELETE ON number
  FOR EACH ROW EXECUTE FUNCTION nummer_lebend_pflegen();

DO $$
DECLARE
  mandant TEXT;
  gezaehlt INTEGER;
  summe INTEGER := 0;
BEGIN
  FOR mandant IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.current_tenant', mandant, true);
    SELECT count(*) INTO gezaehlt FROM number WHERE status NOT IN ('released', 'failed');
    summe := summe + gezaehlt;
  END LOOP;
  UPDATE nummer_lebend_zahl SET anzahl = summe WHERE id = 1;
END $$;
