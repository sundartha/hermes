// T2-17 (T-21): der Kern-Vorspann der Server-Instructions liegt in den ersten 512
// Zeichen - gemessen am echten Draht (initialize), nie an den Konstanten allein
// (registerTool()/mcpServerOptions() koennten Felder still verwerfen). Pfade: die
// sieben aus test/mcp-draht-pfade.js PLUS zwei mit MCP_UI_ENABLED=true (die sieben
// Basis-Pfade laufen mit MCP_UI_ENABLED=false, test/helpers.js BASE_ENV) - Instructions
// haengen laut Code nicht von uiEnabled ab (mcpServerOptions), diese zwei Pfade
// belegen das am Draht statt nur am Code zu glauben.
//
// ASCII-Assertion begruendet die Zaehlweise: bei reinem ASCII sind Zeichen, UTF-8-Bytes
// und JS-`length` (UTF-16-Einheiten) identisch, die Frage "Zeichen oder Bytes?" (die
// OpenAI-Primaerquelle sagt es nicht) ist damit gegenstandslos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_WIRE_PATHS, CONSULT_ON, legacySnapshot, stdioSnapshot } from "./mcp-draht-pfade.js";
import { CALL_PURPOSE_EXCLUSIONS, CALL_PURPOSE_RULE } from "../src/mcp-server-info.js";
import { NOT_PLACED } from "../src/telephony/failure-reason.js";

const INSTRUCTIONS_PRIORITY_CHARS = 512;
const CONFIRMATION_SEQUENCE_START = "Before every place_call, call prepare_call first";
// Ab hier beginnt der bisherige Bestandstext (BASE_DETAILS) - der Praefix, den die
// Positiv-Kontrolle unten abschneidet, um den Kern-Vorspann zu entfernen.
const BASE_DETAILS_START = 'If a call reports a failure_reason starting with "';
// Kein Regex mit Steuerzeichen-Klasse (eslint no-control-regex) - Codepoint-Vergleich
// stattdessen. Ab Codepoint 128 ist ein Zeichen kein ASCII mehr.
const ASCII_UPPER_BOUND = 127;
const isAsciiOnly = (text) => [...text].every((char) => char.codePointAt(0) <= ASCII_UPPER_BOUND);

// Zwei zusaetzliche Pfade mit MCP_UI_ENABLED=true - dieselben Snapshot-Bausteine wie
// test/mcp-draht-pfade.js (jetzt dort exportiert statt kopiert). "mit Consult" im Label
// entscheidet unten, welche Pruefungen zusaetzlich greifen (isConsultLabel).
const UI_ENABLED_PATHS = Object.freeze([
  {
    label: "HTTP Legacy, mit Consult, UI an",
    snapshot: () => legacySnapshot({ ...CONSULT_ON, MCP_UI_ENABLED: "true" }),
  },
  { label: "stdio, UI an", snapshot: () => stdioSnapshot({ MCP_UI_ENABLED: "true" }) },
]);

const ALL_PATHS = [...MCP_WIRE_PATHS, ...UI_ENABLED_PATHS];

// stdio liefert nie den Consult-Text (STDIO_CONSULT_LOOP ist hart auf false gepinnt,
// src/mcp-server.js) - "mit Consult" im Label heisst dort nur "Consult-Env gesetzt",
// nicht "Consult-Text ausgeliefert". Nur HTTP-Pfade mit "mit Consult" bekommen ihn.
const isConsultLabel = (label) => label.includes("mit Consult") && !label.startsWith("stdio");

