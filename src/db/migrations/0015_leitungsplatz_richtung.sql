SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE leitungsplatz ADD COLUMN IF NOT EXISTS richtung TEXT NOT NULL DEFAULT 'ausgehend';
