SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE call ADD COLUMN IF NOT EXISTS el_call_control_id TEXT;
