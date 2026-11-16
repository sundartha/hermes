import { LEITUNGSPLATZ_DB_FRIST_MS } from "../begriffe/speicher.js";
import { pendingConsult } from "./state-ops.js";

const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true),
  set_config('app.current_tenant', $2, true)`;
const LESEN_SQL = `SELECT status, consults FROM call WHERE id = $1`;

export function rueckfrageAusZustand(zustand, callId, afterEventId) {
  const call = zustand.calls.find((eintrag) => eintrag.id === callId);
  return { consult: pendingConsult(zustand, callId, afterEventId), status: call?.status ?? null };
}

export function macheRueckfrageSql({ runner }) {
  return {
    lesen: (callId, tenantId, afterEventId) =>
      runner.withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(FRIST_SQL, [String(LEITUNGSPLATZ_DB_FRIST_MS), tenantId]);
          const { rows } = await client.query(LESEN_SQL, [callId]);
          await client.query("COMMIT");
          if (rows.length === 0) return { consult: null, status: null };
          const zeile = rows[0];
          const zustand = { calls: [{ id: callId, consults: zeile.consults }] };
          return { consult: pendingConsult(zustand, callId, afterEventId), status: zeile.status };
        } catch (fehler) {
          await client.query("ROLLBACK").catch(() => {});
          throw fehler;
        }
      }),
  };
}
