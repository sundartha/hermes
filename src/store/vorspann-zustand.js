import { MS_PER_SECOND } from "../utils/timer.ts";

const KONTEXT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;
const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM vorspann_zustand WHERE expires_at <= now()`;
const ANLEGEN_SQL = `INSERT INTO vorspann_zustand (call_id, tenant_id, token, text, expires_at)
  VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`;
const TEXT_SQL = `SELECT text FROM vorspann_zustand WHERE call_id = $1 AND expires_at > now()`;
const LOESCHEN_SQL = `DELETE FROM vorspann_zustand WHERE call_id = $1`;
const LADEN_SQL = `SELECT callee_id, token, text, stand, aufgelegt, abgehoben FROM vorspann_zustand WHERE call_id = $1`;
const CALLEE_SQL = `UPDATE vorspann_zustand SET callee_id = COALESCE(callee_id, $2) WHERE call_id = $1 RETURNING callee_id`;
const ABGEHOBEN_SQL = `UPDATE vorspann_zustand SET abgehoben = true WHERE call_id = $1 AND NOT abgehoben RETURNING call_id`;
const MARKE_SQL = `UPDATE vorspann_zustand SET stand = stand || jsonb_build_object($2::text, $3::bigint)
  WHERE call_id = $1 AND NOT stand ? $2::text RETURNING stand`;
const ENTNEHMEN_SQL = `DELETE FROM vorspann_zustand WHERE call_id = $1 RETURNING callee_id, token, text, stand, aufgelegt, abgehoben`;
const SPEICHERN_SQL = `UPDATE vorspann_zustand SET stand = $2::jsonb || stand, aufgelegt = $3::jsonb WHERE call_id = $1`;

const zeileVon = (zeile) => zeile && { calleeId: zeile.callee_id, token: zeile.token, text: zeile.text, stand: zeile.stand, aufgelegt: zeile.aufgelegt, abgehoben: zeile.abgehoben };

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
    lade: async ({ tenantId, callId }) => zeileVon((await imMandanten(tenantId, [[LADEN_SQL, [callId]]]))[0]),
    setzeCallee: async ({ tenantId, callId, calleeId }) => (await imMandanten(tenantId, [[CALLEE_SQL, [callId, calleeId]]]))[0]?.callee_id,
    beanspruecheAbgehoben: async ({ tenantId, callId }) => (await imMandanten(tenantId, [[ABGEHOBEN_SQL, [callId]]])).length === 1,
    beanspruecheMarke: async ({ tenantId, callId, marke, ms }) =>
      (await imMandanten(tenantId, [[MARKE_SQL, [callId, marke, ms]]]))[0]?.stand,
    entnimm: async ({ tenantId, callId }) => zeileVon((await imMandanten(tenantId, [[ENTNEHMEN_SQL, [callId]]]))[0]),
    speichere: async ({ tenantId, callId, stand, aufgelegt }) => {
      await imMandanten(tenantId, [[SPEICHERN_SQL, [callId, JSON.stringify(stand), JSON.stringify(aufgelegt)]]]);
    },
  };
}

export function makeSpeicherVorspannZustand() {
  const zeilen = new Map();
  const schluessel = ({ tenantId, callId }) => `${tenantId}/${callId}`;
  const ersetze = (anfrage, aenderung) => {
    const zeile = zeilen.get(schluessel(anfrage));
    if (!zeile) return undefined;
    const neu = { ...zeile, ...aenderung(zeile) };
    zeilen.set(schluessel(anfrage), neu);
    return neu;
  };
  return {
    anlegen: async ({ tenantId, callId, token, text }) => {
      zeilen.set(schluessel({ tenantId, callId }), { calleeId: null, token, text, stand: {}, aufgelegt: [], abgehoben: false });
    },
    leseText: async (anfrage) => zeilen.get(schluessel(anfrage))?.text,
    loesche: async (anfrage) => {
      zeilen.delete(schluessel(anfrage));
    },
    lade: async (anfrage) => {
      const zeile = zeilen.get(schluessel(anfrage));
      return zeile && structuredClone(zeile);
    },
    setzeCallee: async (anfrage) => ersetze(anfrage, (zeile) => ({ calleeId: zeile.calleeId ?? anfrage.calleeId }))?.calleeId,
    beanspruecheAbgehoben: async (anfrage) => {
      if (zeilen.get(schluessel(anfrage))?.abgehoben !== false) return false;
      ersetze(anfrage, () => ({ abgehoben: true }));
      return true;
    },
    beanspruecheMarke: async (anfrage) => {
      const stand = zeilen.get(schluessel(anfrage))?.stand;
      if (!stand || anfrage.marke in stand) return undefined;
      return ersetze(anfrage, () => ({ stand: { ...stand, [anfrage.marke]: anfrage.ms } })).stand;
    },
    entnimm: async (anfrage) => {
      const zeile = zeilen.get(schluessel(anfrage));
      zeilen.delete(schluessel(anfrage));
      return zeile;
    },
    speichere: async (anfrage) => {
      ersetze(anfrage, (zeile) => ({ stand: { ...anfrage.stand, ...zeile.stand }, aufgelegt: [...anfrage.aufgelegt] }));
    },
  };
}
