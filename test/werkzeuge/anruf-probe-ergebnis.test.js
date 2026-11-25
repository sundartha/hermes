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
const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer-ergebnis.mjs", import.meta.url));
const GEHEIMER_INHALT = "Zusammenfassung mit Gespraechsinhalt Zebra";
const GRUSS =
  "Hallo, hier ist der KI-Assistent von Probe GmbH. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?";
const PLATZHALTER = {
  de: "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)",
  en: "(No summary available yet - wait about 5 seconds and call again if needed.)",
  fr: "(Pas encore de résumé disponible - attendez environ 5 secondes et réessayez si besoin.)",
};
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
};

const TABELLE = [
  ["ohne Feld wird wie bisher beurteilt", {}, []],
  ["vorgetragen ist grün", { ergebnisVorgetragen: true }, []],
  ["nicht vorgetragen ist ergebnis_fehlt", { ergebnisVorgetragen: false }, ["ergebnis_fehlt"]],
  ["undefined ist ergebnis_fehlt", { ergebnisVorgetragen: undefined }, ["ergebnis_fehlt"]],
  ["Text statt Wahrheitswert ist ergebnis_fehlt", { ergebnisVorgetragen: "true" }, ["ergebnis_fehlt"]],
  ["ergebnis_fehlt steht vor status", { ergebnisVorgetragen: false, status: "failed" }, ["ergebnis_fehlt", "status"]],
];

for (const [name, abweichung, erwartet] of TABELLE) {
  test(`Ergebnis Urteil: ${name}`, () => {
    const urteil = urteilen({ ...GUT, ...abweichung });
    assert.deepEqual(urteil.gerissen, erwartet);
    assert.equal(urteil.gruen, erwartet.length === 0);
  });
}

function antwort(strukturiert, istFehler = false) {
  const ergebnis = istFehler ? { isError: true, content: [{ type: "text", text: "laeuft" }] } : { isError: false, structuredContent: strukturiert };
  const koerper = JSON.stringify({ jsonrpc: "2.0", id: 1, result: ergebnis });
  return { ok: true, status: 200, text: async () => koerper };
}

function stand() {
  return {
    call_id: "c1",
    status: "completed",
    duration_s: 30,
    started_at: new Date(JETZT).toISOString(),
    answered_at: new Date(JETZT + 4000).toISOString(),
    last_transcript_lines: [`Gegenseite: ${GRUSS}`],
  };
}

