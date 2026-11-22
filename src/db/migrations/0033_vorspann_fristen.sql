SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_klingel_at TIMESTAMPTZ;
ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_klingel_lease_bis TIMESTAMPTZ;
ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_klingel_versuche BIGINT NOT NULL DEFAULT 0;
ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_wiedergabe_at TIMESTAMPTZ;
ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_wiedergabe_lease_bis TIMESTAMPTZ;
ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_wiedergabe_versuche BIGINT NOT NULL DEFAULT 0;
ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_el_bein_at TIMESTAMPTZ;
ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_el_bein_lease_bis TIMESTAMPTZ;
ALTER TABLE vorspann_zustand ADD COLUMN IF NOT EXISTS frist_el_bein_versuche BIGINT NOT NULL DEFAULT 0;
