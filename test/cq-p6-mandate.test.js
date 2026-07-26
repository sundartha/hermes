// P6 (PLAN-CONVERSATION-QUALITY-V2, Anhang C): MANDAT statt Rueckfrage - die
// Prompt-Sektion (claude.js mandateSection). Rein in-process (kein Server-Spawn, kein
// pglite) - dieselbe Naht wie assistant-context-render/cq-p5-prompt-redesign: DATA_DIR
// vor dem ersten config-Import, dann dynamischer Import der reinen Funktionen.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { TRANSLITERATION_STEMS } from "./umlaut-stems-helper.js";

const OWNER = "Jonas Beispiel";
const REAL_UMLAUT = /[äöüÄÖÜ]/u;

// Voller Mandats-Wortlaut (aus dem TATSAECHLICHEN Output eingefroren, nicht erraten -
// siehe Plan-Protokoll: Literal leer lassen, Test laufen, Ist-Ausgabe uebernehmen).
const EXPECTED_MANDATE_SECTION_NO_CONSTRAINTS = `DEIN SPIELRAUM: Termin an einem Werktag zwischen 9 und 12 Uhr, bis 60 Euro
Das darfst du im Gespräch ohne Rückfrage verbindlich zusagen. Innerhalb dieses Rahmens entscheidest du selbst, fragst NICHT nach und gibst es NICHT als Nachricht weiter. Eintragen oder buchen kannst du weiterhin nichts - du sagst nur verbindlich zu, was in diesem Rahmen liegt.

WENN DER ERSTWUNSCH NICHT GEHT: zuerst Donnerstag, sonst Freitag
Arbeite diese Reihenfolge selbständig ab, bevor du das Anliegen zurückgibst.

AUSSERHALB DEINES SPIELRAUMS: Sag klar, dass du das nicht selbst zusagen kannst. Halte das Angebot mit allen Details fest - Tag, Uhrzeit, Preis und bis wann es gilt -, gib es über take_message weiter und sag zu, dass Jonas sich meldet.
Nenne als Grund NIE dein eigenes Unwissen, sondern immer deinen Auftragsrahmen. Versprich NIEMALS, dass du selbst nochmal anrufst.`;

const FULL_MANDATE = {
  decide_freely: "Termin an einem Werktag zwischen 9 und 12 Uhr, bis 60 Euro",
  fallback_order: "zuerst Donnerstag, sonst Freitag",
  on_out_of_scope: "take_message",
};

// Einzige volatile Stelle (claude.js base: `Heute ist ${now}.`) einfrieren.
const NOW_TOKEN = "<NOW>";
const freezeNow = (prompt) => prompt.replace(/Heute ist [^\n]+\./, `Heute ist ${NOW_TOKEN}.`);

const call = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, ...over });

let systemPrompt, disclosureSentence, openingText, toolDefs;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }] }),
  );
  await import("../src/config.js");
  await import("../src/store.js");
  ({ systemPrompt, disclosureSentence, openingText, toolDefs } = await import("../src/claude.js"));
});

test("M1 kein mandate: keine SPIELRAUM-Sektion, Prompt deterministisch (reine Funktion des Calls)", () => {
  const c = call({ direction: "outbound", language: "de" });
  const first = freezeNow(systemPrompt(c));
  const second = freezeNow(systemPrompt(call({ direction: "outbound", language: "de" })));
  assert.equal(first, second, "systemPrompt haengt nur vom Call ab");
  assert.ok(!first.includes("SPIELRAUM"), "kein SPIELRAUM-Marker ohne Mandat");
});

test("M2 mandate: {} und mandate: null sind Grenzfaelle, byte-identisch zur mandatlosen Baseline (Muster R4)", () => {
  const base = { direction: "outbound", language: "de" };
  const baseline = freezeNow(systemPrompt(call({ ...base })));
  const withEmpty = freezeNow(systemPrompt(call({ ...base, mandate: {} })));
  const withNull = freezeNow(systemPrompt(call({ ...base, mandate: null })));
  assert.equal(withEmpty, baseline, "mandate: {} rendert keine Sektion");
  assert.equal(withNull, baseline, "mandate: null rendert keine Sektion");
});

test("M3 volles Mandat: woertlicher Pin der kompletten Mandats-Sektion", () => {
  const prompt = systemPrompt(call({ direction: "outbound", language: "de", mandate: FULL_MANDATE }));
  assert.ok(
    prompt.includes(EXPECTED_MANDATE_SECTION_NO_CONSTRAINTS),
    `Mandats-Sektion weicht vom Pin ab:\n${prompt}`,
  );
});