function attrappe(ergebnisse) {
  const aufrufe = [];
  let zeit = JETZT;
  const uhr = {
    jetzt: () => zeit,
    warte: async (ms) => {
      zeit += ms;
    },
  };
  const abfrage = async (url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    aufrufe.push({ name, argumente, zeit });
    if (name === "place_call") return antwort({ call_id: "c1", status: "dialing" });
    if (name === "get_call_result") {
      const naechstes = ergebnisse[Math.min(aufrufe.filter((x) => x.name === name).length - 1, ergebnisse.length - 1)];
      return naechstes === "fehler" ? antwort(undefined, true) : antwort(naechstes);
    }
    return antwort(stand());
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

const ZUSAMMENFASSUNG = { call_id: "c1", result_summary: GEHEIMER_INHALT };

const ANRUFER_FAELLE = [
  ["nicht leere Zusammenfassung", [ZUSAMMENFASSUNG], true],
  ["leere Zusammenfassung", [{ call_id: "c1", result_summary: "" }], false],
  ["Leerzeichen als Zusammenfassung", [{ call_id: "c1", result_summary: "  \n " }], false],
  ["Zusammenfassung fehlt", [{ call_id: "c1" }], false],
  ["null als Zusammenfassung", [{ call_id: "c1", result_summary: null }], false],
  ["erst Fehler, dann Zusammenfassung", ["fehler", "fehler", ZUSAMMENFASSUNG], true],
  ["erst leer, dann Zusammenfassung", [{ call_id: "c1", result_summary: "" }, ZUSAMMENFASSUNG], true],
  ["dauerhaft Fehler", ["fehler"], false],
  ...Object.entries(PLATZHALTER).map(([sprache, text]) => [
    `Platzhalter ${sprache} bis zur Frist`,
    [{ call_id: "c1", result_summary: text }],
    false,
  ]),
  [
    "erst Platzhalter, dann Zusammenfassung",
    [{ call_id: "c1", result_summary: PLATZHALTER.de }, ZUSAMMENFASSUNG],
    true,
  ],
];

for (const [name, ergebnisse, erwartet] of ANRUFER_FAELLE) {
  test(`Anrufer Ergebnis: ${name}`, async () => {
    const { anrufer } = attrappe(ergebnisse);
    await anrufer.anrufen({ ziel: ZIEL });
    const wert = await anrufer.ergebnisVorgetragen();
    assert.equal(wert, erwartet);
    assert.doesNotMatch(JSON.stringify(wert), /Zebra/);
  });
}

test("Anrufer Ergebnis: Abfrage im Takt von 2 s, höchstens 60 s lang", async () => {
  const { anrufer, aufrufe } = attrappe(["fehler"]);
  await anrufer.anrufen({ ziel: ZIEL });
  await anrufer.ergebnisVorgetragen();
  const zeiten = aufrufe.filter((x) => x.name === "get_call_result").map((x) => (x.zeit - JETZT) / 1000);
  assert.deepEqual(zeiten.slice(0, 3), [0, 2, 4]);
  assert.equal(zeiten.at(-1), 60);
  assert.equal(zeiten.length, 31);
  assert.equal(aufrufe.find((x) => x.name === "get_call_result").argumente.call_id, "c1");
});

test("Anrufer Ergebnis: eine sofort vorliegende Zusammenfassung wird einmal gelesen", async () => {
  const { anrufer, aufrufe } = attrappe([ZUSAMMENFASSUNG]);
  await anrufer.anrufen({ ziel: ZIEL });
  await anrufer.ergebnisVorgetragen();
  assert.equal(aufrufe.filter((x) => x.name === "get_call_result").length, 1);
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

async function probeLaufen(messungen, umgebung = {}, ergebnisse = [true]) {
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
    STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({
      eigeneNummer: ZIEL,
      stand: { erstversuche: 0, anrufe: 0 },
      messungen,
      stimmen: [1],
      ergebnisse,
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

test("Probe: Ergebnis vorgetragen und alles andere grün ist grün", async () => {
  const { ausgabe, code, vorfaelle } = await probeLaufen([{ ...GUT, ergebnisVorgetragen: true }]);
  assert.equal(code, 0);
  assert.match(ausgabe, /Probe grün/);
  assert.equal(vorfaelle.length, 0);
});

test("Probe: fehlendes Ergebnis ist in beiden Versuchen rot ergebnis_fehlt, Alarm, Exit 1", async () => {
  const { ausgabe, code, vorfaelle } = await probeLaufen([GUT], {}, [false]);
  assert.equal(code, 1);
  assert.match(ausgabe, /Probe rot: ergebnis_fehlt/);
  assert.match(ausgabe, /WARTE 120000/);
  assert.equal(vorfaelle.length, 1);
  assert.doesNotMatch(JSON.stringify(vorfaelle) + ausgabe, /Zebra/);
});

test("Probe: Ergebnis fehlt im Erstversuch, vorhanden in der Wiederholung, ohne Alarm", async () => {
  const { ausgabe, code, vorfaelle } = await probeLaufen([GUT], {}, [false, true]);
  assert.equal(code, 0);
  assert.match(ausgabe, /Erstversuch rot, Wiederholung grün/);
  assert.equal(vorfaelle.length, 0);
});

test("Probe: absichtlich_rot ist rot und erreicht den Alarmweg", async () => {
  const { ausgabe, code, vorfaelle } = await probeLaufen([{ ...GUT, ergebnisVorgetragen: true }], {
    ABSICHTLICH_ROT: "true",
  });
  assert.equal(code, 1);
  assert.match(ausgabe, /Probe rot: messung/);
  assert.equal(vorfaelle.length, 1);
});

const ABFRAGEN = [
  ["Anrufer meldet vorgetragen", [true], 0, /Probe grün/],
  ["Anrufer meldet nicht vorgetragen", [false], 1, /Probe rot: ergebnis_fehlt/],
  ["Lesefehler beim Ergebnis ist rot", ["fehler"], 1, /Probe rot: ergebnis_fehlt/],
];

for (const [name, ergebnisse, code, muster] of ABFRAGEN) {
  test(`Probe Ergebnis aus dem Anrufer: ${name}`, async () => {
    const lauf = await probeLaufen([{ ...GUT }], {}, ergebnisse);
    assert.equal(lauf.code, code);
    assert.match(lauf.ausgabe, muster);
    assert.match(lauf.ausgabe, /ERGEBNIS 1/);
  });
}
