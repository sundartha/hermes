SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE call ADD COLUMN IF NOT EXISTS frist_abfrage_at TIMESTAMPTZ;
ALTER TABLE call ADD COLUMN IF NOT EXISTS frist_abfrage_lease_bis TIMESTAMPTZ;
ALTER TABLE call ADD COLUMN IF NOT EXISTS frist_abfrage_versuche BIGINT NOT NULL DEFAULT 0;