test("M4 Position: DEINE GRENZEN vor DEIN SPIELRAUM vor SO KOMMST DU ZUM ERGEBNIS", () => {
  const prompt = systemPrompt(call({ direction: "outbound", language: "de", mandate: FULL_MANDATE }));
  const iBoundaries = prompt.indexOf("DEINE GRENZEN:");
  const iSpielraum = prompt.indexOf("DEIN SPIELRAUM:");
  const iOutcome = prompt.indexOf("SO KOMMST DU ZUM ERGEBNIS:");
  assert.ok(iBoundaries !== -1 && iSpielraum !== -1 && iOutcome !== -1, "alle drei Marker vorhanden");
  assert.ok(iBoundaries < iSpielraum, "DEINE GRENZEN steht vor DEIN SPIELRAUM");
  assert.ok(iSpielraum < iOutcome, "DEIN SPIELRAUM steht vor SO KOMMST DU ZUM ERGEBNIS");
});

test("M5 nur decide_freely: DEIN SPIELRAUM + AUSSERHALB, kein WENN DER ERSTWUNSCH", () => {
  const prompt = systemPrompt(
    call({ direction: "outbound", language: "de", mandate: { decide_freely: "X" } }),
  );
  assert.ok(prompt.includes("DEIN SPIELRAUM: X"));
  assert.ok(!prompt.includes("WENN DER ERSTWUNSCH NICHT GEHT:"));
  assert.ok(prompt.includes("AUSSERHALB DEINES SPIELRAUMS:"), "AUSSERHALB rendert immer mit");
});

test("M5 nur fallback_order: WENN DER ERSTWUNSCH + AUSSERHALB, kein DEIN SPIELRAUM", () => {
  const prompt = systemPrompt(
    call({ direction: "outbound", language: "de", mandate: { fallback_order: "Y" } }),
  );
  assert.ok(!prompt.includes("DEIN SPIELRAUM:"));
  assert.ok(prompt.includes("WENN DER ERSTWUNSCH NICHT GEHT: Y"));
  assert.ok(prompt.includes("AUSSERHALB DEINES SPIELRAUMS:"), "AUSSERHALB rendert immer mit");
});

test("M5 nur on_out_of_scope: nur AUSSERHALB, weder DEIN SPIELRAUM noch WENN DER ERSTWUNSCH", () => {
  const prompt = systemPrompt(
    call({ direction: "outbound", language: "de", mandate: { on_out_of_scope: "decline" } }),
  );
  assert.ok(!prompt.includes("DEIN SPIELRAUM:"));
  assert.ok(!prompt.includes("WENN DER ERSTWUNSCH NICHT GEHT:"));
  assert.ok(prompt.includes("AUSSERHALB DEINES SPIELRAUMS:"));
});

test("M6 alle drei Enum-Werte rendern ihren eigenen Satz; unbekannter Wert faellt auf take_message zurueck", () => {
  const promptFor = (onOutOfScope) =>
    systemPrompt(call({ direction: "outbound", language: "de", mandate: { on_out_of_scope: onOutOfScope } }));

  assert.match(promptFor("take_message"), /Halte das Angebot mit allen Details fest/);
  assert.match(promptFor("decline"), /lehne höflich ab, ohne ein Gegenangebot zu machen/);
  assert.match(promptFor("accept_best"), /Nimm die beste angebotene Möglichkeit an/);

  // D5: unbekannter/korrupter Wert wirft NICHT, sondern faellt auf den Default (take_message).
  assert.doesNotThrow(() => promptFor("irgendwas_unbekanntes"));
  assert.match(promptFor("irgendwas_unbekanntes"), /Halte das Angebot mit allen Details fest/);
});

test("M7 Vorrangsatz nur mit gesetzten constraints", () => {
  const withConstraints = systemPrompt(
    call({
      direction: "outbound",
      language: "de",
      constraints: "Nur vormittags",
      mandate: { decide_freely: "X" },
    }),
  );
  const withoutConstraints = systemPrompt(
    call({ direction: "outbound", language: "de", mandate: { decide_freely: "X" } }),
  );
  assert.ok(withConstraints.includes("Die EINSCHRÄNKUNGEN gehen deinem Spielraum immer vor."));
  assert.ok(!withoutConstraints.includes("Die EINSCHRÄNKUNGEN gehen deinem Spielraum immer vor."));
});