// Liste fehlender Merkmale (Muster wie forbiddenHits in openai-t2-16-place-call-texte):
// leer = jedes Merkmal gefunden. `core` sind nur VOLLSTAENDIGE Saetze bis Zeichen 512 -
// ein Merkmal, das mitten im Wort abgeschnitten ist, gilt nicht als vorhanden.
function coreFindings(text, { consult }) {
  const head = text.slice(0, INSTRUCTIONS_PRIORITY_CHARS);
  const core = head.slice(0, head.lastIndexOf(".") + 1);
  const checks = [
    [core.startsWith(CONFIRMATION_SEQUENCE_START), "core beginnt nicht mit der Bestaetigungs-Sequenz"],
    [/Hermes card/.test(core), 'core: "Hermes card" fehlt'],
    [/places the call/.test(core), 'core: "places the call" fehlt'],
    [/never call place_call yourself/.test(core), 'core: "never call place_call yourself" fehlt'],
    [/invent a confirmation code/.test(core), 'core: "invent a confirmation code" fehlt'],
    [/user asks for/.test(core), 'core: "user asks for" fehlt'],
    [core.includes(`"${NOT_PLACED}"`), `core: "${NOT_PLACED}" (in Anfuehrungszeichen) fehlt`],
    [/retry/i.test(core), 'core: "retry" fehlt'],
    [text.includes(CALL_PURPOSE_RULE), "Gesamttext: volle Zweckregel fehlt"],
    [text.includes("Do NOT retry the call"), 'Gesamttext: "Do NOT retry the call" fehlt'],
    [text.includes("Never invent facts"), 'Gesamttext: "Never invent facts" fehlt'],
  ];
  for (const entry of CALL_PURPOSE_EXCLUSIONS) {
    checks.push([core.includes(entry.full), `core: Ausschluss "${entry.full}" fehlt`]);
  }
  if (consult) {
    checks.push(
      [core.includes("await_call_event"), 'core: "await_call_event" fehlt'],
      [core.includes('event="done"'), 'core: event="done" fehlt'],
      [core.includes("answer_consult"), 'core: "answer_consult" fehlt'],
      [core.includes('status="working"'), 'core: status="working" fehlt'],
      [text.includes("never invent an answer"), 'Gesamttext: "never invent an answer" fehlt'],
    );
  }
  return checks.filter(([ok]) => !ok).map(([, label]) => label);
}

const snapshots = new Map();
async function snapshotOf(path) {
  if (!snapshots.has(path.label)) snapshots.set(path.label, await path.snapshot());
  return snapshots.get(path.label);
}

for (const path of ALL_PATHS) {
  const consult = isConsultLabel(path.label);

  test(`T2-17 (${path.label}): Gesamttext ist ASCII-only (begruendet die Zaehlweise)`, async () => {
    const { instructions } = await snapshotOf(path);
    assert.ok(isAsciiOnly(instructions));
  });

  test(`T2-17 (${path.label}): Kern-Vorspann traegt alle Pflicht-Merkmale in den ersten 512 Zeichen`, async () => {
    const { instructions } = await snapshotOf(path);
    assert.deepEqual(coreFindings(instructions, { consult }), []);
  });

  if (consult) {
    test(`T2-17 (${path.label}): Consult-Pfad - await_call_event steht im Text (Positiv-Kontrolle zur Ausschluss-Pruefung unten)`, async () => {
      const { instructions } = await snapshotOf(path);
      assert.ok(instructions.includes("await_call_event"));
    });
  } else {
    test(`T2-17 (${path.label}): Nicht-Consult-Pfad - await_call_event steht NICHT im Text`, async () => {
      const { instructions } = await snapshotOf(path);
      assert.ok(!instructions.includes("await_call_event"));
    });
  }
}

// Positiv-Kontrolle (Pre-Mortem 2/Plan-Schritt 3): dieselbe Pruefung auf den Text OHNE
// Kern-Vorspann muss Befunde liefern - sonst waere "coreFindings == []" oben wertlos
// (ein Pruefer, der auf allem gruen ist, beweist nichts, Lehre "Pruefkommando ohne
// Positiv-Kontrolle"). Der abgeschnittene Text ist wortgleich der ALTE Bestandstext vor
// T2-17 (BASE_DETAILS begann schon immer mit BASE_DETAILS_START).
for (const path of MCP_WIRE_PATHS) {
  const consult = isConsultLabel(path.label);
  test(`T2-17 Positiv-Kontrolle (${path.label}): ohne Kern-Vorspann liefert derselbe Pruefer Befunde`, async () => {
    const { instructions } = await snapshotOf(path);
    const withoutCore = instructions.slice(instructions.indexOf(BASE_DETAILS_START));
    assert.ok(withoutCore.length > 0, "BASE_DETAILS_START im Text gefunden");
    assert.notDeepEqual(coreFindings(withoutCore, { consult }), []);
  });
}
