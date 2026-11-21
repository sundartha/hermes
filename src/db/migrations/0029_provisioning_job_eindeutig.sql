SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provisioning_job_tenant_idempotency_key' AND conrelid = 'provisioning_job'::regclass) THEN
    ALTER TABLE provisioning_job ADD CONSTRAINT provisioning_job_tenant_idempotency_key
      UNIQUE (tenant_id, idempotency_key);
  END IF;
END $$;