// E1-Invariante (hart, Owner-Entscheidung): auch mit vollem Mandat bleibt jeder
// Kalender-/Buchungspfad draussen; die beiden unbedingten Grenzen-Zeilen (P1b) stehen
// weiter. Muster p1b-no-booking.test.js.
const REMOVED_PROMPT_MARKERS = [
  "book_appointment",
  "get_calendar",
  "KALENDER DEINES AUFTRAGGEBERS",
  "Buchung",
];
const UNCONDITIONAL_LINES = [
  "- Du hast KEINEN Kalenderzugriff und siehst keine Termine von ",
  "- Du buchst KEINE Termine fest.",
];

test("M8 E1-Invariante: volles Mandat traegt keinen entfernten Marker, beide unbedingten Zeilen bleiben, toolDefs unveraendert", () => {
  const prompt = systemPrompt(call({ direction: "outbound", language: "de", mandate: FULL_MANDATE }));
  for (const marker of REMOVED_PROMPT_MARKERS) {
    assert.ok(!prompt.includes(marker), `"${marker}" steht trotz Mandat im Prompt`);
  }
  for (const line of UNCONDITIONAL_LINES) {
    assert.ok(prompt.includes(line), `unbedingte Zeile fehlt: ${line}`);
  }
  assert.deepEqual(
    toolDefs().map((t) => t.name),
    ["end_call", "take_message"],
  );
});

test("M9 Quell-Invariante: src/claude.js enthaelt keinen Kalender-/Buchungs-Code-Marker", () => {
  const claudeJsPath = fileURLToPath(new URL("../src/claude.js", import.meta.url));
  const source = readFileSync(claudeJsPath, "utf8");
  for (const marker of ["book_appointment", "get_calendar", "calendarSection", "calendarExcerpt"]) {
    assert.ok(!source.includes(marker), `"${marker}" steht im Quelltext von src/claude.js`);
  }
});

test("M10 Anti-Spoofing: disclosureSentence + openingText byte-identisch mit/ohne Mandat", () => {
  const withMandate = call({ language: "de", goal: "Testziel", mandate: FULL_MANDATE });
  const withoutMandate = call({ language: "de", goal: "Testziel" });
  assert.equal(
    disclosureSentence(withMandate),
    disclosureSentence(withoutMandate),
    "Mandat beruehrt die Offenlegung nie",
  );
  assert.equal(
    openingText(withMandate),
    openingText(withoutMandate),
    "Mandat beruehrt den LLM-freien Erst-Turn nie",
  );
});

// PROMPT-22 (tasks/i18n-tests/02-llm-prompts.md), NACH P11 umformuliert wie PROMPT-08:
// die Mandats-Texte kommen aus loc.prompt.mandate (19-w2-baseline.md 3.3). Geprueft wird
// Sprachreinheit statt "bleibt deutsch": EN-Call -> englische Mandats-Labels, keine
// deutschen. Der DE-Wortlaut bleibt woertlich von M3 gepinnt (kein Duplikat, G5).
test("PROMPT-22 (Sprachreinheit, gruen) - Mandats-Sektion eines EN-Calls ist englisch", () => {
  const prompt = systemPrompt(call({ direction: "outbound", language: "en", mandate: FULL_MANDATE }));
  assert.ok(prompt.includes("YOUR LEEWAY:"));
  assert.ok(prompt.includes("IF THE FIRST CHOICE DOESN'T WORK:"));
  assert.ok(prompt.includes("OUTSIDE YOUR LEEWAY:"));
  assert.ok(!prompt.includes("DEIN SPIELRAUM:"));
  assert.ok(!prompt.includes("AUSSERHALB DEINES SPIELRAUMS:"));
  assert.ok(!prompt.includes("WENN DER ERSTWUNSCH NICHT GEHT:"));
});

test("M11 Mandats-Sektion traegt keine ASCII-Transliteration und mindestens einen echten Umlaut", () => {
  const prompt = systemPrompt(call({ direction: "outbound", language: "de", mandate: FULL_MANDATE }));
  const iStart = prompt.indexOf("DEIN SPIELRAUM:");
  const iEnd = prompt.indexOf("SO KOMMST DU ZUM ERGEBNIS:");
  const section = prompt.slice(iStart, iEnd);
  const hit = section.match(TRANSLITERATION_STEMS);
  assert.equal(hit, null, `Transliteration "${hit?.[0]}" in der Mandats-Sektion`);
  assert.match(section, REAL_UMLAUT, "kein echter Umlaut in der Mandats-Sektion gefunden");
});
