import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_WIRE_PATHS,
  CONSULT_ON,
  OAUTH_SUBJECT,
  legacySnapshot,
  oauthSnapshot,
  stdioSnapshot,
} from "../mcp-draht-pfade.js";
import { CALL_PURPOSE_EXCLUSIONS, CALL_PURPOSE_RULE } from "../../src/mcp-server-info.js";
import { NOT_PLACED } from "../../src/telephony/failure-reason.js";

const INSTRUCTIONS_PRIORITY_CHARS = 512;
const CALL_SEQUENCE_START = "Place a phone call with place_call only when the user asks for it";
const UI_ON = Object.freeze({ MCP_UI_ENABLED: "true" });
const BASE_DETAILS_START = 'If a call reports a failure_reason starting with "';
const ASCII_UPPER_BOUND = 127;
const isAsciiOnly = (text) => [...text].every((char) => char.codePointAt(0) <= ASCII_UPPER_BOUND);

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

const isConsultLabel = (label) => label.includes("mit Consult") && !label.startsWith("stdio");

function coreFindings(text, { consult }) {
  const head = text.slice(0, INSTRUCTIONS_PRIORITY_CHARS);
  const core = head.slice(0, head.lastIndexOf(".") + 1);
  const checks = [
    [core.startsWith(CALL_SEQUENCE_START), "core beginnt nicht mit der Anruf-Sequenz"],
    [/no confirmation step/.test(core), 'core: "no confirmation step" fehlt'],
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

for (const path of MCP_WIRE_PATHS) {
  const consult = isConsultLabel(path.label);
  test(`T2-17 Positiv-Kontrolle (${path.label}): ohne Kern-Vorspann liefert derselbe Pruefer Befunde`, async () => {
    const { instructions } = await snapshotOf(path);
    const withoutCore = instructions.slice(instructions.indexOf(BASE_DETAILS_START));
    assert.ok(withoutCore.length > 0, "BASE_DETAILS_START im Text gefunden");
    assert.notDeepEqual(coreFindings(withoutCore, { consult }), []);
  });
}
