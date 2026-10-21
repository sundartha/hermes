import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const VERBINDUNG_WEG = "API Error: Connection dropped (ECONNRESET)";
const OHNE_WARTEN = { HERMES_NETZ_WARTEZEITEN_MS: "[0,0,0,0]" };
const WIEDERHOLUNGEN = 4;
const RUNDEN_BIS_ENTSCHEIDUNG = 2;
const AUSFAELLE_IN_ALLEN_RUNDEN = (WIEDERHOLUNGEN + 1) * RUNDEN_BIS_ENTSCHEIDUNG;
const MS_JE_SEKUNDE = 1000;
const LIMIT_IN_SEKUNDEN = 1;
const SPERRE_MS = 1500;
const GLEICHE_AUFRUFE_BIS_STILLSTAND = 3;
const KONTEXT_VOR_DEM_ABBRUCH = 5000;
const GRUEN = {
  test: { "test/rechnen.test.js": ROTER_TEST },
  bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  "notiz-antwort": "1. Werkzeug prüfen",
};
const IMMER = (ausfall) => Array.from({ length: AUSFAELLE_IN_ALLEN_RUNDEN }, () => ausfall);
const GLEICHER_AUFRUF = [
  { type: "assistant", message: { content: [{ type: "tool_use", id: "wiederholt", name: "Bash", input: { command: "ls" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "wiederholt", content: "gleich" }] } },
];
const STILLSTAND = Array.from({ length: GLEICHE_AUFRUFE_BIS_STILLSTAND }, () => GLEICHER_AUFRUF).flat();

function lauf(context, ausfaelle) {
  return starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { ...GRUEN, "test-ausfall": ausfaelle }, umgebung: OHNE_WARTEN });
}

function starts({ werkzeug }, rolle) {
  const zeilen = readFileSync(join(werkzeug, "starts.jsonl"), "utf8").split("\n").filter(Boolean);
  return zeilen.map((zeile) => JSON.parse(zeile)).filter((eintrag) => eintrag.rolle === rolle);
}

function berichtszeilen({ lauf }, rolle) {
  return lauf.stdout.split("\n").filter((zeile) => zeile.startsWith("  Agent ") && zeile.includes(`(${rolle})`));
}

function wiederholungen({ beleg }) {
  return beleg.agenten.flatMap((agent) => agent.netzabbrueche ?? []);
}

function pruefeOhneWiederholung(probe) {
  const [abgebrochen, ...spaeter] = starts(probe, "test");
  assert.deepEqual(spaeter.filter(({ sitzung }) => sitzung === abgebrochen.sitzung), []);
  assert.deepEqual(wiederholungen(probe), []);
}

