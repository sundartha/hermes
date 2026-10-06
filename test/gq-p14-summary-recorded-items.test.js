import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const GOAL = "Inspektionstermin fuer das Fahrzeug vereinbaren";
const TRANSCRIPT = [
  { role: "agent", text: "Welches Fahrzeugmodell ist es denn?" },
  { role: "caller", text: "Das muessten Sie mir sagen." },
];
const FIRST = "Fahrzeugmodell an die Werkstatt mitteilen.";
const REPHRASED = "Werkstatt erneut kontaktieren, um den Inspektionstermin zu vereinbaren.";

const MOCK = { summary: "Zusammenfassung.", actionItems: [], objective_achieved: "unclear" };

function anthropicMessage() {
  return {
    id: "msg_gqp14_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: JSON.stringify(MOCK) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

let server;
let lastRequest = null;
let store, claude, LOCALES, SUPPORTED_LANGUAGES;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastRequest = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicMessage()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-gqp14-key";

  const calls = [
    seedCall({ id: "call_gqp14_items", goal: GOAL, transcript: TRANSCRIPT }),
    seedCall({ id: "call_gqp14_empty", goal: GOAL, transcript: TRANSCRIPT }),
    seedCall({ id: "call_gqp14_split", goal: GOAL, transcript: TRANSCRIPT }),
    seedCall({ id: "call_gqp14_de", goal: GOAL, transcript: TRANSCRIPT }),
    seedCall({ id: "call_gqp14_en", goal: GOAL, transcript: TRANSCRIPT, language: "en" }),
    seedCall({ id: "call_gqp14_fr", goal: GOAL, transcript: TRANSCRIPT, language: "fr" }),
    seedCall({ id: "call_gqp14_format", goal: GOAL, transcript: TRANSCRIPT }),
  ];
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
  ({ LOCALES, SUPPORTED_LANGUAGES } = await import("../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const userContent = () => lastRequest.messages[0].content;
const rec = (lang = "de") => LOCALES[lang].prompt.recorded;

test("GQ-P14-1: zwei notierte Nachrichten stehen wortgetreu im Zusammenfassungs-Prompt", async () => {
  const call = store.getCall("call_gqp14_items");
  store.addActionItem(call.id, FIRST, "todo");
  store.addActionItem(call.id, REPHRASED, "todo");

  await claude.summarizeCall(call);

  assert.ok(userContent().includes(rec().heading), "Ueberschrift fehlt im Zusammenfassungs-Prompt");
  assert.ok(userContent().includes(`- ${FIRST}`), "erste Notiz fehlt");
  assert.ok(userContent().includes(`- ${REPHRASED}`), "zweite Notiz fehlt");
});

test("GQ-P14-2: nichts notiert -> der Zusammenfassungs-Prompt ist byte-identisch zum Bestand", async () => {
  const call = store.getCall("call_gqp14_empty");
  const si = LOCALES.de.prompt.summaryInput;
  const convo = TRANSCRIPT.map(
    (t) => `${t.role === "agent" ? si.agentRole : si.callerRole}: ${t.text}`,
  ).join("\n");
  const erwartet = `${si.directionLabel} ${call.direction}\n${si.goalLabel} ${GOAL}\n\n${si.transcriptLabel}\n${convo}`;

  await claude.summarizeCall(call);

  assert.equal(userContent(), erwartet);
  assert.ok(!userContent().includes(rec().heading), "ohne Notizen darf kein Block auftauchen");
});

for (const lang of ["de", "en", "fr"]) {
  test(`GQ-P14-3 ${lang}: der Block rendert in der Sprache des Calls`, async () => {
    const call = store.getCall(`call_gqp14_${lang}`);
    store.addActionItem(call.id, FIRST, "todo");

    await claude.summarizeCall(call);

    assert.ok(userContent().includes(rec(lang).heading), `${lang}: Ueberschrift fehlt`);
    assert.ok(
      userContent().includes(rec(lang).summaryGuardrail),
      `${lang}: summaryGuardrail fehlt`,
    );
  });
}

test("GQ-P14-4: der Block haengt an der ZUSAMMENFASSUNG, nicht am Gespraechs-Systemprompt", async () => {
  const call = store.getCall("call_gqp14_split");
  store.addActionItem(call.id, FIRST, "todo");

  const prompt = claude.systemPrompt(call);
  await claude.summarizeCall(call);

  assert.ok(prompt.includes(rec().guardrail), "Gespraechs-Guardrail fehlt im Systemprompt");
  assert.ok(
    !prompt.includes(rec().summaryGuardrail),
    "summaryGuardrail darf NICHT im Gespraechs-Systemprompt stehen",
  );
  assert.ok(
    userContent().includes(rec().summaryGuardrail),
    "summaryGuardrail fehlt im Zusammenfassungs-Prompt",
  );
  assert.ok(
    !userContent().includes(rec().guardrail),
    "Gespraechs-Guardrail darf NICHT im Zusammenfassungs-Prompt stehen",
  );
});

test("GQ-P14-5: jede Sprache traegt einen eigenen Nachbereitungs-Hinweis", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const r = LOCALES[language].prompt.recorded;
    assert.equal(typeof r.summaryGuardrail, "string", `${language}: summaryGuardrail fehlt`);
    assert.ok(r.summaryGuardrail.length > 0, `${language}: summaryGuardrail ist leer`);
    assert.notEqual(
      r.summaryGuardrail,
      r.guardrail,
      `${language}: summaryGuardrail darf nicht mit guardrail identisch sein`,
    );
    assert.match(r.summaryGuardrail, /actionItems/, `${language}: JSON-Key actionItems fehlt`);
  }
});

test("GQ-P14-6: Gespraech und Zusammenfassung zeigen DIESELBE Liste in derselben Form", async () => {
  const call = store.getCall("call_gqp14_format");
  store.addActionItem(call.id, FIRST, "todo");
  store.addActionItem(call.id, REPHRASED, "todo");

  const prompt = claude.systemPrompt(call);
  await claude.summarizeCall(call);

  const lines = `- ${FIRST}\n- ${REPHRASED}`;
  assert.ok(prompt.includes(lines), "Zeilenfolge fehlt im Gespraechs-Systemprompt");
  assert.ok(userContent().includes(lines), "Zeilenfolge fehlt im Zusammenfassungs-Prompt");
});
