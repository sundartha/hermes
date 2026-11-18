SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_status_zustand_check' AND conrelid = 'call'::regclass) THEN
    ALTER TABLE call ADD CONSTRAINT call_status_zustand_check
      CHECK (status IN ('active', 'completed', 'failed', 'cancelled')) NOT VALID;
  END IF;
END $$;
