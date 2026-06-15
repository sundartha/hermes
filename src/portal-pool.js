// Betriebs-Verdrahtung fuer portalStore: ein eigener pg-Pool. Getrennt vom
// Owner-Spiegel-Pool, weil der Kunden-Pfad pro Request eine kurze Transaktion
// (BEGIN/SET LOCAL/COMMIT) faehrt - eigener Lebenszyklus, eigene Saettigung.
// WICHTIG (Produktion): der DATABASE_URL-Nutzer MUSS non-superuser + NOBYPASSRLS
// sein, sonst greift FORCE-RLS NICHT (Superuser umgeht RLS). Siehe
// docs/RELEASE-GATE-killer-test.md.
import pg from "pg";
import { config } from "./config.js";

export function createPortalRunner() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  return {
    withClient: async (fn) => {
      const client = await pool.connect();
      try { return await fn({ query: (t, p) => client.query(t, p) }); }
      finally { client.release(); }
    },
    _pool: pool,
  };
}
