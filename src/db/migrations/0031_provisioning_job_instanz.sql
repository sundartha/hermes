SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE provisioning_job ADD COLUMN IF NOT EXISTS instanz TEXT;
