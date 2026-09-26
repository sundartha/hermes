// T2-17 (T-21): der Kern-Vorspann der Server-Instructions liegt in den ersten 512
// Zeichen - gemessen am echten Draht (initialize), nie an den Konstanten allein
// (registerTool()/mcpServerOptions() koennten Felder still verwerfen). Pfade: die
// sieben aus test/mcp-draht-pfade.js PLUS fuenf mit MCP_UI_ENABLED=true (die sieben
// Basis-Pfade laufen mit MCP_UI_ENABLED=false, test/helpers.js BASE_ENV) - Instructions
// haengen laut Code nicht von uiEnabled ab (mcpServerOptions), diese fuenf Pfade
// belegen das am Draht statt nur am Code zu glauben (HTTP Legacy und OAuth je mit und
// ohne Consult, dazu stdio).
//
// ASCII-Assertion begruendet die Zaehlweise: bei reinem ASCII sind Zeichen, UTF-8-Bytes
// und JS-`length` (UTF-16-Einheiten) identisch, die Frage "Zeichen oder Bytes?" (die
// OpenAI-Primaerquelle sagt es nicht) ist damit gegenstandslos.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_WIRE_PATHS,
  CONSULT_ON,
  OAUTH_SUBJECT,
  legacySnapshot,
  oauthSnapshot,
  stdioSnapshot,
} from "./mcp-draht-pfade.js";
import { CALL_PURPOSE_EXCLUSIONS, CALL_PURPOSE_RULE } from "../src/mcp-server-info.js";
import { NOT_PLACED } from "../src/telephony/failure-reason.js";

const INSTRUCTIONS_PRIORITY_CHARS = 512;
const CONFIRMATION_SEQUENCE_START = "Call prepare_call before every phone call";
// Das Schema-Feld von place_call. Es darf in den instructions NUR in einem Verbot stehen:
// die Karte bestaetigt, das Modell kennt den Code nie, fragt nie danach und ruft
// place_call nie selbst auf. Eine Positivform ("pass the confirmation_code ...") waere
// eine Anleitung zur Selbstbestaetigung.
const CONFIRMATION_FIELD = "confirmation_code";
const CODE_PROHIBITION = `never ask the user for or invent a ${CONFIRMATION_FIELD}`;
// Satzteile: Satzende, Gedankenstrich und Semikolon trennen je eine Anweisung.
const CLAUSE_SEPARATOR = /\.\s+| - |; /;
const UI_ON = Object.freeze({ MCP_UI_ENABLED: "true" });
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
  { label: "HTTP Legacy, ohne Consult, UI an", snapshot: () => legacySnapshot(UI_ON) },
  {
    label: "HTTP Legacy, mit Consult, UI an",
    snapshot: () => legacySnapshot({ ...CONSULT_ON, ...UI_ON }),
  },
  {
    label: "HTTP OAuth, ohne Consult, UI an",
    snapshot: () => oauthSnapshot({ subject: OAUTH_SUBJECT, env: UI_ON }),
  },
  {
    label: "HTTP OAuth, mit Consult, UI an",
    snapshot: () => oauthSnapshot({ subject: OAUTH_SUBJECT, env: { ...CONSULT_ON, ...UI_ON } }),
  },
  { label: "stdio, UI an", snapshot: () => stdioSnapshot(UI_ON) },
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
    [/only the Hermes card places it/.test(core), 'core: "only the Hermes card places it" fehlt'],
    [/never call place_call yourself/.test(core), 'core: "never call place_call yourself" fehlt'],
    [core.includes(CODE_PROHIBITION), `core: "${CODE_PROHIBITION}" fehlt`],
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

// Satzteile, die das Feld confirmation_code nennen, OHNE es zu verbieten - leer = das Feld
// steht nur in Verboten. Prueft den GESAMTtext, nicht nur den Kern.
function unguardedCodeMentions(text) {
  return text
    .split(CLAUSE_SEPARATOR)
    .filter((clause) => clause.includes(CONFIRMATION_FIELD) && !/\bnever\b/i.test(clause));
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

  test(`T2-17 (${path.label}): ${CONFIRMATION_FIELD} steht nur in einem Verbot, nie als Anleitung`, async () => {
    const { instructions } = await snapshotOf(path);
    assert.ok(instructions.includes(CONFIRMATION_FIELD), "Positiv-Kontrolle: das Feld wird genannt");
    assert.deepEqual(unguardedCodeMentions(instructions), []);
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

// Positiv-Kontrolle zum Verbots-Pruefer: eine Anleitung zur Selbstbestaetigung (wie in der
// fruehen Planfassung "place_call mit dem Code aus der Nachricht des Nutzers") und eine
// Rueckfrage nach dem Code muessen anschlagen, sonst waere "[]" oben wertlos.
test("T2-17 Positiv-Kontrolle: der Verbots-Pruefer erkennt eine Anleitung, den Code zu benutzen oder zu erfragen", () => {
  const selfConfirm = `Then call place_call with the ${CONFIRMATION_FIELD} from the user's message.`;
  const askUser = `Ask the user for the ${CONFIRMATION_FIELD} shown in the card.`;
  assert.deepEqual(unguardedCodeMentions(selfConfirm), [selfConfirm]);
  assert.deepEqual(unguardedCodeMentions(askUser), [askUser]);
});

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
