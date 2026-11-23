import { LEITUNGSPLATZ_DB_FRIST_MS } from "../begriffe/speicher.js";
import { pendingConsult } from "./state-ops.js";

const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true),
  set_config('app.current_tenant', $2, true)`;
const LESEN_SQL = `SELECT status, consults FROM call WHERE id = $1`;
const ZUSTELLUNG_SETZEN_SQL = `UPDATE call SET consults = (
    SELECT jsonb_agg(
      CASE WHEN eintrag.value->>'id' = $2 AND eintrag.value->>'status' = 'open'
        AND COALESCE(eintrag.value->>'askDeliveredAt', '') = ''
      THEN eintrag.value || jsonb_build_object('askDeliveredAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE eintrag.value END
      ORDER BY eintrag.ordinality)
    FROM jsonb_array_elements(consults) WITH ORDINALITY AS eintrag(value, ordinality))
  WHERE id = $1 AND jsonb_typeof(consults) = 'array'`;

export function rueckfrageAusZustand(zustand, callId, afterEventId) {
  const call = zustand.calls.find((eintrag) => eintrag.id === callId);
  return { consult: pendingConsult(zustand, callId, afterEventId), status: call?.status ?? null };
}

export function zustellzeitAusZustand(zustand, callId, eventId) {
  const call = zustand.calls.find((eintrag) => eintrag.id === callId);
  return call?.consults?.find((consult) => consult.id === eventId)?.askDeliveredAt ?? null;
}

export const rueckfrageLeser = (sql) => ({
  rueckfrageGelesen: sql.lesen,
  zustellzeitGelesen: sql.zustellzeitLesen,
});

export function macheRueckfrageSql({ runner }) {
  const imMandanten = (tenantId, arbeit) =>
    runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(FRIST_SQL, [String(LEITUNGSPLATZ_DB_FRIST_MS), tenantId]);
        const ergebnis = await arbeit(client);
        await client.query("COMMIT");
        return ergebnis;
      } catch (fehler) {
        await client.query("ROLLBACK").catch(() => {});
        throw fehler;
      }
    });
  return {
    lesen: (callId, tenantId, afterEventId) =>
      imMandanten(tenantId, async (client) => {
        const { rows } = await client.query(LESEN_SQL, [callId]);
        if (rows.length === 0) return { consult: null, status: null };
        const zeile = rows[0];
        const zustand = { calls: [{ id: callId, consults: zeile.consults }] };
        return { consult: pendingConsult(zustand, callId, afterEventId), status: zeile.status };
      }),
    zustellungSetzen: (callId, tenantId, eventId) =>
      imMandanten(tenantId, (client) => client.query(ZUSTELLUNG_SETZEN_SQL, [callId, eventId])),
    zustellzeitLesen: (callId, tenantId, eventId) =>
      imMandanten(tenantId, async (client) => {
        const { rows } = await client.query(LESEN_SQL, [callId]);
        const zustand = { calls: [{ id: callId, consults: rows[0]?.consults }] };
        return zustellzeitAusZustand(zustand, callId, eventId);
      }),
  };
}
