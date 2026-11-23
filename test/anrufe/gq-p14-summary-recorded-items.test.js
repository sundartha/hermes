import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

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
  await import("../../src/config.ts");
  store = await import("../../src/store.js");
  claude = await import("../../src/claude.js");
  ({ LOCALES, SUPPORTED_LANGUAGES } = await import("../../src/i18n/locales.ts"));
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
  const anrufdatum = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(call.startedAt));
  const erwartet = `${si.directionLabel} ${call.direction}\n${si.goalLabel} ${GOAL}\n${si.callDateLabel} ${anrufdatum} (Europe/Berlin)\n\n${si.transcriptLabel}\n${convo}`;

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

test("GQ-P14-7: die Aktionspunkte der Zusammenfassung werden als todo am Anruf angelegt, in Reihenfolge", async () => {
  const call = store.getCall("call_gqp14_empty");
  MOCK.actionItems = ["Morgen zurueckrufen", "Angebot per Mail senden"];
  try {
    await claude.summarizeCall(call);
  } finally {
    MOCK.actionItems = [];
  }
  assert.deepEqual(
    store.callActionItems(call.id).map((item) => [item.text, item.type, item.done]),
    [
      ["Morgen zurueckrufen", "todo", false],
      ["Angebot per Mail senden", "todo", false],
    ],
  );
});

async function eingabeFuer(call, startedAt, createdAt) {
  await claude.summarizeCall({ ...call, id: "call_6028_ohne_notizen", startedAt, createdAt });
  return userContent();
}

test("6028-1: Datum und Zeitzone des Anrufs stehen als eigene Zeile zwischen Auftrag und Transkript", async () => {
  const call = store.getCall("call_gqp14_de");
  const inhalt = await eingabeFuer(call, "2026-03-10T08:30:00Z", undefined);
  assert.equal(
    inhalt,
    `Richtung: outbound\nAuftrag: ${GOAL}\nAnrufdatum: 2026-03-10 (Europe/Berlin)\n\nTRANSKRIPT:\nAGENT: ${TRANSCRIPT[0].text}\nANRUFER: ${TRANSCRIPT[1].text}`,
  );
});

test("6028-1b: die Beschriftung der Zeile folgt der Sprache des Anrufs", async () => {
  const en = await eingabeFuer(store.getCall("call_gqp14_en"), "2026-03-10T08:30:00Z", undefined);
  assert.ok(en.includes("\nCall date: 2026-03-10 (Europe/Berlin)\n"));
  const fr = await eingabeFuer(store.getCall("call_gqp14_fr"), "2026-03-10T08:30:00Z", undefined);
  assert.ok(fr.includes("\nDate de l'appel : 2026-03-10 (Europe/Berlin)\n"));
});

test("6028-2: ohne startedAt gilt createdAt, ohne beides entfaellt die Zeile", async () => {
  const call = store.getCall("call_gqp14_de");
  const mitErstellung = await eingabeFuer(call, undefined, "2026-03-10T08:30:00Z");
  assert.ok(mitErstellung.includes("\nAnrufdatum: 2026-03-10 (Europe/Berlin)\n"));
  const ohne = await eingabeFuer(call, undefined, undefined);
  assert.ok(!ohne.includes("Anrufdatum"));
  assert.equal(ohne, `Richtung: outbound\nAuftrag: ${GOAL}\n\nTRANSKRIPT:\nAGENT: ${TRANSCRIPT[0].text}\nANRUFER: ${TRANSCRIPT[1].text}`);
});

test("6028-3: das Datum wird in der Zeitzone des Mandanten berechnet", async () => {
  const call = store.getCall("call_gqp14_de");
  const berlin = await eingabeFuer(call, "2026-03-10T23:30:00Z", undefined);
  assert.ok(berlin.includes("Anrufdatum: 2026-03-11 (Europe/Berlin)"));
  store.setTenantGeo(BOOTSTRAP_TENANT_ID, { timezone: "America/New_York" });
  try {
    const newYork = await eingabeFuer(call, "2026-03-10T02:30:00Z", undefined);
    assert.ok(newYork.includes("Anrufdatum: 2026-03-09 (America/New_York)"));
  } finally {
    store.setTenantGeo(BOOTSTRAP_TENANT_ID, { timezone: null });
  }
});
