SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE call ADD COLUMN IF NOT EXISTS frist_reserve_at TIMESTAMPTZ;
ALTER TABLE call ADD COLUMN IF NOT EXISTS frist_reserve_lease_bis TIMESTAMPTZ;
ALTER TABLE call ADD COLUMN IF NOT EXISTS frist_reserve_versuche BIGINT NOT NULL DEFAULT 0;
