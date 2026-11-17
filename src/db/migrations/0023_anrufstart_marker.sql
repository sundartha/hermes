SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS anrufstart_marker (
  call_id TEXT PRIMARY KEY REFERENCES call(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  versucht_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE anrufstart_marker ENABLE ROW LEVEL SECURITY;
ALTER TABLE anrufstart_marker FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anrufstart_marker_global ON anrufstart_marker;
CREATE POLICY anrufstart_marker_global ON anrufstart_marker USING (true) WITH CHECK (true);
