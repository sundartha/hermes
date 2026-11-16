import pg from "pg";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { seedeMandant } from "../anrufe/hermes-mit-postgres.js";
import { startServer } from "../helpers.js";

export const ZEITGRENZE_MS = 240_000;
const ABRUF_FRIST_MS = 60_000;
export const MANDANT = { id: "tenant_klg_0", sub: "sub-klg-0", e164: "+4930555000600" };
export const FREMDER = { id: "tenant_klg_1", sub: "sub-klg-1", e164: "+4930555000601" };
const UMGEBUNG = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
});
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at,
    elevenlabs_conversation_id, max_duration_s, answered_at)
  VALUES ($1, $2, $1 || '_token', 'outbound', $3, (SELECT e164 FROM number WHERE tenant_id = $2), '+4915112340000', 'Test', now()::text,
    'conv_' || $1, 300, now()::text)`;

const STATUS_SQL = "UPDATE call SET status = $1 WHERE id = $2";

export async function mitInstanzB(t, { anrufId, status }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(db.adresse).pathname;
  const verwaltung = new pg.Client({ connectionString: url.href });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const gestartet = [];
  const starte = async () => {
    const instanz = await startServer({ env: pgStartUmgebung(db.adresse, UMGEBUNG) });
    gestartet.push(instanz);
    return instanz;
  };
  try {
    await (await starte()).stop();
    await seedeMandant(sql, MANDANT);
    await seedeMandant(sql, FREMDER);
    const b = await starte();
    await sql(ANRUF_SQL, [anrufId, MANDANT.id, "active"]);
    const hole = async () => {
      if (status !== "active") await sql(STATUS_SQL, [status, anrufId]);
      const antwort = await abrufMitFrist(`${b.localUrl}/api/calls/${anrufId}/consult`, {
        headers: { "X-Internal-Identity": MANDANT.sub },
      }, { wartezeitMs: ABRUF_FRIST_MS });
      return antwort.json();
    };
    return await lauf({ sql, hole });
  } finally {
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await verwaltung.end();
  }
}
