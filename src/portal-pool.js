// Betriebs-Verdrahtung fuer portalStore: ein eigener pg-Pool. Getrennt vom
// Owner-Spiegel-Pool, weil der Kunden-Pfad pro Request eine kurze Transaktion
// (BEGIN/SET LOCAL/COMMIT) faehrt - eigener Lebenszyklus, eigene Saettigung.
// WICHTIG (Produktion): der DATABASE_URL-Nutzer MUSS non-superuser + NOBYPASSRLS
// sein, sonst greift FORCE-RLS NICHT (Superuser umgeht RLS). Siehe
// docs/RELEASE-GATE-killer-test.md.
import pg from "pg";
import { config } from "./config.js";

// Postgres meldet Superuser-Status als String 'on'/'off' via current_setting().
const IS_SUPERUSER_ON = "on";

// F5: Prueft einmalig (Startup) ob die aktive DB-Rolle Superuser oder BYPASSRLS
// hat. Beides umgeht FORCE-RLS vollstaendig -> RLS waere wirkungslos, Tenant-Leak
// bliebe unbemerkt. Wirft fail-closed mit klarer Meldung (Prozess startet nicht).
export async function assertNoBypassRls(client) {
  const { rows } = await client.query(
    `SELECT current_user                   AS rolname,
            current_setting('is_superuser') AS is_su,
            r.rolbypassrls                  AS rolbypassrls
     FROM   pg_roles r
     WHERE  r.rolname = current_user`,
    []
  );
  const row = rows[0];
  if (!row) {
    throw new Error(
      "[F5] Portal-Pool: aktive Rolle nicht in pg_roles gefunden - " +
      "Rollen-Status nicht pruefbar, Pool fail-closed abgelehnt."
    );
  }
  if (row.is_su === IS_SUPERUSER_ON) {
    throw new Error(
      `[F5] Portal-Pool laeuft als Superuser (current_user=${row.rolname}). ` +
      "Superuser umgehen FORCE-RLS vollstaendig. Richte eine dedizierte " +
      "non-superuser NOBYPASSRLS-Rolle ein und setze DATABASE_URL auf deren Credentials."
    );
  }
  if (row.rolbypassrls === true) {
    throw new Error(
      `[F5] Portal-Pool hat BYPASSRLS (current_user=${row.rolname}). ` +
      "BYPASSRLS umgeht FORCE-RLS vollstaendig. Entferne BYPASSRLS von der Rolle " +
      "oder nutze eine dedizierte NOBYPASSRLS-Rolle fuer DATABASE_URL."
    );
  }
}

export async function createPortalRunner() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  // Fail-closed: Rollen-Pruefung einmalig nach Pool-Aufbau. Wirft sie, wird der
  // Pool sofort beendet und der Fehler propagiert - der Prozess startet nicht.
  const client = await pool.connect();
  try {
    await assertNoBypassRls({ query: (t, p) => client.query(t, p) });
  } catch (e) {
    client.release();
    await pool.end();
    throw e;
  }
  client.release();
  return {
    withClient: async (fn) => {
      const client = await pool.connect();
      try { return await fn({ query: (t, p) => client.query(t, p) }); }
      finally { client.release(); }
    },
    _pool: pool,
  };
}
