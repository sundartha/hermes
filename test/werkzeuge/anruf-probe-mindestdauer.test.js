import assert from "node:assert/strict";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";
import * as urteil from "../../scripts/anruf-probe/urteil.mjs";

const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const JETZT = Date.parse("2026-11-22T08:01:00.000Z");
const { urteilen } = urteil;
const GRUSS =
  "Hallo, hier ist der KI-Assistent von Probe GmbH. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?";

const GUT = {
  annahmeSekunden: 4,
  begruessung: GRUSS,
  gegenseite: [GRUSS],
  sprache: "de",
  auftraggeber: "Probe GmbH",
  vorname: "Anna",
  richtung: "eingehend",
  dauerSekunden: 30,
  status: "completed",
};

test("Mindestdauer: die Grenze ist 20 Sekunden", () => {
  assert.equal(urteil.MINDESTDAUER_S, 20);
});

const TABELLE = [
  ["19 s ist zu kurz", { dauerSekunden: 19 }, ["zu_kurz"]],
  ["20 s ist grün", { dauerSekunden: 20 }, []],
  ["Dauer unbekannt bleibt nur dauer", { dauerSekunden: undefined }, ["dauer"]],
  ["Antwort nach Gruß fehlt", { begruessungAntwort: false }, ["keine_antwort"]],
  ["Antwort nach Gruß da", { begruessungAntwort: true }, []],
  ["ohne Messfeld wie bisher grün", {}, []],
  [
    "Rückspiel 22.11. 08:01 Stille nach Begrüßung",
    { stillstandSekunden: 8, dauerSekunden: 8, begruessungAntwort: false },
    ["zu_kurz", "keine_antwort"],
  ],
  [
    "Rückspiel 22.11. 13:02 Auflegen ohne Begrüßung (zustand_fehlt)",
    { begruessung: undefined, gegenseite: [], dauerSekunden: 3, status: "failed", begruessungAntwort: false },
    ["begruessung", "zu_kurz", "keine_antwort", "status"],
  ],
];

for (const [name, abweichung, erwartet] of TABELLE) {
  test(`Mindestdauer Urteil: ${name}`, () => {
    const ergebnis = urteilen({ ...GUT, ...abweichung });
    assert.deepEqual(ergebnis.gerissen, erwartet);
    assert.equal(ergebnis.gruen, erwartet.length === 0);
  });
}

test("Mindestdauer Urteil: Rückspiel 13:02 ohne Antwortfeld meldet begruessung, zu_kurz, status", () => {
  const ergebnis = urteilen({ ...GUT, begruessung: undefined, gegenseite: [], dauerSekunden: 3, status: "failed" });
  assert.deepEqual(ergebnis.gerissen, ["begruessung", "zu_kurz", "status"]);
});

function antwort(strukturiert) {
  const rpc = { jsonrpc: "2.0", id: 1, result: { isError: false, structuredContent: strukturiert } };
  return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
}

function stand(abweichung) {
  return {
    call_id: "c1",
    status: "in_progress",
    duration_s: 0,
    started_at: new Date(JETZT).toISOString(),
    answered_at: new Date(JETZT + 4000).toISOString(),
    last_transcript_lines: [],
    failure_reason: null,
    ...abweichung,
  };
}

async function messen(zeilen) {
  const uhr = { zeit: JETZT, jetzt: () => uhr.zeit, warte: async (ms) => (uhr.zeit += ms) };
  const gesendet = [];
  const abfrage = async (url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    gesendet.push({ name, argumente });
    if (name === "place_call") return antwort({ call_id: "c1", status: "dialing" });
    if (name === "cancel_call") return antwort({});
    if (uhr.zeit === JETZT) return antwort(stand({}));
    return antwort(stand({ status: "completed", duration_s: 30, last_transcript_lines: zeilen }));
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
  const messung = await anrufer.anrufen({ ziel: ZIEL });
  return { messung, gesendet };
}

test("Mindestdauer Anrufer: weitere Gegenseite-Zeile nach dem Gruß ergibt begruessungAntwort true", async () => {
  const { messung } = await messen([`Gegenseite: ${GRUSS}`, "Agent: Hallo", "Gegenseite: Ja, gern."]);
  assert.equal(messung.begruessungAntwort, true);
});

test("Mindestdauer Anrufer: nur der Gruß ergibt begruessungAntwort false", async () => {
  const { messung } = await messen([`Gegenseite: ${GRUSS}`, "Agent: Hallo"]);
  assert.equal(messung.begruessungAntwort, false);
});

test("Mindestdauer Anrufer: ohne Gruß ergibt begruessungAntwort false", async () => {
  const { messung } = await messen([]);
  assert.equal(messung.begruessungAntwort, false);
});

test("Mindestdauer Anrufer: das Ziel verlangt 20 s Gespräch statt Auflegen, max_duration_s bleibt 60", async () => {
  const { gesendet } = await messen([]);
  const platziert = gesendet.find((eintrag) => eintrag.name === "place_call").argumente;
  assert.equal(platziert.max_duration_s, 60);
  assert.doesNotMatch(platziert.objective, /auflegen/);
  assert.match(platziert.objective, /mindestens 20 Sekunden/);
});
