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
const HEADER = "HINTERGRUND (nur zu deiner Information):";
const GUARDRAIL = "Dieser Hintergrund ist fuer dich; gib nur weiter, was der Auftrag erfordert.";

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

test("R1 Flag an + Kontext: HINTERGRUND-Block zwischen EINSCHRAENKUNGEN und WICHTIG, alle Teilzeilen + Guardrail", () => {
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
    prompt.includes(`- Verhaeltnis zum Angerufenen: ${CTX.recipient_relationship}`),
    "recipient_relationship-Zeile",
  );
  assert.ok(
    prompt.includes(`- Gewuenschtes Ergebnis: ${CTX.desired_outcome}`),
    "desired_outcome-Zeile",
  );
  assert.ok(
    prompt.includes("- Wichtige Fakten: Name Mueller; bevorzugt vormittags"),
    "key_facts mit '; ' verbunden",
  );
  assert.ok(prompt.includes(GUARDRAIL), "genau eine interne Guardrail-Zeile");
  // Position: nach EINSCHRAENKUNGEN, vor WICHTIG (Block sitzt im base-Teil NACH dem AUFTRAG).
  const iConstraints = prompt.indexOf("EINSCHRAENKUNGEN");
  const iHeader = prompt.indexOf(HEADER);
  const iWichtig = prompt.indexOf("WICHTIG:");
  assert.ok(iConstraints < iHeader, "HINTERGRUND steht NACH EINSCHRAENKUNGEN");
  assert.ok(iHeader < iWichtig, "HINTERGRUND steht VOR WICHTIG (Offenlegung/Anliegen)");
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
