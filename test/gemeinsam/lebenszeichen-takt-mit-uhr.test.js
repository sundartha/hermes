import net from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { echtWarten } from "../echt-warten.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { starteLebenszeichen } from "../../src/lebenszeichen.js";

const MELDE_ADRESSE = "https://herzschlag.example.test/api/v1/heartbeat/erfundenes-token";
const TAKT_MS = 1000;
const GRENZE_MS = 20;
const FRIST_MS = 60000;
const KEIN_VERZUG_MS = 0;
const UEBER_DER_GRENZE_MS = GRENZE_MS + 1;
const UNTER_DER_GRENZE_MS = GRENZE_MS - 1;
const LANGE_FRIST_MS = 60000;
const NS_JE_MS = 1e6;

const GROESSTER_UNGERUNDETER_MESSWERT_NS = 2047;
const GRENZE_GENAU_AM_MESSWERT_MS = GROESSTER_UNGERUNDETER_MESSWERT_NS / NS_JE_MS;

const JSON_SPEICHER = { storeBackend: "json" };
const SCHLEIFENDURCHGAENGE = 5;

const KURZE_FRIST_MS = 50;
const NACHLAUF_MS = 200;
const FRIST_ZEILE = /\[lebenszeichen\] [^:]+: FRIST$/;
const LOGZEILE_MIT_GRUND = /\[lebenszeichen\] [^:]+: \S+$/;

const ZUSTAENDE = [
  {
    fall: "kein Verzug",
    messVerzugMs: KEIN_VERZUG_MS,
    taktVerzugMs: KEIN_VERZUG_MS,
    grenzeMs: GRENZE_MS,
    meldungen: 1,
  },
  {
    fall: "nur der Höchstwert des Messtakts über der Grenze",
    messVerzugMs: UEBER_DER_GRENZE_MS,
    taktVerzugMs: KEIN_VERZUG_MS,
    grenzeMs: GRENZE_MS,
    meldungen: 0,
  },
  {
    fall: "nur der Takt-Verzug über der Grenze",
    messVerzugMs: KEIN_VERZUG_MS,
    taktVerzugMs: UEBER_DER_GRENZE_MS,
    grenzeMs: GRENZE_MS,
    meldungen: 0,
  },
  {
    fall: "beide Messwerte über der Grenze",
    messVerzugMs: UEBER_DER_GRENZE_MS,
    taktVerzugMs: UEBER_DER_GRENZE_MS,
    grenzeMs: GRENZE_MS,
    meldungen: 0,
  },
  {
    fall: "beide Messwerte knapp unter der Grenze",
    messVerzugMs: UNTER_DER_GRENZE_MS,
    taktVerzugMs: UNTER_DER_GRENZE_MS,
    grenzeMs: GRENZE_MS,
    meldungen: 1,
  },
  {
    fall: "Takt-Verzug genau auf der Grenze",
    messVerzugMs: KEIN_VERZUG_MS,
    taktVerzugMs: GRENZE_MS,
    grenzeMs: GRENZE_MS,
    meldungen: 1,
  },
  {
    fall: "Höchstwert des Messtakts genau auf der Grenze",
    messVerzugMs: GRENZE_GENAU_AM_MESSWERT_MS,
    taktVerzugMs: KEIN_VERZUG_MS,
    grenzeMs: GRENZE_GENAU_AM_MESSWERT_MS,
    meldungen: 1,
  },
];

const FEHLERARTEN = [
  {
    grund: "Netzfehler mit Code in der Ursache",
    ausgeloest: Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
    erwartet: "ECONNREFUSED",
  },
  {
    grund: "Fehler mit eigenem Code",
    ausgeloest: Object.assign(new Error("zu lang"), { code: "ETIMEDOUT" }),
    erwartet: "ETIMEDOUT",
  },
  {
    grund: "Fehler ohne Code, nur mit Namen",
    ausgeloest: new DOMException("abgelaufen", "TimeoutError"),
    erwartet: "TimeoutError",
  },
  { grund: "nichts ausgelöst", ausgeloest: undefined, erwartet: null },
  { grund: "null ausgelöst", ausgeloest: null, erwartet: null },
  { grund: "Objekt ohne Namen ausgelöst", ausgeloest: {}, erwartet: null },
];

