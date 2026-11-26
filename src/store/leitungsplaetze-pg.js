import { LEITUNGSPLATZ_DB_FRIST_MS } from "../begriffe/speicher.ts";
import {
  BEDARF,
  LEITUNGSPLATZ_ENTSCHEIDUNG,
  RICHTUNG,
  WARTE_ABLAUF_S,
  WARTE_ANBIETER,
  ablaufSekunden,
  belegungAus,
  entscheideAus,
  entscheideWartendeAus,
} from "./leitungsplaetze.js";

const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)`;
const SPERRE_SQL = `SELECT pg_advisory_xact_lock(2665, 1)`;
const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM leitungsplatz WHERE ablauf_um <= now()`;
const ZEILEN_SQL = `SELECT anbieter, call_id AS "callId", tenant_id AS "tenantId", richtung FROM leitungsplatz`;
const AKTUELLE_ZEILEN_SQL = `${ZEILEN_SQL} WHERE ablauf_um > now()`;
const BELEGEN_SQL = `
  INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um, richtung)
  SELECT $1, anbieter, $2, now() + make_interval(secs => $4), $5 FROM unnest($3::text[]) AS anbieter`;
const BELEGTE_ANRUFE_SQL = `SELECT DISTINCT call_id AS "callId" FROM leitungsplatz WHERE ablauf_um > now() AND richtung <> $2 AND call_id = ANY($1::text[])`;
const WARTEPLATZ_LOESCHEN_SQL = `DELETE FROM leitungsplatz WHERE call_id = $1 AND richtung = $2`;
const FREIGEBEN_SQL = `DELETE FROM leitungsplatz WHERE call_id = $1`;

function macheInTransaktion(runner) {
  const transaktion = (arbeit, abbruch, callId) =>
    runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(FRIST_SQL, [String(LEITUNGSPLATZ_DB_FRIST_MS)]);
        const ergebnis = await arbeit(client);
        if (abbruch.abgelaufen) throw new Error("Frist abgelaufen, Transaktion zurueckgerollt");
        await client.query("COMMIT");
        if (abbruch.abgelaufen && callId) await spaetFreigeben(client, callId);
        return ergebnis;
      } catch (fehler) {
        await client.query("ROLLBACK").catch(() => {});
        throw fehler;
      }
    });

  const spaetFreigeben = (client, callId) =>
    client.query(FREIGEBEN_SQL, [callId]).catch((fehler) => {
      console.error("[leitungsplaetze] Platz nach spaetem COMMIT nicht freigegeben, bleibt bis zum Ablauf belegt:", fehler.message);
    });

  const inTransaktion = (arbeit, callId) => {
    let timer;
    const abbruch = { abgelaufen: false };
    const frist = new Promise((aufgeloest, abgelehnt) => {
      timer = setTimeout(() => {
        abbruch.abgelaufen = true;
        abgelehnt(new Error(`Frist von ${LEITUNGSPLATZ_DB_FRIST_MS} ms ueberschritten`));
      }, LEITUNGSPLATZ_DB_FRIST_MS);
    });
    const lauf = transaktion(arbeit, abbruch, callId);
    lauf.catch(() => {});
    return Promise.race([lauf, frist]).finally(() => clearTimeout(timer));
  };
  return inTransaktion;
}

export function makePostgresLeitungsplaetze(runner) {
  const inTransaktion = macheInTransaktion(runner);

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

  const unterSperre = (callId, arbeit) =>
    inTransaktion(async (client) => {
      await client.query(SPERRE_SQL);
      await client.query(ABGELAUFENE_LOESCHEN_SQL);
      const { rows } = await client.query(ZEILEN_SQL);
      return arbeit(client, rows);
    }, callId);

  async function belegenWartend({ callId, tenantId }) {
    try {
      return await unterSperre(callId, async (client, rows) => {
        const entscheidung = entscheideWartendeAus(rows, { tenantId });
        if (entscheidung === LEITUNGSPLATZ_ENTSCHEIDUNG.FREI)
          await client.query(BELEGEN_SQL, [callId, tenantId, [WARTE_ANBIETER], WARTE_ABLAUF_S, RICHTUNG.WARTEND]);
        return entscheidung;
      });
    } catch (fehler) {
      return imZweifelVoll(fehler).entscheidung;
    }
  }

  async function belegenAusgehend({ callId, tenantId, weg, maxDauerS, hoechstzahlKunde }) {
    try {
      return await unterSperre(callId, async (client, rows) => {
        const entscheidung = entscheideAus(rows, { tenantId, weg, hoechstzahlKunde });
        if (entscheidung === LEITUNGSPLATZ_ENTSCHEIDUNG.FREI) {
          await client.query(WARTEPLATZ_LOESCHEN_SQL, [callId, RICHTUNG.WARTEND]);
          await client.query(BELEGEN_SQL, [callId, tenantId, BEDARF[weg], ablaufSekunden(weg, maxDauerS), RICHTUNG.AUSGEHEND]);
        }
        return { entscheidung };
      });
    } catch (fehler) {
      return imZweifelVoll(fehler);
    }
  }

  async function belegenEingehend({ callId, tenantId, weg, maxDauerS }) {
    try {
      await inTransaktion((client) =>
        client.query(BELEGEN_SQL, [callId, tenantId, BEDARF[weg], ablaufSekunden(weg, maxDauerS), RICHTUNG.EINGEHEND]),
      );
    } catch (fehler) {
      console.error("[leitungsplaetze] Eingehend nicht gezaehlt:", fehler.message);
    }
  }

  async function freigeben(callId) {
    try {
      await inTransaktion((client) => client.query(FREIGEBEN_SQL, [callId]));
    } catch (fehler) {
      console.error("[leitungsplaetze] Platz nicht freigegeben, bleibt bis zum Ablauf belegt:", fehler.message);
    }
  }

  async function belegung() {
    const { rows } = await inTransaktion((client) => client.query(AKTUELLE_ZEILEN_SQL));
    return belegungAus(rows);
  }

  async function belegteAnrufe(callIds) {
    const { rows } = await inTransaktion((client) => client.query(BELEGTE_ANRUFE_SQL, [callIds, RICHTUNG.WARTEND]));
    return new Set(rows.map((zeile) => zeile.callId));
  }

  return { pruefenAusgehend, belegenAusgehend, belegenWartend, belegenEingehend, freigeben, belegung, belegteAnrufe };
}
