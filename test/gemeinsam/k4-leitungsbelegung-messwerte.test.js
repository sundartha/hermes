import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { config } from "../../src/config.js";
import { leitungsplaetze, makeLeitungsplaetze, oeffneSpeicher } from "../../src/store.js";
import { makeConfigOverrides } from ".././helpers.js";
import { mitVerbindung } from ".././gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from ".././gemeinsam/test-rolle.js";
import { startEmpfaenger, warteAufExport } from ".././gemeinsam/otlp-empfaenger.js";

const { withConfig } = makeConfigOverrides(config);
const TOKEN = "t".repeat(20);
const BELEGT = "hermes.lines.occupied";
const KAPAZITAET = "hermes.lines.capacity";
const POOL = "hermes.db.pool.open";
const EXPORT_INTERVALL_MS = 50;
const SEKUNDE_MS = 1000;
const TELNYX_KAPAZITAET = 100;
const ELEVENLABS_KAPAZITAET = 6;
const ABLAUF_S = 600;

const anruf = (nummer, weg) => ({ callId: `call_geheim_${nummer}`, tenantId: "tenant_geheim", weg, maxDauerS: ABLAUF_S });

async function mitMessung(optionen, lauf) {
  const empfaenger = await startEmpfaenger();
  const warnungen = mock.method(console, "warn", () => {});
  const telemetrie = await starteTelemetrie({
    url: empfaenger.url,
    token: TOKEN,
    intervallMs: EXPORT_INTERVALL_MS,
    poolZustand: () => ({ offen: 1, wartend: 0 }),
    ...optionen,
  });
  try {
    return await lauf({ empfaenger, meldungen: () => warnungen.mock.calls.map((a) => a.arguments[0]) });
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
    warnungen.mock.restore();
  }
}

const labelSchluessel = (punkt) => punkt.attributes.map((a) => a.key);
const anbieterVon = (punkt) => {
  const label = punkt.attributes.find((a) => a.key === "anbieter");
  return label.value.stringValue;
};
const jeAnbieter = (punkte) => Object.fromEntries(punkte.map((p) => [anbieterVon(p), Number(p.asDouble ?? p.asInt)]));

async function postgresPlaetze(t) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return null;
  await withConfig("storeBackend", "pg", () => withConfig("databaseUrl", db.adresse, oeffneSpeicher));
  const verwaltung = new URL(process.env.HERMES_TEST_POSTGRES_URL);
  verwaltung.pathname = new URL(db.adresse).pathname;
  return {
    plaetze: leitungsplaetze,
    sql: (text, parameter) => mitVerbindung(verwaltung.href, (verbindung) => verbindung.query(text, parameter)),
  };
}

const gefuellt = async (plaetze) => {
  await plaetze.belegenAusgehend(anruf(1, "elevenlabs"));
  await plaetze.belegenAusgehend(anruf(2, "telnyx"));
  await plaetze.belegenAusgehend(anruf(3, "telnyx"));
};

async function pruefeBelegung(belegung, erwartetBelegt) {
  await mitMessung({ leitungsplaetzeBelegung: belegung }, async ({ empfaenger }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[BELEGT] && m[KAPAZITAET]);
    assert.deepEqual(jeAnbieter(werte[BELEGT].punkte), erwartetBelegt);
    assert.deepEqual(jeAnbieter(werte[KAPAZITAET].punkte), {
      telnyx: TELNYX_KAPAZITAET,
      elevenlabs: ELEVENLABS_KAPAZITAET,
    });
    const alles = JSON.stringify(empfaenger.exporte);
    for (const fremd of ["call_geheim", "tenant_geheim"]) assert.ok(!alles.includes(fremd));
    const schluessel = [BELEGT, KAPAZITAET].flatMap((m) => werte[m].punkte).map(labelSchluessel);
    assert.deepEqual([...new Set(schluessel.flat())], ["anbieter"]);
  });
}

test("K4-H2-1: belegte Plätze und Kapazität je Anbieter stehen aus der Datenbank in der Telemetrie", async (t) => {
  const umgebung = await postgresPlaetze(t);
  if (!umgebung) return;
  const { plaetze, sql } = umgebung;
  await pruefeBelegung(plaetze.belegung, { telnyx: 0, elevenlabs: 0 });
  await gefuellt(plaetze);
  await pruefeBelegung(plaetze.belegung, { telnyx: 3, elevenlabs: 1 });
  assert.deepEqual(await plaetze.belegung(), [
    { anbieter: "telnyx", belegt: 3, kapazitaet: TELNYX_KAPAZITAET },
    { anbieter: "elevenlabs", belegt: 1, kapazitaet: ELEVENLABS_KAPAZITAET },
  ]);
  await plaetze.freigeben("call_geheim_2");
  await sql("UPDATE leitungsplatz SET ablauf_um = now() - interval '1 minute' WHERE call_id = $1", ["call_geheim_3"]);
  await pruefeBelegung(plaetze.belegung, { telnyx: 1, elevenlabs: 1 });
});

test("K4-H2-4: der Speicher-Adapter meldet dieselben Werte, abgelaufene Plätze zählen nicht", async () => {
  let jetztMs = 0;
  const plaetze = makeLeitungsplaetze({ jetztMs: () => jetztMs });
  await gefuellt(plaetze);
  await pruefeBelegung(plaetze.belegung, { telnyx: 3, elevenlabs: 1 });
  jetztMs += (ABLAUF_S + 120 + 1) * SEKUNDE_MS;
  await pruefeBelegung(plaetze.belegung, { telnyx: 0, elevenlabs: 0 });
});

test("K4-H2-5: fällt die Datenbank aus, wird geloggt und geschluckt, die übrigen Messwerte kommen weiter", async () => {
  const belegung = async () => {
    throw new Error("Datenbank nicht erreichbar");
  };
  await mitMessung({ leitungsplaetzeBelegung: belegung }, async ({ empfaenger, meldungen }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[POOL]);
    assert.equal(werte[BELEGT], undefined);
    assert.ok(meldungen().includes("[betriebsmessung] leitungen fehlgeschlagen: Datenbank nicht erreichbar"));
  });
});

test("K4-H2-6: ohne Messmöglichkeit gibt es keine Leitungs-Messwerte", async () => {
  await mitMessung({}, async ({ empfaenger, meldungen }) => {
    const werte = await warteAufExport(empfaenger, (m) => m[POOL]);
    assert.deepEqual(meldungen().filter((m) => String(m).includes("leitungen")), []);
    assert.equal(werte[BELEGT], undefined);
    assert.equal(werte[KAPAZITAET], undefined);
  });
});

test("K4-H2-7: ohne Telemetrie wird die Datenbank nicht gefragt", async () => {
  let aufrufe = 0;
  const telemetrie = await starteTelemetrie({
    leitungsplaetzeBelegung: async () => {
      aufrufe += 1;
      return [];
    },
  });
  assert.equal(telemetrie.aktiv, false);
  assert.equal(aufrufe, 0);
});

test("K4-H2-8: die Fassade des Speichers reicht die Belegung durch, auch ohne geöffnete Datenbank", async () => {
  const { leitungsplaetze: ungeoeffnet } = await import("../../src/store.js?fassade");
  assert.deepEqual(await ungeoeffnet.belegung(), [
    { anbieter: "telnyx", belegt: 0, kapazitaet: TELNYX_KAPAZITAET },
    { anbieter: "elevenlabs", belegt: 0, kapazitaet: ELEVENLABS_KAPAZITAET },
  ]);
});