const GELUNGENE_ANTWORT = async () => ({ ok: true, body: null });

function starteMitUhr(
  t,
  {
    grenzeMs = GRENZE_MS,
    speicher = JSON_SPEICHER,
    fristMs = FRIST_MS,
    antwort = GELUNGENE_ANTWORT,
  },
) {
  const uhr = { jetztMs: 0 };
  let letzteMessungMs = 0;
  let letzterTaktMs = 0;
  const takte = [];
  const gemeldet = [];
  const warnungen = [];
  t.mock.method(performance, "now", () => uhr.jetztMs);
  t.mock.method(globalThis, "setInterval", (aufruf, dauerMs) => {
    const takt = { aufruf, dauerMs };
    takte.push(takt);
    return { unref: () => takt };
  });
  t.mock.method(globalThis, "fetch", async (adresse) => {
    gemeldet.push(adresse);
    return antwort();
  });
  t.mock.method(console, "warn", (zeile) => warnungen.push(String(zeile)));
  starteLebenszeichen(
    {
      herzschlagUrl: MELDE_ADRESSE,
      herzschlagTaktMs: TAKT_MS,
      herzschlagVerzugGrenzeMs: grenzeMs,
      herzschlagFristMs: fristMs,
    },
    speicher,
  );
  const herzschlag = takte.find(({ dauerMs }) => dauerMs === TAKT_MS);
  const messung = takte.find(({ dauerMs }) => dauerMs !== TAKT_MS);
  assert.ok(herzschlag, "Lebenszeichen: der Herzschlag-Takt wird nicht gestartet");
  assert.ok(messung, "Lebenszeichen: der Messtakt wird nicht gestartet");
  return {
    gemeldet,
    warnungen,
    async vergehenLassen({ messVerzugMs, taktVerzugMs }) {
      uhr.jetztMs = letzteMessungMs + messung.dauerMs + messVerzugMs;
      letzteMessungMs = uhr.jetztMs;
      messung.aufruf();
      uhr.jetztMs = letzterTaktMs + TAKT_MS + taktVerzugMs;
      letzterTaktMs = uhr.jetztMs;
      await herzschlag.aufruf();
      for (let durchgang = 0; durchgang < SCHLEIFENDURCHGAENGE; durchgang += 1) {
        await new Promise((fertig) => setImmediate(fertig));
      }
    },
  };
}

for (const { fall, messVerzugMs, taktVerzugMs, grenzeMs, meldungen } of ZUSTAENDE) {
  test(`Lebenszeichen: Takt mit ${fall} meldet ${meldungen === 0 ? "nicht" : "gesund"}`, async (t) => {
    const dienst = starteMitUhr(t, { grenzeMs });
    await dienst.vergehenLassen({ messVerzugMs, taktVerzugMs });
    assert.equal(
      dienst.gemeldet.length,
      meldungen,
      `Lebenszeichen: ${fall}, gemeldet wurde ${dienst.gemeldet.length}-mal`,
    );
  });
}

test("Lebenszeichen: nach einem Takt mit Verzug über der Grenze meldet der nächste gesunde Takt wieder", async (t) => {
  const dienst = starteMitUhr(t, {});
  const krank = { messVerzugMs: UEBER_DER_GRENZE_MS, taktVerzugMs: UEBER_DER_GRENZE_MS };
  const gesund = { messVerzugMs: KEIN_VERZUG_MS, taktVerzugMs: KEIN_VERZUG_MS };
  await dienst.vergehenLassen(krank);
  assert.equal(dienst.gemeldet.length, 0, "Lebenszeichen: kranker Takt meldet gesund");
  await dienst.vergehenLassen(gesund);
  assert.equal(
    dienst.gemeldet.length,
    1,
    "Lebenszeichen: der Verzug wirkt über seinen Takt hinaus",
  );
});

