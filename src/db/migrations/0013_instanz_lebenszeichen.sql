SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS instanz_lebenszeichen (
  kennung TEXT PRIMARY KEY,
  gemeldet_um TIMESTAMPTZ NOT NULL
);

ALTER TABLE instanz_lebenszeichen ENABLE ROW LEVEL SECURITY;
ALTER TABLE instanz_lebenszeichen FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instanz_lebenszeichen_global ON instanz_lebenszeichen;
CREATE POLICY instanz_lebenszeichen_global ON instanz_lebenszeichen USING (true) WITH CHECK (true);

ALTER TABLE call ADD COLUMN IF NOT EXISTS instanz TEXT;
