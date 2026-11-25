import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN, PROBE_ZUGANG_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer.mjs", import.meta.url));
const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const urspruenglich = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = urspruenglich;
});

function schritt(name) {
  const treffer = WORKFLOW.match(new RegExp(`^      - name: ${name}[^\\n]*\\n([\\s\\S]*?)(?=^      - name:|^  [a-z]+:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(treffer, `Schritt ${name} fehlt`);
  return treffer[1];
}

function probeStarten(umgebung) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "d".repeat(40),
    STAGING_URL: BASIS,
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: PROBE_ZUGANG_SCHLUESSEL,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: ZIEL, offene: 0 }),
    ...umgebung,
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs", "auflegen"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

test("Anrufer ruft die enge Probe-Schnittstelle mit dem Probe-Wert auf, nicht /mcp", async () => {
  const aufrufe = [];
  globalThis.fetch = async (url, optionen) => {
    aufrufe.push({ url, optionen });
    const rpc = { jsonrpc: "2.0", id: 1, result: { structuredContent: { number: ZIEL } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
  };
  Object.assign(process.env, {
    STAGING_URL: BASIS,
    STAGING_PROBE_TOKEN: PROBE_ZUGANG_SCHLUESSEL,
    STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_ZIEL: ZIEL,
  });
  const modul = await import("../../scripts/anruf-probe/anrufer.mjs");
  assert.equal(await modul.anrufer.eigeneNummer(), ZIEL);
  assert.equal(aufrufe[0].url, `${BASIS}/intern/probe/mcp`);
  const { headers } = aufrufe[0].optionen;
  assert.equal(headers.authorization, `Bearer ${PROBE_ZUGANG_SCHLUESSEL}`);
});

test("Ohne STAGING_PROBE_TOKEN im Push-Lauf: Aufräumen übersprungen mit dem neuen Namen", async () => {
  const ergebnis = await probeStarten({ GITHUB_EVENT_NAME: "push", STAGING_PROBE_TOKEN: "", STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN });
  assert.equal(ergebnis.code, 0);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_token_fehlt/);
  assert.ok(!ergebnis.ausgabe.includes("AUFGELEGT"));
});

test("Ohne STAGING_PROBE_TOKEN im Zeitplan-Lauf: rot, auch wenn STAGING_TEST_TOKEN gesetzt ist", async () => {
  const ergebnis = await probeStarten({ GITHUB_EVENT_NAME: "schedule", STAGING_PROBE_TOKEN: "", STAGING_TEST_TOKEN: PROBE_STAGING_TEST_TOKEN });
  assert.equal(ergebnis.code, 1);
  assert.match(ergebnis.ausgabe, /probe_uebersprungen_staging_probe_token_fehlt/);
});

test("Workflow: beide Probe-Schritte reichen STAGING_PROBE_TOKEN durch und nicht den Wert des Lastlaufs", () => {
  for (const name of ["Anrufprobe", "Offene Probe-Anrufe beenden"]) {
    const text = schritt(name);
    assert.ok(text.includes("STAGING_PROBE_TOKEN: ${{ secrets.STAGING_PROBE_TOKEN }}"), name);
    assert.ok(!text.includes("STAGING_TEST_TOKEN"), name);
  }
});

test("Workflow: der Lastlauf behält STAGING_TEST_TOKEN", () => {
  assert.ok(schritt("Lastlauf").includes("STAGING_TEST_TOKEN: ${{ secrets.STAGING_TEST_TOKEN }}"));
});

test("Anrufer schickt in keinem Minutenfenster mehr als 29 Aufrufe an die enge Probe-Schnittstelle", async () => {
  const MINUTE_MS = 60_000;
  const START_MS = Date.parse("2026-11-23T12:00:00.000Z");
  const GRENZE = 29;
  const ANZAHL_LISTE = 30;
  const ENDE_NACH_MS = 45_000;
  const TAG_MS = 24 * 60 * MINUTE_MS;
  let jetzt = START_MS;
  const uhr = {
    jetzt: () => jetzt,
    warte: async (ms) => {
      jetzt += ms;
    },
  };
  const eintraege = Array.from({ length: ANZAHL_LISTE }, (_, index) => ({
    id: `alt-${index}`,
    direction: index < 5 ? "outbound" : "inbound",
    counterparty: ZIEL,
    status: "completed",
  }));
  const zeitpunkte = [];
  let platziertMs;
  const antwort = (structuredContent) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent } }),
  });
  const abfrage = async (_url, optionen) => {
    zeitpunkte.push(jetzt);
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    if (name === "get_agent_number") return antwort({ number: ZIEL });
    if (name === "list_calls") return antwort({ calls: eintraege });
    if (name === "place_call") {
      platziertMs = jetzt;
      return antwort({ call_id: "probe-1" });
    }
    if (name === "get_call_result") {
      const fertig = jetzt - platziertMs >= ENDE_NACH_MS;
      return antwort({ result_summary: fertig ? "Es wurde begrüßt." : "" });
    }
    const eigener = argumente.call_id === "probe-1";
    const startMs = { "probe-1": platziertMs, "alt-0": START_MS - TAG_MS }[argumente.call_id] ?? START_MS - 1000;
    const fertig = !eigener || jetzt - platziertMs >= ENDE_NACH_MS;
    return antwort({
      status: fertig ? "completed" : "in_progress",
      started_at: new Date(startMs).toISOString(),
      answered_at: new Date(startMs + 2000).toISOString(),
      duration_s: 40,
      last_transcript_lines: [],
    });
  };
  const { anruferBauen, ROUTEN_ABSTAND_MS } = await import("../../scripts/anruf-probe/anrufer.mjs");
  const anrufer = anruferBauen({
    basis: BASIS,
    token: PROBE_ZUGANG_SCHLUESSEL,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
    uhr,
    abstandMs: ROUTEN_ABSTAND_MS,
  });
  await anrufer.eigeneNummer();
  const stand = await anrufer.tagesstand();
  assert.equal(stand.anrufe, 4);
  await anrufer.anrufen({ ziel: ZIEL });
  assert.equal(await anrufer.ergebnisVorgetragen(), true);
  const je = new Map();
  for (const ms of zeitpunkte) je.set(Math.floor(ms / MINUTE_MS), (je.get(Math.floor(ms / MINUTE_MS)) ?? 0) + 1);
  assert.ok(zeitpunkte.length > GRENZE, "Lauf muss mehr als ein Fenster füllen");
  for (const [fenster, anzahl] of je) assert.ok(anzahl <= GRENZE, `Fenster ${fenster}: ${anzahl} Aufrufe`);
});

test("Anrufer: nach vollem Tagesstand bleibt die echte Pause von 10 s unter der Stillstandsgrenze", async () => {
  const START_MS = Date.parse("2026-11-23T12:00:00.000Z");
  const ANZAHL_LISTE = 30;
  const ERSTE_ZEILE_S = 30;
  const ZWEITE_ZEILE_S = 40;
  const ENDE_S = 50;
  const MS = 1000;
  const TAG_MS = 24 * 60 * 60 * MS;
  let jetzt = START_MS;
  let platziertMs;
  const uhr = { jetzt: () => jetzt, warte: async (ms) => void (jetzt += ms) };
  const antwort = (structuredContent) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent } }),
  });
  const eintraege = Array.from({ length: ANZAHL_LISTE }, (_, index) => ({
    id: `alt-${index}`,
    direction: "inbound",
    counterparty: ZIEL,
    status: "completed",
  }));
  const abfrage = async (_url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    const call_id = argumente.call_id;
    if (name === "list_calls") return antwort({ calls: eintraege });
    if (name === "place_call") {
      platziertMs = jetzt;
      return antwort({ call_id: "probe-1" });
    }
    const seit = platziertMs === undefined ? 0 : (jetzt - platziertMs) / MS;
    const zeilen = [
      ...(seit >= ERSTE_ZEILE_S ? ["Gegenseite: Hallo"] : []),
      ...(seit >= ZWEITE_ZEILE_S ? ["Gegenseite: Ja, bitte"] : []),
    ];
    const start = platziertMs ?? (call_id === "alt-0" ? START_MS - TAG_MS : START_MS);
    return antwort({
      status: seit >= ENDE_S ? "completed" : "in_progress",
      started_at: new Date(start).toISOString(),
      answered_at: new Date(start + 2 * MS).toISOString(),
      duration_s: ENDE_S,
      last_transcript_lines: zeilen,
    });
  };
  const { anruferBauen, ROUTEN_ABSTAND_MS } = await import("../../scripts/anruf-probe/anrufer.mjs");
  const anrufer = anruferBauen({
    basis: BASIS,
    token: PROBE_ZUGANG_SCHLUESSEL,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
    uhr,
    abstandMs: ROUTEN_ABSTAND_MS,
  });
  await anrufer.tagesstand();
  const messung = await anrufer.anrufen({ ziel: ZIEL });
  assert.ok(messung.stillstandSekunden >= 10, `Stillstand ${messung.stillstandSekunden}`);
  assert.ok(messung.stillstandSekunden < 20, `Stillstand ${messung.stillstandSekunden}`);
  const { urteilen } = await import("../../scripts/anruf-probe/urteil.mjs");
  assert.equal(urteilen(messung).gerissen.includes("stillstand"), false);
});

test("Anrufer der Probe: der Produktionspfad wartet zwischen zwei Aufrufen bis zum Abstand von 2100 ms", async (t) => {
  const ABSTAND_MS = 2100;
  const TOLERANZ_MS = 50;
  const wartezeiten = [];
  t.mock.method(globalThis, "setTimeout", (fertig, ms) => {
    wartezeiten.push(ms);
    fertig();
  });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: { number: ZIEL } } }),
  });
  const { anrufer } = await import("../../scripts/anruf-probe/anrufer.mjs");
  await anrufer.eigeneNummer();
  await anrufer.eigeneNummer();
  const abstaende = wartezeiten.filter((ms) => ms <= ABSTAND_MS && ms > ABSTAND_MS - TOLERANZ_MS);
  assert.equal(abstaende.length, 1, `Wartezeiten ${wartezeiten}`);
});
