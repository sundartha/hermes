import { LEITUNGSPLATZ_DB_FRIST_MS } from "../begriffe/speicher.js";
import {
  BEDARF_AUSGEHEND,
  LEITUNGSPLATZ_ENTSCHEIDUNG,
  ablaufSekunden,
  entscheideAus,
} from "./leitungsplaetze.js";

const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)`;
const SPERRE_SQL = `SELECT pg_advisory_xact_lock(2665, 1)`;
const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM leitungsplatz WHERE ablauf_um <= now()`;
const ZEILEN_SQL = `SELECT anbieter, call_id AS "callId", tenant_id AS "tenantId" FROM leitungsplatz`;
const AKTUELLE_ZEILEN_SQL = `${ZEILEN_SQL} WHERE ablauf_um > now()`;
const BELEGEN_SQL = `
  INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  SELECT $1, anbieter, $2, now() + make_interval(secs => $4) FROM unnest($3::text[]) AS anbieter`;
const FREIGEBEN_SQL = `DELETE FROM leitungsplatz WHERE call_id = $1`;

export function makePostgresLeitungsplaetze(runner) {
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

  const imZweifelVoll = (fehler) => {
    console.error("[leitungsplaetze] Datenbank nicht erreichbar, ausgehend abgelehnt:", fehler.message);
    return { entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL };
  };

  async function pruefenAusgehend(anfrage) {
    try {
      const { rows } = await inTransaktion((client) => client.query(AKTUELLE_ZEILEN_SQL));
      return entscheideAus(rows, anfrage);
    } catch (fehler) {
      return imZweifelVoll(fehler).entscheidung;
    }
  }

  async function belegenAusgehend({ callId, tenantId, weg, maxDauerS, hoechstzahlKunde }) {
    try {
      return await inTransaktion(async (client) => {
        await client.query(SPERRE_SQL);
        await client.query(ABGELAUFENE_LOESCHEN_SQL);
        const { rows } = await client.query(ZEILEN_SQL);
        const entscheidung = entscheideAus(rows, { tenantId, weg, hoechstzahlKunde });
        if (entscheidung === LEITUNGSPLATZ_ENTSCHEIDUNG.FREI)
          await client.query(BELEGEN_SQL, [callId, tenantId, BEDARF_AUSGEHEND[weg], ablaufSekunden(weg, maxDauerS)]);
        return { entscheidung };
      });
    } catch (fehler) {
      return imZweifelVoll(fehler);
    }
  }

  async function freigeben(callId) {
    try {
      await inTransaktion((client) => client.query(FREIGEBEN_SQL, [callId]));
    } catch (fehler) {
      console.error("[leitungsplaetze] Platz nicht freigegeben, bleibt bis zum Ablauf belegt:", fehler.message);
    }
  }

  return { pruefenAusgehend, belegenAusgehend, freigeben };
}