for (const { grund, ausgeloest, erwartet } of FEHLERARTEN) {
  test(`Lebenszeichen: eine Meldung, die mit ${grund} scheitert, ergibt genau eine Logzeile mit Grund`, async (t) => {
    const dienst = starteMitUhr(t, {
      antwort: async () => {
        throw ausgeloest;
      },
    });
    await dienst.vergehenLassen({ messVerzugMs: KEIN_VERZUG_MS, taktVerzugMs: KEIN_VERZUG_MS });
    assert.equal(dienst.warnungen.length, 1, "Lebenszeichen: gescheiterte Meldung ohne Logzeile");
    assert.match(dienst.warnungen[0], LOGZEILE_MIT_GRUND, "Lebenszeichen: Logzeile ohne Grund");
    if (erwartet !== null) assert.ok(dienst.warnungen[0].endsWith(` ${erwartet}`));
    assert.equal(dienst.warnungen[0].includes(MELDE_ADRESSE), false, "Adresse steht im Log");
  });
}

function offeneTimer() {
  return process.getActiveResourcesInfo().filter((art) => art === "Timeout").length;
}

test("Lebenszeichen: die Datenbankprüfung hinterlässt nach jedem Takt keinen offenen Fristtimer", async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const dienst = starteMitUhr(t, {
    speicher: { storeBackend: "pg", databaseUrl: db.adresse },
    fristMs: LANGE_FRIST_MS,
  });
  const vorher = offeneTimer();
  for (let takt = 0; takt < SCHLEIFENDURCHGAENGE; takt += 1) {
    await dienst.vergehenLassen({ messVerzugMs: KEIN_VERZUG_MS, taktVerzugMs: KEIN_VERZUG_MS });
  }
  await echtWarten(SCHLEIFENDURCHGAENGE * SCHLEIFENDURCHGAENGE);
  assert.equal(dienst.gemeldet.length, SCHLEIFENDURCHGAENGE, "Lebenszeichen: Prüfung gescheitert");
  assert.equal(offeneTimer(), vorher, "Lebenszeichen: Fristtimer bleibt nach der Prüfung offen");
});

function offeneSockets() {
  return process.getActiveResourcesInfo().filter((art) => art === "TCPSocketWrap").length;
}

async function starteSchweigendenServer(t) {
  const verbindungen = new Set();
  const server = net.createServer({ allowHalfOpen: true }, (verbindung) => {
    verbindungen.add(verbindung);
    verbindung.unref();
    verbindung.resume();
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  server.unref();
  t.after(() => {
    for (const verbindung of verbindungen) verbindung.destroy();
    server.close();
  });
  return `postgres://lebenszeichen@127.0.0.1:${server.address().port}/ohne-antwort`;
}

test("Lebenszeichen: die Prüfung gibt die Verbindung zu einer nie antwortenden Datenbank nach der Frist frei", async (t) => {
  const adresse = await starteSchweigendenServer(t);
  const dienst = starteMitUhr(t, {
    speicher: { storeBackend: "pg", databaseUrl: adresse },
    fristMs: KURZE_FRIST_MS,
  });
  const vorher = offeneSockets();
  await dienst.vergehenLassen({ messVerzugMs: KEIN_VERZUG_MS, taktVerzugMs: KEIN_VERZUG_MS });
  await echtWarten(NACHLAUF_MS);
  assert.equal(dienst.gemeldet.length, 0, "Lebenszeichen: schweigende Datenbank meldet gesund");
  assert.equal(dienst.warnungen.length, 1, "Lebenszeichen: Prüfung ohne Logzeile");
  assert.match(dienst.warnungen[0], FRIST_ZEILE, "Lebenszeichen: Logzeile nennt die Frist nicht");
  assert.equal(offeneSockets(), vorher, "Lebenszeichen: Verbindung bleibt nach der Frist offen");
});