test("ein Netzabbruch des Test-Agenten setzt dieselbe Sitzung fort, der Lauf wird grün und die Wiederholung steht im Beleg", (context) => {
  const probe = lauf(context, [{ text: VERBINDUNG_WEG }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  assert.equal(probe.beleg.ergebnis, "grün");
  assert.equal(probe.beleg.runde, 1);
  const [erster, zweiter, ...weitere] = starts(probe, "test");
  assert.deepEqual(weitere, []);
  assert.deepEqual([erster.fortsetzung, zweiter.fortsetzung, zweiter.sitzung], [false, true, erster.sitzung]);
  const eintraege = wiederholungen(probe);
  assert.equal(eintraege.length, 1);
  const [{ zeit, ...eintrag }] = eintraege;
  assert.deepEqual(eintrag, { rolle: "test", sitzung: erster.sitzung, versuch: 1, fehler: VERBINDUNG_WEG, warteS: 0 });
  assert.match(zeit, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(probe.lauf.stdout.includes(erster.sitzung), probe.lauf.stdout);
});

test("zwei Netzabbrüche hintereinander wie in Lauf 26 kosten weder die Runde noch eine Entscheidung", (context) => {
  const probe = lauf(context, [{ text: VERBINDUNG_WEG }, { text: VERBINDUNG_WEG }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  assert.equal(probe.beleg.ergebnis, "grün");
  assert.deepEqual(wiederholungen(probe).map(({ versuch }) => versuch), [1, 2]);
  assert.deepEqual(starts(probe, "test").map(({ fortsetzung }) => fortsetzung), [false, true, true]);
});

test("ein Netzabbruch nach dem anderen über alle Wartezeiten hinaus endet wie bisher als Werkzeugabbruch und zeigt jede Wiederholung", (context) => {
  const probe = lauf(context, IMMER({ text: VERBINDUNG_WEG }));
  assert.equal(probe.lauf.status, EXIT_ROT);
  assert.match(probe.beleg.grund, /endete mit Exit 1/);
  assert.deepEqual(wiederholungen(probe).map(({ versuch }) => versuch), [1, 2, 3, 4]);
  const ersteSitzung = starts(probe, "test").slice(0, WIEDERHOLUNGEN + 1);
  assert.deepEqual(ersteSitzung.map(({ fortsetzung }) => fortsetzung), [false, true, true, true, true]);
  assert.equal(new Set(ersteSitzung.map(({ sitzung }) => sitzung)).size, 1);
});

test("ein anderer API-Fehler mit Exit 1 wird nicht wiederholt", (context) => {
  const probe = lauf(context, IMMER({ text: "API Error: 400 invalid_request_error" }));
  assert.equal(probe.lauf.status, EXIT_ROT);
  assert.match(probe.beleg.grund, /endete mit Exit 1/);
  pruefeOhneWiederholung(probe);
});

test("ein Netzabbruch nach einer Dateiänderung des Agenten wird nicht wiederholt", (context) => {
  const probe = lauf(context, [{ text: VERBINDUNG_WEG, dateien: { "test/rechnen.test.js": ROTER_TEST } }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  pruefeOhneWiederholung(probe);
});

test("ein Netzabbruch nach einem Commit des Agenten wird nicht wiederholt", (context) => {
  const probe = lauf(context, [{ text: VERBINDUNG_WEG, dateien: { "test/rechnen.test.js": ROTER_TEST }, festhalten: true }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  pruefeOhneWiederholung(probe);
});

test("ein Netzabbruch nach einer Änderung an den Belegen wird nicht wiederholt", (context) => {
  const probe = lauf(context, [{ text: VERBINDUNG_WEG, dateien: { ".fortschritt/probe/fremd.json": "{}\n" } }]);
  pruefeOhneWiederholung(probe);
});

test("ein Netzabbruch, nachdem der Agent schon Kontext aufgebaut hat, wird nicht wiederholt", (context) => {
  const gearbeitet = { type: "assistant", message: { content: [{ type: "text", text: "Ich lese." }], usage: { input_tokens: KONTEXT_VOR_DEM_ABBRUCH, output_tokens: 20 } } };
  const probe = lauf(context, [{ text: VERBINDUNG_WEG, zeilen: [gearbeitet] }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  pruefeOhneWiederholung(probe);
});

test("steht der Verbindungsfehler nur als eine Zeile in einem längeren Text, wird nicht wiederholt", (context) => {
  const probe = lauf(context, [{ text: `Ich habe das Repository gelesen.\n${VERBINDUNG_WEG}` }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  pruefeOhneWiederholung(probe);
});

test("ein Netzabbruch, der zugleich ein Nutzungslimit meldet, wird nicht wiederholt", (context) => {
  const limit = [
    { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.ceil(Date.now() / MS_JE_SEKUNDE) + LIMIT_IN_SEKUNDEN } },
    { type: "result", is_error: true, result: "Usage limit reached" },
  ];
  const probe = lauf(context, [{ text: VERBINDUNG_WEG, zeilen: limit }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  pruefeOhneWiederholung(probe);
});

test("ein Netzabbruch, nachdem der Wächter den Agenten wegen Stillstand beendet hat, wird nicht wiederholt", (context) => {
  const probe = lauf(context, IMMER({ text: VERBINDUNG_WEG, zeilen: STILLSTAND }));
  assert.equal(probe.lauf.status, EXIT_ROT);
  pruefeOhneWiederholung(probe);
});

test("die Wiederholung nach einem Netzabbruch wartet, bis die gemeinsame Limit-Sperre abgelaufen ist", (context) => {
  const probe = lauf(context, [{ text: VERBINDUNG_WEG, sperreMs: SPERRE_MS }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  const [erster, zweiter] = starts(probe, "test");
  assert.equal(zweiter.fortsetzung, true);
  assert.ok(zweiter.zeit >= erster.sperreBis, `${zweiter.zeit} < ${erster.sperreBis}`);
});

test("der Bericht am Ende des Laufs zeigt jede Wiederholung mit Versuch und Fehler", (context) => {
  const probe = lauf(context, [{ text: VERBINDUNG_WEG }, { text: VERBINDUNG_WEG }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  const [ersterVersuch, zweiterVersuch, ergebnis] = berichtszeilen(probe, "test");
  assert.ok(ersterVersuch.includes(`Versuch 1: ${VERBINDUNG_WEG}`), ersterVersuch);
  assert.ok(zweiterVersuch.includes(`Versuch 2: ${VERBINDUNG_WEG}`), zweiterVersuch);
  assert.ok(ergebnis.includes("Exit 0"), ergebnis);
});
