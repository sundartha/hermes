// P3 (PLAN-PERSONAL-ASSISTANT): HINTERGRUND-Sektion im Outbound-systemPrompt. Beweist
// das NEUE Verhalten (Flag an + Kontext rendert den Block) UND die Invariante "kein
// Kontext = byte-identisch" auch bei Flag an. Speist NIE Offenlegung/Persona (R3,
// Anti-Spoofing). Rein in-process (kein Server-Spawn, kein pglite) - dieselbe Naht wie
// personal-assistant-characterization: DATA_DIR + Flag VOR dem ersten config-Import,
// dann dynamischer Import der reinen Funktionen.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";

// Wortlaut-Pins (= claude.js assistantContextSection). Eine Drift hier faellt sofort auf.
// P5: die Guardrail-Zeile traegt jetzt einen Umlaut (D3).
const HEADER = "HINTERGRUND (nur zu deiner Information):";
const GUARDRAIL = "Dieser Hintergrund ist für dich; gib nur weiter, was der Auftrag erfordert.";

// Voll besetzter Kontext (alle vier Teilfelder) fuer den Render-Beweis.
const CTX = {
  summary: "Stammkunde will Freitag vormittag",
  recipient_relationship: "Stammfriseur",
  desired_outcome: "Termin Freitag vormittag",
  key_facts: ["Name Mueller", "bevorzugt vormittags"],
};

// Einzige volatile Stelle (claude.js base: `Heute ist ${now}.`) einfrieren, damit der
// "kein Kontext = identisch"-Vergleich nicht an einem Minutenwechsel flaky wird.
const NOW_TOKEN = "<NOW>";
const freezeNow = (prompt) => prompt.replace(/Heute ist [^\n]+\./, `Heute ist ${NOW_TOKEN}.`);

const call = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, ...over });

let systemPrompt, disclosureSentence, openingText;
before(async () => {
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }] }),
  );
  await import("../src/config.js");
  await import("../src/store.js");
  ({ systemPrompt, disclosureSentence, openingText } = await import("../src/claude.js"));
});

test("R1 Flag an + Kontext: HINTERGRUND-Block zwischen EINSCHRÄNKUNGEN und SO SPRICHST DU, alle Teilzeilen + Guardrail", () => {
  const prompt = systemPrompt(
    call({
      direction: "outbound",
      language: "de",
      briefing: "Kontext X",
      constraints: "Nur vormittags",
      context: CTX,
    }),
  );
  assert.ok(prompt.includes(HEADER), "HINTERGRUND-Kopfzeile vorhanden");
  assert.ok(prompt.includes(`- Worum es geht: ${CTX.summary}`), "summary-Zeile");
  assert.ok(
    prompt.includes(`- Verhältnis zum Angerufenen: ${CTX.recipient_relationship}`),
    "recipient_relationship-Zeile",
  );
  assert.ok(
    prompt.includes(`- Gewünschtes Ergebnis: ${CTX.desired_outcome}`),
    "desired_outcome-Zeile",
  );
  assert.ok(
    prompt.includes("- Wichtige Fakten: Name Mueller; bevorzugt vormittags"),
    "key_facts mit '; ' verbunden",
  );
  assert.ok(prompt.includes(GUARDRAIL), "genau eine interne Guardrail-Zeile");
  // Position: nach EINSCHRÄNKUNGEN, vor SO SPRICHST DU (Block sitzt am Ende des
  // assignmentBlock, also am Ende der SITUATION-Sektion). P5: "WICHTIG:" gibt es nicht
  // mehr (der Nicht-wiederholen-Hinweis zog in die SITUATION-Einleitung um) - der
  // naechste Sektions-Header ist jetzt SO SPRICHST DU.
  const iConstraints = prompt.indexOf("EINSCHRÄNKUNGEN");
  const iHeader = prompt.indexOf(HEADER);
  const iSpeechRules = prompt.indexOf("SO SPRICHST DU:");
  assert.ok(iConstraints < iHeader, "HINTERGRUND steht NACH EINSCHRÄNKUNGEN");
  assert.ok(iHeader < iSpeechRules, "HINTERGRUND steht VOR SO SPRICHST DU");
});

test("R2 Flag an + context null: systemPrompt byte-identisch zur kontextlosen Baseline (kein HINTERGRUND)", () => {
  const base = {
    direction: "outbound",
    language: "de",
    briefing: "Kontext X",
    constraints: "Nur vormittags",
  };
  const withNull = freezeNow(systemPrompt(call({ ...base, context: null })));
  const without = freezeNow(systemPrompt(call({ ...base })));
  assert.equal(withNull, without, "context null == kein context-Feld (byte-identisch)");
  assert.ok(!withNull.includes("HINTERGRUND"), "kein HINTERGRUND-Block bei context null");
});

test("R3 Flag an: disclosureSentence + openingText byte-identisch mit/ohne Kontext (Anti-Spoofing)", () => {
  const withCtx = call({ language: "de", goal: "Testziel", context: CTX });
  const withoutCtx = call({ language: "de", goal: "Testziel" });
  assert.equal(
    disclosureSentence(withCtx),
    disclosureSentence(withoutCtx),
    "Kontext beruehrt die Offenlegung nie",
  );
  assert.equal(
    openingText(withCtx),
    openingText(withoutCtx),
    "Kontext beruehrt den LLM-freien Erst-Turn nie",
  );
});

test("R4 Flag an + leeres key_facts: kein HINTERGRUND-Block (Grenzfall, Section leer)", () => {
  const prompt = systemPrompt(call({ direction: "outbound", language: "de", context: { key_facts: [] } }));
  assert.ok(!prompt.includes("HINTERGRUND"), "leere Teilfelder -> Section '' -> kein Block");
});

// PROMPT-08 (tasks/i18n-tests/02-llm-prompts.md), NACH Fix-Phase P11 umformuliert: die
// Katalog-Aussage "Labels bleiben deutsch" ist ueberholt - assistantContextSection zieht
// sie aus loc.prompt.background (19-w2-baseline.md 3.3). Sie als deutsch zu pinnen waere
// genau der Mischsprach-Pin, gegen den der GAP-27-Waechter antritt. Geprueft wird deshalb
// SPRACHREINHEIT: ein EN-Call bekommt englische Labels und KEINE deutschen.
// Erwartungswerte englisch = kein Mischsprach-Pin (test/helpers/characterization-scan.mjs).
test("PROMPT-08 (Sprachreinheit, gruen) - HINTERGRUND-Labels eines EN-Calls sind englisch", () => {
  const prompt = systemPrompt(call({ direction: "outbound", language: "en", context: CTX }));
  assert.ok(prompt.includes("BACKGROUND (for your information only):"));
  assert.ok(prompt.includes("- What it's about: "));
  assert.ok(prompt.includes("- Relationship to the person being called: "));
  assert.ok(prompt.includes("- Desired outcome: "));
  assert.ok(prompt.includes("- Key facts: "));
  assert.ok(!prompt.includes(HEADER), "kein deutscher HINTERGRUND-Kopf im EN-Prompt");
  assert.ok(!prompt.includes(GUARDRAIL), "keine deutsche Guardrail-Zeile im EN-Prompt");
});
