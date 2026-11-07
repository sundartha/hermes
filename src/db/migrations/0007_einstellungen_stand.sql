SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE settings ADD COLUMN IF NOT EXISTS stand BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION settings_stand_erhoehen() RETURNS trigger AS $$
BEGIN
  NEW.stand := OLD.stand + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settings_stand ON settings;
CREATE TRIGGER settings_stand BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION settings_stand_erhoehen();
