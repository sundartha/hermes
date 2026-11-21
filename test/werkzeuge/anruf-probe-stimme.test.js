import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN, PROBE_TELNYX_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";
import { urteilen } from "../../scripts/anruf-probe/urteil.mjs";

const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const JETZT = Date.parse("2026-11-17T10:00:00.000Z");
const COMMIT = "e".repeat(40);
const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer-stimme.mjs", import.meta.url));
const SCHLUESSEL = "hermes/stimmen_anzahl";
const GRUSS =
  "Hallo, hier ist der KI-Assistent von Probe GmbH. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?";
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

const GUT = {
  annahmeSekunden: 4,
  begruessung: GRUSS,
  gegenseite: [GRUSS],
  stillstandSekunden: 4,
  sprache: "de",
  auftraggeber: "Probe GmbH",
  vorname: "Anna",
  richtung: "eingehend",
  dauerSekunden: 30,
  status: "completed",
  stimmenAnzahl: 1,
};

const TABELLE = [
  ["eine Stimme ist grün", { stimmenAnzahl: 1 }, []],
  ["zwei Stimmen sind ein Stimmwechsel", { stimmenAnzahl: 2 }, ["stimmwechsel"]],
  ["drei Stimmen sind ein Stimmwechsel", { stimmenAnzahl: 3 }, ["stimmwechsel"]],
  ["Zahl fehlt ist unklar", { stimmenAnzahl: undefined }, ["stimme_unklar"]],
  ["null ist unklar", { stimmenAnzahl: null }, ["stimme_unklar"]],
  ["Text statt Zahl ist unklar", { stimmenAnzahl: "1" }, ["stimme_unklar"]],
  ["Bruchzahl ist unklar", { stimmenAnzahl: 1.5 }, ["stimme_unklar"]],
  ["null Stimmen sind unklar", { stimmenAnzahl: 0 }, ["stimme_unklar"]],
  ["Stimmwechsel und Status", { stimmenAnzahl: 2, status: "failed" }, ["stimmwechsel", "status"]],
];

for (const [name, abweichung, erwartet] of TABELLE) {
  test(`Stimme Urteil: ${name}`, () => {
    const urteil = urteilen({ ...GUT, ...abweichung });
    assert.deepEqual(urteil.gerissen, erwartet);
    assert.equal(urteil.gruen, erwartet.length === 0);
  });
}

function antwort(strukturiert, meta) {
  const ergebnis = { isError: false, structuredContent: strukturiert, ...(meta === undefined ? {} : { _meta: meta }) };
  const koerper = JSON.stringify({ jsonrpc: "2.0", id: 1, result: ergebnis });
  return { ok: true, status: 200, text: async () => koerper };
}

function stand(abweichung = {}) {
  return {
    call_id: "c1",
    status: "completed",
    duration_s: 30,
    started_at: new Date(JETZT).toISOString(),
    answered_at: new Date(JETZT + 4000).toISOString(),
    last_transcript_lines: [`Gegenseite: ${GRUSS}`],
    ...abweichung,
  };
}

function gegenAnruf(id, verschiebungMs, meta) {
  return { id, started_at: new Date(JETZT + verschiebungMs).toISOString(), meta };
}

function attrappe(gegenanrufe, { richtungen = {} } = {}) {
  const aufrufe = [];
  const uhr = { jetzt: () => JETZT, warte: async () => undefined };
  const abfrage = async (url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    aufrufe.push({ name, argumente });
    if (name === "place_call") return antwort({ call_id: "c1", status: "dialing" });
    if (name === "list_calls") {
      const eintraege = [
        { id: "c1", direction: "outbound", counterparty: ZIEL },
        ...gegenanrufe.map((eintrag) => ({
          id: eintrag.id,
          direction: richtungen[eintrag.id] ?? "inbound",
          counterparty: "+12544670400",
        })),
      ];
      return antwort({ calls: eintraege });
    }
    const gegen = gegenanrufe.find((eintrag) => eintrag.id === argumente.call_id);
    if (gegen === undefined) return antwort(stand());
    return antwort(stand({ call_id: gegen.id, started_at: gegen.started_at }), gegen.meta);
  };
  const anrufer = anruferBauen({
    basis: BASIS,
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
    uhr,
  });
  return { anrufer, aufrufe };
}

async function gelesen(gegenanrufe, optionen) {
  const { anrufer, aufrufe } = attrappe(gegenanrufe, optionen);
  await anrufer.anrufen({ ziel: ZIEL });
  const wert = await anrufer.stimmenAnzahl();
  return { wert, aufrufe };
}

test("Gegen-Anruf: die Zahl steht im _meta der Antwort von get_call_status", async () => {
  const { wert, aufrufe } = await gelesen([gegenAnruf("g1", 2000, { [SCHLUESSEL]: 2 })]);
  assert.equal(wert, 2);
  const abfragen = aufrufe.filter((x) => x.name === "get_call_status").map((x) => x.argumente.call_id);
  assert.deepEqual(abfragen.slice(-1), ["g1"]);
  assert.equal((await gelesen([gegenAnruf("g1", 2000, { [SCHLUESSEL]: 1 })])).wert, 1);
});

test("Gegen-Anruf: ohne Schlüssel im _meta oder ohne _meta fehlt die Zahl", async () => {
  assert.equal((await gelesen([gegenAnruf("g1", 2000, { anderes: 1 })])).wert, undefined);
  assert.equal((await gelesen([gegenAnruf("g1", 2000)])).wert, undefined);
});

