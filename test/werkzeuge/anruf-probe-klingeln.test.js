import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import {
  PROBE_STAGING_TEST_TOKEN,
  PROBE_TELNYX_SCHLUESSEL,
} from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";
import { KLINGELN_GRENZE_S, urteilen } from "../../scripts/anruf-probe/urteil.mjs";

const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const JETZT = Date.parse("2026-11-22T10:00:00.000Z");
const GRUSS =
  "Hallo, hier ist der KI-Assistent von Probe GmbH. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?";

const GUT = {
  annahmeSekunden: 4,
  begruessung: GRUSS,
  begruessungAntwort: true,
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
  ["Klingeln nach 9 s ist grün", { klingelnSekunden: 9 }, []],
  ["Klingeln nach genau der Grenze ist grün", { klingelnSekunden: KLINGELN_GRENZE_S }, []],
  ["Klingeln nach 10,5 s ist zu spät", { klingelnSekunden: 10.5 }, ["klingeln_zu_spaet"]],
  ["Klingeln nach 0 s ist grün", { klingelnSekunden: 0 }, []],
  ["fehlender Wert ist klingeln_fehlt", { klingelnSekunden: undefined }, ["klingeln_fehlt"]],
  ["NaN ist klingeln_fehlt", { klingelnSekunden: Number.NaN }, ["klingeln_fehlt"]],
  [
    "Unendlich ist klingeln_fehlt",
    { klingelnSekunden: Number.POSITIVE_INFINITY },
    ["klingeln_fehlt"],
  ],
  ["negative Zahl ist klingeln_fehlt", { klingelnSekunden: -1 }, ["klingeln_fehlt"]],
  ["Text ist klingeln_fehlt", { klingelnSekunden: "4" }, ["klingeln_fehlt"]],
  ["ohne Schlüssel wird nicht geprüft", {}, []],
];

test("Grenze fürs Klingeln ist 10 Sekunden", () => {
  assert.equal(KLINGELN_GRENZE_S, 10);
});

for (const [name, zusatz, erwartet] of TABELLE) {
  test(`Urteil Klingeln: ${name}`, () => {
    assert.deepEqual(urteilen({ ...GUT, ...zusatz }).gerissen, erwartet);
  });
}

test("Urteil Klingeln: kommt nach dem Ergebnis in der Liste der Befunde", () => {
  const messung = { ...GUT, ergebnisVorgetragen: false, klingelnSekunden: 11, status: "failed" };
  assert.deepEqual(urteilen(messung).gerissen, ["ergebnis_fehlt", "klingeln_zu_spaet", "status"]);
});

function antwort(strukturiert) {
  const koerper = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { isError: false, structuredContent: strukturiert },
  });
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

function anruferMit(gegenanrufe) {
  const uhr = { jetzt: () => JETZT, warte: async () => undefined };
  const abfrage = async (url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    if (name === "place_call") return antwort({ call_id: "c1", status: "dialing" });
    if (name === "list_calls") {
      const eintraege = gegenanrufe.map((eintrag) => ({
        id: eintrag.id,
        direction: eintrag.richtung ?? "inbound",
      }));
      return antwort({ calls: [{ id: "c1", direction: "outbound" }, ...eintraege] });
    }
    const gegen = gegenanrufe.find((eintrag) => eintrag.id === argumente.call_id);
    if (gegen === undefined) return antwort(stand());
    return antwort(
      stand({ call_id: gegen.id, started_at: new Date(JETZT + gegen.nachMs).toISOString() }),
    );
  };
  return anruferBauen({
    basis: BASIS,
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
    uhr,
  });
}

async function geklingelt(gegenanrufe) {
  const anrufer = anruferMit(gegenanrufe);
  await anrufer.anrufen({ ziel: ZIEL });
  return anrufer.klingelnSekunden();
}

test("Anrufer: Gegenanruf 4 s nach dem Probe-Start ergibt 4 Sekunden bis Klingeln", async () => {
  assert.equal(await geklingelt([{ id: "g1", nachMs: 4000 }]), 4);
});

test("Anrufer: Gegenanruf 2500 ms nach dem Start ergibt 2,5 Sekunden", async () => {
  assert.equal(await geklingelt([{ id: "g1", nachMs: 2500 }]), 2.5);
});

test("Anrufer: ohne eingehenden Gegenanruf fehlt der Wert", async () => {
  assert.equal(await geklingelt([]), undefined);
  assert.equal(await geklingelt([{ id: "g1", nachMs: 4000, richtung: "outbound" }]), undefined);
});

test("Anrufer: ein Gegenanruf außerhalb des Zeitfensters zählt nicht, ein älterer wird übersprungen", async () => {
  assert.equal(await geklingelt([{ id: "g1", nachMs: 300001 }]), undefined);
  assert.equal(
    await geklingelt([
      { id: "alt", nachMs: -3600000 },
      { id: "g1", nachMs: 3000 },
    ]),
    3,
  );
});

