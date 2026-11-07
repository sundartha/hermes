SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE call ADD COLUMN IF NOT EXISTS not_placed_mail_sent_at TEXT;