test("Gegen-Anruf: ohne eingehenden Anruf fehlt die Zahl, ausgehende Anrufe zählen nicht", async () => {
  assert.equal((await gelesen([])).wert, undefined);
  const { wert, aufrufe } = await gelesen([gegenAnruf("g1", 2000, { [SCHLUESSEL]: 2 })], { richtungen: { g1: "outbound" } });
  assert.equal(wert, undefined);
  assert.equal(aufrufe.some((x) => x.argumente.call_id === "g1"), false);
});

const FENSTER = [
  ["5 s vor dem Start zählt", -5000, 2],
  ["5001 ms vor dem Start zählt nicht", -5001, undefined],
  ["60 s nach dem Start zählt", 60000, 2],
  ["60001 ms nach dem Start zählt nicht", 60001, undefined],
];

for (const [name, verschiebung, erwartet] of FENSTER) {
  test(`Gegen-Anruf Zeitfenster: ${name}`, async () => {
    const { wert } = await gelesen([gegenAnruf("g1", verschiebung, { [SCHLUESSEL]: 2 })]);
    assert.equal(wert, erwartet);
  });
}

test("Gegen-Anruf: ein älterer eingehender Anruf außerhalb des Fensters wird übersprungen", async () => {
  const { wert } = await gelesen([
    gegenAnruf("alt", -3600000, { [SCHLUESSEL]: 2 }),
    gegenAnruf("g1", 1000, { [SCHLUESSEL]: 1 }),
  ]);
  assert.equal(wert, 1);
});

test("Gegen-Anruf: ein Fehler beim Lesen bleibt ein Fehler", async () => {
  const { anrufer } = attrappe([]);
  await anrufer.anrufen({ ziel: ZIEL });
  const kaputt = anruferBauen({
    basis: BASIS,
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    abfrage: async () => ({ ok: false, status: 500, text: async () => "" }),
  });
  await assert.rejects(kaputt.stimmenAnzahl(), /mcp_http_500/);
});

function dienstStarten(behandeln) {
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => behandeln(anfrage, Buffer.concat(teile).toString(), rueckgabe));
  });
  server.push(dienst);
  return new Promise((fertig) => dienst.listen(0, "127.0.0.1", () => fertig(dienst.address().port)));
}

async function probeLaufen(stimmen, umgebung = {}) {
  const vorfaelle = [];
  const betterStack = await dienstStarten((anfrage, roh, rueckgabe) => {
    vorfaelle.push(JSON.parse(roh));
    rueckgabe.writeHead(200);
    rueckgabe.end();
  });
  const github = await dienstStarten((anfrage, roh, rueckgabe) => {
    rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    rueckgabe.end(anfrage.method === "GET" ? "[]" : JSON.stringify({ number: 31 }));
  });
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "88",
    GITHUB_SHA: COMMIT,
    GITHUB_API_URL: `http://127.0.0.1:${github}`,
    STAGING_URL: BASIS,
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({
      eigeneNummer: ZIEL,
      stand: { erstversuche: 0, anrufe: 0 },
      messungen: [{ ...GUT, stimmenAnzahl: undefined }],
      stimmen,
    }),
    BETTER_STACK_ALERT_URL: `http://127.0.0.1:${betterStack}/geheim-pfad`,
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  return { ausgabe, code, vorfaelle };
}

test("Probe: eine Stimme am Gegen-Anruf ist grün, ohne Alarm", async () => {
  const { ausgabe, code, vorfaelle } = await probeLaufen([1]);
  assert.equal(code, 0);
  assert.match(ausgabe, /Probe grün/);
  assert.equal(vorfaelle.length, 0);
});

test("Probe: zwei Stimmen sind in beiden Versuchen rot stimmwechsel und gehen an den Alarmweg", async () => {
  const { ausgabe, code, vorfaelle } = await probeLaufen([2]);
  assert.equal(code, 1);
  assert.match(ausgabe, /Probe rot: stimmwechsel/);
  assert.match(ausgabe, /WARTE 120000/);
  assert.equal(vorfaelle.length, 1);
});

test("Probe: fehlende Zahl oder Lesefehler ist rot stimme_unklar", async () => {
  for (const stimmen of [[undefined], ["fehler"]]) {
    const { ausgabe, code, vorfaelle } = await probeLaufen(stimmen);
    assert.equal(code, 1);
    assert.match(ausgabe, /Probe rot: stimme_unklar/);
    assert.equal(vorfaelle.length, 1);
  }
});

test("Probe: Stimmwechsel im Erstversuch, eine Stimme in der Wiederholung bleibt ohne Alarm", async () => {
  const { ausgabe, code, vorfaelle } = await probeLaufen([2, 1]);
  assert.equal(code, 0);
  assert.match(ausgabe, /Erstversuch rot, Wiederholung grün/);
  assert.equal(vorfaelle.length, 0);
});

test("Probe: absichtlich_rot ist auch mit einer Stimme rot und erreicht den Alarmweg", async () => {
  const { ausgabe, code, vorfaelle } = await probeLaufen([1], { ABSICHTLICH_ROT: "true" });
  assert.equal(code, 1);
  assert.doesNotMatch(ausgabe, /STIMMEN/);
  assert.match(ausgabe, /Probe rot: messung/);
  assert.equal(vorfaelle.length, 1);
});
