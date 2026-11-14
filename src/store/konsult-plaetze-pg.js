import { LEITUNGSPLATZ_DB_FRIST_MS } from "../begriffe/speicher.js";
import { konsultPlatzFrei } from "../utils/konsult-plaetze.js";

const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)`;
const SPERRE_SQL = `SELECT pg_advisory_xact_lock(2921, 1)`;
const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM konsult_platz WHERE ablauf_um <= now()`;
const ZEILEN_SQL = `SELECT call_id AS "callId", tenant_id AS "tenantId" FROM konsult_platz`;
const BELEGEN_SQL = `
  INSERT INTO konsult_platz (call_id, tenant_id, ablauf_um)
  VALUES ($1, $2, now() + make_interval(secs => $3))
  RETURNING platz_id AS "platzId"`;
const FREIGEBEN_SQL = `DELETE FROM konsult_platz WHERE platz_id = $1`;
const MS_JE_SEKUNDE = 1000;

export function makePostgresKonsultPlaetze(runner) {
  const inTransaktion = (arbeit) =>
    runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(FRIST_SQL, [String(LEITUNGSPLATZ_DB_FRIST_MS)]);
        const ergebnis = await arbeit(client);
        await client.query("COMMIT");
        return ergebnis;
      } catch (fehler) {
        await client.query("ROLLBACK").catch(() => {});
        throw fehler;
      }
    });

  async function belegen({ callId, tenantId, jeAnruf, jeMandant, haltefristMs }) {
    try {
      return await inTransaktion(async (client) => {
        await client.query(SPERRE_SQL);
        await client.query(ABGELAUFENE_LOESCHEN_SQL);
        const { rows } = await client.query(ZEILEN_SQL);
        if (!konsultPlatzFrei(rows, { callId, tenantId, jeAnruf, jeMandant })) return null;
        const eingefuegt = await client.query(BELEGEN_SQL, [callId, tenantId, haltefristMs / MS_JE_SEKUNDE]);
        return eingefuegt.rows[0].platzId;
      });
    } catch (fehler) {
      console.error("[konsult-plaetze] Datenbank nicht erreichbar, kein Platz gewaehrt:", fehler.message);
      return null;
    }
  }

  async function freigeben(platzId) {
    try {
      await inTransaktion((client) => client.query(FREIGEBEN_SQL, [platzId]));
    } catch (fehler) {
      console.error("[konsult-plaetze] Platz nicht freigegeben, verfaellt mit seiner Haltefrist:", fehler.message);
    }
  }

  return { belegen, freigeben };
}
