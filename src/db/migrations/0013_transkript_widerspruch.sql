SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE call ADD COLUMN IF NOT EXISTS transcript_declined BOOLEAN NOT NULL DEFAULT FALSE;