test("Anrufer: Gegenanruf 90 s nach dem Start ist klingeln_zu_spaet", async () => {
  const sekunden = await geklingelt([{ id: "g1", nachMs: 90000 }]);
  assert.equal(sekunden, 90);
  assert.deepEqual(urteilen({ ...GUT, klingelnSekunden: sekunden }).gerissen, ["klingeln_zu_spaet"]);
});

test("Anrufer: Gegenanruf genau am Rand des Klingel-Fensters zählt, danach nicht", async () => {
  assert.equal(await geklingelt([{ id: "g1", nachMs: 300000 }]), 300);
  assert.equal(await geklingelt([{ id: "g1", nachMs: 300001 }]), undefined);
});

function anruferMitStimmen(nachMs) {
  const uhr = { jetzt: () => JETZT, warte: async () => undefined };
  const abfrage = async (url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    if (name === "place_call") return antwort({ call_id: "c1", status: "dialing" });
    if (name === "list_calls") {
      return antwort({
        calls: [
          { id: "c1", direction: "outbound" },
          { id: "g1", direction: "inbound" },
        ],
      });
    }
    if (argumente.call_id === "c1") return antwort(stand());
    const gegen = { started_at: new Date(JETZT + nachMs).toISOString() };
    const koerper = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: false,
        structuredContent: { ...stand(), ...gegen },
        _meta: { "hermes/stimmen_anzahl": 7 },
      },
    });
    return { ok: true, status: 200, text: async () => koerper };
  };
  return anruferBauen({
    basis: BASIS,
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
    uhr,
  });
}

async function stimmenNach(nachMs) {
  const anrufer = anruferMitStimmen(nachMs);
  await anrufer.anrufen({ ziel: ZIEL });
  return anrufer.stimmenAnzahl();
}

test("Anrufer: Stimmen-Zählung nimmt einen Gegenanruf nach 90 s nicht", async () => {
  assert.equal(await stimmenNach(4000), 7);
  assert.equal(await stimmenNach(60000), 7);
  assert.equal(await stimmenNach(90000), undefined);
});

test("Anrufer: der Rückgabewert von anrufen bleibt ohne klingelnSekunden", async () => {
  const messung = await anruferMit([{ id: "g1", nachMs: 4000 }]).anrufen({ ziel: ZIEL });
  assert.equal(Object.hasOwn(messung, "klingelnSekunden"), false);
});

const MODUL = fileURLToPath(
  new URL("../helpers/anruf-probe-anrufer-klingeln.mjs", import.meta.url),
);
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function dienstStarten() {
  const dienst = createServer((anfrage, rueckgabe) => {
    anfrage.on("data", () => undefined);
    anfrage.on("end", () => {
      rueckgabe.writeHead(anfrage.method === "POST" ? 201 : 200, {
        "content-type": "application/json",
      });
      rueckgabe.end(anfrage.method === "GET" ? "[]" : JSON.stringify({ number: 31 }));
    });
  });
  server.push(dienst);
  return new Promise((fertig) =>
    dienst.listen(0, "127.0.0.1", () => fertig(dienst.address().port)),
  );
}

async function probeLaufen(fall) {
  const port = await dienstStarten();
  const env = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "88",
    GITHUB_SHA: "e".repeat(40),
    GITHUB_API_URL: `http://127.0.0.1:${port}`,
    STAGING_URL: BASIS,
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    STAGING_PROBE_TELNYX_KEY: PROBE_TELNYX_SCHLUESSEL,
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({
      eigeneNummer: ZIEL,
      stand: { erstversuche: 0, anrufe: 0 },
      messung: GUT,
      ...fall,
    }),
    BETTER_STACK_ALERT_URL: `http://127.0.0.1:${port}/geheim-pfad`,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  return { ausgabe, code };
}

const PROBE = [
  ["Klingeln nach 4 s ohne Stimmenlesung ist grün", { klingeln: 4 }, 0, /Probe grün/],
  [
    "Klingeln nach 4 s mit Stimmenlesung ist grün",
    { klingeln: 4, mitStimmen: true },
    0,
    /Probe grün/,
  ],
  [
    "Klingeln nach 12 s ohne Stimmenlesung ist rot klingeln_zu_spaet",
    { klingeln: 12 },
    1,
    /Probe rot: klingeln_zu_spaet/,
  ],
  [
    "Klingeln nach 12 s mit Stimmenlesung ist rot klingeln_zu_spaet",
    { klingeln: 12, mitStimmen: true },
    1,
    /Probe rot: klingeln_zu_spaet/,
  ],
  [
    "ein Lesefehler beim Klingeln ist rot klingeln_fehlt",
    { klingeln: "fehler" },
    1,
    /Probe rot: klingeln_fehlt/,
  ],
];

for (const [name, fall, erwarteterCode, muster] of PROBE) {
  test(`Probe: ${name}`, async () => {
    const { ausgabe, code } = await probeLaufen(fall);
    assert.equal(code, erwarteterCode);
    assert.match(ausgabe, muster);
  });
}
