import { MS_PER_SECOND } from "../utils/timer.ts";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;
const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM vorspann_zustand WHERE expires_at <= now()`;
const ANLEGEN_SQL = `INSERT INTO vorspann_zustand (call_id, tenant_id, token, text, expires_at)
  VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`;
const TEXT_SQL = `SELECT text FROM vorspann_zustand WHERE call_id = $1 AND expires_at > now()`;
const LOESCHEN_SQL = `DELETE FROM vorspann_zustand WHERE call_id = $1`;

export function makePostgresVorspannZustand(runner) {
  const imMandanten = (tenantId, anweisungen) =>
    runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(KONTEXT_SQL, [tenantId]);
        let rows = [];
        for (const anweisung of anweisungen) ({ rows } = await client.query(...anweisung));
        await client.query("COMMIT");
        return rows;
      } catch (fehler) {
        await client.query("ROLLBACK");
        throw fehler;
      }
    });

  return {
    anlegen: async ({ tenantId, callId, token, text, ttlMs }) => {
      await imMandanten(tenantId, [
        [ABGELAUFENE_LOESCHEN_SQL],
        [ANLEGEN_SQL, [callId, tenantId, token, text, ttlMs / MS_PER_SECOND]],
      ]);
    },
    leseText: async ({ tenantId, callId }) => (await imMandanten(tenantId, [[TEXT_SQL, [callId]]]))[0]?.text,
    loesche: async ({ tenantId, callId }) => {
      await imMandanten(tenantId, [[LOESCHEN_SQL, [callId]]]);
    },
  };
}

export function makeSpeicherVorspannZustand() {
  const texte = new Map();
  const schluessel = ({ tenantId, callId }) => `${tenantId}/${callId}`;
  return {
    anlegen: async ({ tenantId, callId, text }) => {
      texte.set(schluessel({ tenantId, callId }), text);
    },
    leseText: async (anfrage) => texte.get(schluessel(anfrage)),
    loesche: async (anfrage) => {
      texte.delete(schluessel(anfrage));
    },
  };
}
