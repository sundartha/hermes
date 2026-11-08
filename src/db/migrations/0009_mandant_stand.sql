SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stand BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION tenant_stand_erhoehen() RETURNS trigger AS $$
BEGIN
  NEW.stand := OLD.stand + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_stand ON tenant;
CREATE TRIGGER tenant_stand BEFORE UPDATE ON tenant
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION tenant_stand_erhoehen();
