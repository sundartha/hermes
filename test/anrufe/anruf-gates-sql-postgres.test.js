import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mitZweiHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
  rufeAnMit,
  seedeLaufendenAnruf,
  seedeVerbrauch,
} from "./hermes-mit-postgres.js";
import { antwortVon, mitInstanzenAufPostgres, signierteZustellung } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const EINMAL = 1;
const KEINMAL = 0;
const ANLEGEN_FEHLER =
  "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.";
const ROLLE_DER_ANWENDUNG_SQL = `SELECT DISTINCT usename FROM pg_stat_activity
  WHERE datname = current_database() AND usename <> current_user`;
const SPALTEN_SQL = `SELECT column_name FROM information_schema.columns WHERE table_name = 'call'`;
const ANRUF_ZIEL = "+4915112345679";
const MAX_DAUER_S = 1800;
const GESPRAECH = "call_gatesql_y";
const LAUFT_SEIT_MS = (9 * 60 + 5) * 1000;
const KOSTENDECKE_CENT = 1000;
const VERBRAUCH_UEBER_DECKE_CENT = 900;
const VERBRAUCH_UNTER_DECKE_CENT = 100;
const VERBRAUCH_KNAPP_UNTER_DECKE_CENT = 770;
const BEENDET_SQL = `UPDATE call SET status = 'completed' WHERE id = $1`;
const TARIF_CENT = "20";
const KOSTEN_ENV = Object.freeze({
  DEFAULT_TENANT_BUDGET_CENTS: String(KOSTENDECKE_CENT),
  VOICE_TARIFF_DOMESTIC_CENTS: TARIF_CENT,
  VOICE_TARIFF_DEFAULT_CENTS: TARIF_CENT,
});

async function sprachturn({ b, signer }, callId) {
  const zustellung = signierteZustellung(signer, {
    callId,
    token: `tok_${callId}`,
    felder: { CallSid: `CA_${callId}`, SpeechResult: "Hallo" },
  });
  return antwortVon(b, zustellung);
}

async function turnBeiVerbrauch(t, verbrauchCent, pruefe) {
  await mitInstanzenAufPostgres(
    t,
    { anrufe: [GESPRAECH], env: KOSTEN_ENV },
    async (umgebung) => {
      const { sql } = umgebung;
      await seedeLaufendenAnruf(sql, { ziel: ANRUF_ZIEL, laeuftSeitMs: LAUFT_SEIT_MS, maxDurationS: MAX_DAUER_S });
      await seedeVerbrauch(sql, verbrauchCent);
      const antwort = await sprachturn({ b: umgebung.instanzen[1], signer: umgebung.signer }, GESPRAECH);
      await pruefe({ antwort, modell: umgebung.modell });
    },
  );
}

test("GATES-SQL-1: ein Anruf, den nur Instanz A gestartet hat, wird auf Instanz B als laufend erkannt und nicht doppelt gewaehlt", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ a, b, anbieter }) => {
    const to = ziel();
    const erster = await rufeAnMit(a, { to });
    assert.equal(erster.status, HTTP_OK);
    const ersterAnruf = await erster.json();
    assert.equal(ersterAnruf.deduplicated, false);
    const zweiter = await rufeAnMit(b, { to });
    assert.equal(zweiter.status, HTTP_OK);
    const zweiterAnruf = await zweiter.json();
    assert.equal(zweiterAnruf.deduplicated, true);
    assert.equal(zweiterAnruf.callId, ersterAnruf.callId);
    assert.equal(anbieter.starts().length, EINMAL);
  });
});

test("GATES-SQL-2: ist die Liste der laufenden Anrufe nicht lesbar, wird nicht gewaehlt und der Fehler lautet wie beim Anlegen", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ b, anbieter, sql }) => {
    const { rows } = await sql(ROLLE_DER_ANWENDUNG_SQL);
    const rolle = rows[0].usename;
    const { rows: spalten } = await sql(SPALTEN_SQL);
    await sql(`REVOKE SELECT ON call FROM ${rolle}`);
    const lesbar = spalten.map((zeile) => zeile.column_name).filter((name) => name !== "goal");
    await sql(`GRANT SELECT (${lesbar.join(", ")}) ON call TO ${rolle}`);
    const antwort = await rufeAnMit(b, { to: ziel() });
    assert.equal(antwort.status, HTTP_UNAVAILABLE);
    assert.equal((await antwort.json()).error, ANLEGEN_FEHLER);
    assert.equal(anbieter.starts().length, KEINMAL);
    assert.ok(b.stdout.includes("[pg] aktive anrufe lesen fehlgeschlagen:"));
  });
});

test("GATES-SQL-3: ein laufender Anruf aus der Datenbank reisst die Kostendecke fuer den Sprachturn auf Instanz B, das Modell wird nicht gefragt", async (t) => {
  await turnBeiVerbrauch(t, VERBRAUCH_UEBER_DECKE_CENT, async ({ antwort, modell }) => {
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(modell.count(), KEINMAL);
  });
});

test("GATES-SQL-4: bleibt der laufende Anruf aus der Datenbank unter der Kostendecke, fragt der Sprachturn auf Instanz B das Modell", async (t) => {
  await turnBeiVerbrauch(t, VERBRAUCH_UNTER_DECKE_CENT, async ({ antwort, modell }) => {
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(modell.count(), EINMAL);
  });
});

test("GATES-SQL-5: der eigene Sprachturn zaehlt in den laufenden Kosten genau einmal, auch wenn Datenbank und Spiegel ihn beide kennen", async (t) => {
  await turnBeiVerbrauch(t, VERBRAUCH_KNAPP_UNTER_DECKE_CENT, async ({ antwort, modell }) => {
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(modell.count(), EINMAL);
  });
});

test("GATES-SQL-6: ein Anruf, den nur der Spiegel dieser Instanz noch als laufend kennt, wird weiter nicht doppelt gewaehlt", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ a, sql, anbieter }) => {
    const to = ziel();
    const erster = await (await rufeAnMit(a, { to })).json();
    await sql(BEENDET_SQL, [erster.callId]);
    const zweiter = await (await rufeAnMit(a, { to })).json();
    assert.equal(zweiter.deduplicated, true);
    assert.equal(zweiter.callId, erster.callId);
    assert.equal(anbieter.starts().length, EINMAL);
  });
});
