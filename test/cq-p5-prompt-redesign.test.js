// P5 (PLAN-CONVERSATION-QUALITY-V2): Prompt-Redesign. Drei Zusagen, die der
// Byte-Pin in personal-assistant-characterization NICHT ausdrueckt (der pinnt das
// Ergebnis, nicht die Absicht):
//   (A) Orthografie - kein transliterierter Umlaut mehr in Prompt/Tool-Text
//   (B) Reihenfolge - die SITUATION steht VOR den Regeln
//   (C) die vier neu geschlossenen Telefonie-Luecken sind wirklich drin
// Rein in-process (kein Server-Spawn, kein pglite) - dieselbe Naht wie
// personal-assistant-characterization: DATA_DIR vor dem ersten config-Import, dann
// dynamischer Import.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { TRANSLITERATION_STEMS } from "./umlaut-stems-helper.js";

const OWNER = "Jonas Beispiel";
const DIRECTIONS = ["inbound", "outbound"];
const REAL_UMLAUT = /[äöüÄÖÜ]/u;
// P11: FR-Entsprechung der Umlaut-Zusage - kein transliteriertes Akzent-Ersatzmuster
// (Wortstamm-Denylist analog TRANSLITERATION_STEMS, aber fuer franzoesische Akzente:
// wuerde ein Fix versehentlich Akzente durch ASCII ersetzen, faengt dieser Stamm es).
const FR_TRANSLITERATION_STEMS = /\betre\b|\bmeme\b|\bresponsable\b|\bnumero\b/i;
const REAL_ACCENT = /[éèêëàâäùûüôöîïç]/iu;

let systemPrompt, toolDefs;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  await import("../src/config.js");
  ({ systemPrompt, toolDefs } = await import("../src/claude.js"));
});

const promptFor = (language, direction) =>
  systemPrompt(seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language, direction }));

// (A1) P11-Korrektur: die Praemisse "Geruest ist in JEDER Sprache deutsch" faellt mit
// P11 (das Geruest ist jetzt je Sprache uebersetzt) - die Umlaut-Orthografie-Zusage gilt
// nur noch fuer DE (das ist die Invariante, die sie eigentlich schuetzt: kein
// transliterierter Umlaut im deutschen Prompt-Text).
test("P5-O1 systemPrompt(de) traegt in keiner Richtung eine Umlaut-Transliteration", () => {
  for (const direction of DIRECTIONS) {
    const prompt = promptFor("de", direction);
    const hit = prompt.match(TRANSLITERATION_STEMS);
    assert.equal(hit, null, `de/${direction}: Transliteration "${hit?.[0]}" gefunden`);
  }
});

// (A2) Gegenprobe: ein "Fix", der die betroffenen Woerter streicht, faerbt O1 sonst gruen.
test("P5-O2 Gegenprobe - jeder DE-Prompt traegt echte Umlaut-Zeichen", () => {
  for (const direction of DIRECTIONS) {
    const prompt = promptFor("de", direction);
    assert.match(prompt, REAL_UMLAUT, `de/${direction}: kein echter Umlaut gefunden`);
  }
});

// P11-Ergaenzung: FR-Entsprechung der Umlaut-Zusage - Akzente vorhanden, keine
// Transliteration (FR hat, anders als DE, nie transliteriert - i18n/locales.js Kopfkommentar).
test("P5-O1b systemPrompt(fr) traegt in keiner Richtung eine Akzent-Transliteration", () => {
  for (const direction of DIRECTIONS) {
    const prompt = promptFor("fr", direction);
    const hit = prompt.match(FR_TRANSLITERATION_STEMS);
    assert.equal(hit, null, `fr/${direction}: Transliteration "${hit?.[0]}" gefunden`);
  }
});
test("P5-O2b Gegenprobe - jeder FR-Prompt traegt echte Akzent-Zeichen", () => {
  for (const direction of DIRECTIONS) {
    const prompt = promptFor("fr", direction);
    assert.match(prompt, REAL_ACCENT, `fr/${direction}: kein echter Akzent gefunden`);
  }
});

test("P5-O3 end_call- und take_message-Description (de) sind frei von Transliteration", () => {
  // toolDefs("de"): die Umlaut-Zusage gilt fuer den deutschen Tool-Text (P11 - ohne
  // Argument haengt das Ergebnis am Weltdefault-Schalter, nicht an DE).
  for (const tool of toolDefs("de")) {
    const hit = tool.description.match(TRANSLITERATION_STEMS);
    assert.equal(hit, null, `${tool.name}: Transliteration "${hit?.[0]}" in Description`);
    assert.match(tool.description, REAL_UMLAUT, `${tool.name}: kein echter Umlaut in Description`);
  }
});

// (B) Kernaussage des Redesigns: Situation vor Regeln.
test("P5-O4 SITUATION steht vor SO SPRICHST DU und vor DEINE GRENZEN", () => {
  for (const direction of DIRECTIONS) {
    const prompt = promptFor("de", direction);
    const iSituation = prompt.indexOf("SITUATION:");
    const iSpeech = prompt.indexOf("SO SPRICHST DU:");
    const iBoundaries = prompt.indexOf("DEINE GRENZEN:");
    assert.ok(iSituation !== -1, `${direction}: SITUATION fehlt`);
    assert.ok(iSpeech !== -1, `${direction}: SO SPRICHST DU fehlt`);
    assert.ok(iBoundaries !== -1, `${direction}: DEINE GRENZEN fehlt`);
    assert.ok(iSituation < iSpeech, `${direction}: SITUATION muss vor SO SPRICHST DU stehen`);
    assert.ok(iSpeech < iBoundaries, `${direction}: SO SPRICHST DU muss vor DEINE GRENZEN stehen`);
  }
});

test("P5-O5 inbound traegt keinen DEIN AUFTRAG-Block, outbound schon", () => {
  const inbound = promptFor("de", "inbound");
  const outbound = promptFor("de", "outbound");
  assert.ok(!inbound.includes("DEIN AUFTRAG:"), "inbound darf keinen DEIN AUFTRAG-Block tragen");
  assert.ok(outbound.includes("DEIN AUFTRAG:"), "outbound muss einen DEIN AUFTRAG-Block tragen");
});

// (C) die neuen Punkte, ueber kurze, nicht-brittle Marker.
const NEW_TELEPHONY_MARKERS = [
  "Gerne, ich warte.", // Warten/Hold
  "Meldet sich eine andere Person", // Personenwechsel
  "Weiche dieser Frage nie aus", // Identitaets-Rueckfrage
  "Ziffer für Ziffer", // Ziffern/Buchstabieren
  "Handle sparsam", // Werkzeug-Sparsamkeit
  "Du kannst nichts nachschlagen", // Faehigkeits-Ehrlichkeit
];
test("P5-O6 die vier neuen Telefonie-Punkte stehen im Prompt", () => {
  for (const direction of DIRECTIONS) {
    const prompt = promptFor("de", direction);
    for (const marker of NEW_TELEPHONY_MARKERS) {
      assert.ok(prompt.includes(marker), `${direction}: Marker fehlt: "${marker}"`);
    }
  }
});

// (D) Kollision mit dem hartkodierten Fallback locales.js turnFallbackSpeech.
test('P5-O7 die Beispiel-Floskel "Alles klar," steht nicht mehr im Prompt', () => {
  for (const direction of DIRECTIONS) {
    const prompt = promptFor("de", direction);
    assert.ok(!prompt.includes("Alles klar,"), `${direction}: alte Floskel "Alles klar," noch im Prompt`);
  }
});
