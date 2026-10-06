import pg from "pg";
import { config } from "./config.js";

const IS_SUPERUSER_ON = "on";

export async function assertNoBypassRls(client) {
  const { rows } = await client.query(
    `SELECT current_user                   AS rolname,
            current_setting('is_superuser') AS is_su,
            r.rolbypassrls                  AS rolbypassrls
     FROM   pg_roles r
     WHERE  r.rolname = current_user`,
    [],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(
      "[F5] Portal-Pool: aktive Rolle nicht in pg_roles gefunden - " +
        "Rollen-Status nicht pruefbar, Pool fail-closed abgelehnt.",
    );
  }
  if (row.is_su === IS_SUPERUSER_ON) {
    throw new Error(
      `[F5] Portal-Pool laeuft als Superuser (current_user=${row.rolname}). ` +
        "Superuser umgehen FORCE-RLS vollstaendig. Richte eine dedizierte " +
        "non-superuser NOBYPASSRLS-Rolle ein und setze DATABASE_URL auf deren Credentials.",
    );
  }
  if (row.rolbypassrls === true) {
    throw new Error(
      `[F5] Portal-Pool hat BYPASSRLS (current_user=${row.rolname}). ` +
        "BYPASSRLS umgeht FORCE-RLS vollstaendig. Entferne BYPASSRLS von der Rolle " +
        "oder nutze eine dedizierte NOBYPASSRLS-Rolle fuer DATABASE_URL.",
    );
  }
}

export async function createPortalRunner({
  pool = new pg.Pool({ connectionString: config.store.databaseUrl }),
} = {}) {
  let client;
  try {
    client = await pool.connect();
    await assertNoBypassRls({ query: (t, p) => client.query(t, p) });
  } catch (e) {
    if (client) client.release();
    await pool.end();
    throw e;
  }
  client.release();
  return {
    withClient: async (fn) => {
      const c = await pool.connect();
      try {
        return await fn({ query: (t, p) => c.query(t, p) });
      } finally {
        c.release();
      }
    },
    _pool: pool,
  };
}
