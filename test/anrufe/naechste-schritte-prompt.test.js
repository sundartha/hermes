import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const TRANSCRIPT = [
  { role: "agent", text: "Passt der 20. November um 10 Uhr?" },
  { role: "caller", text: "Ja, 20.11. um 10:00 bei Dr. X." },
];

let modelAnswer = {};
let lastRequest = null;
let server;
let store, claude, LOCALES;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastRequest = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_ns_mock",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: JSON.stringify(modelAnswer) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 30 },
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-naechste-schritte-key";
  const sprachen = ["de", "en", "fr"];
  const calls = [
    ...sprachen.map((language) =>
      seedCall({ id: `call_ns_${language}`, transcript: TRANSCRIPT, language }),
    ),
    seedCall({ id: "call_ns_leer", transcript: TRANSCRIPT }),
    seedCall({ id: "call_ns_schritte", transcript: TRANSCRIPT }),
  ];
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls,
    }),
  );
  await import("../../src/config.js");
  store = await import("../../src/store.js");
  claude = await import("../../src/claude.js");
  ({ LOCALES } = await import("../../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const PHRASEN = {
  de: [
    "next_steps",
    "hoechstens 3",
    "ausdruecklich belegt",
    "Erfinde nichts",
    "nichts in einen Kalender",
  ],
  en: [
    "next_steps",
    "at most 3",
    "explicitly supported",
    "Invent nothing",
    "not enter anything into a calendar",
  ],
  fr: [
    "next_steps",
    "au maximum 3",
    "expressément étayées",
    "N'invente rien",
    "n'inscrit rien dans un agenda",
  ],
};

for (const lang of ["de", "en", "fr"]) {
  test(`Zusammenfassungs-Prompt (${lang}) verlangt next_steps nur mit Beleg und ohne Kalendereintrag`, async () => {
    await claude.summarizeCall(store.getCall(`call_ns_${lang}`));
    for (const phrase of PHRASEN[lang]) {
      assert.ok(lastRequest.system.includes(phrase), `${lang}: "${phrase}" fehlt im Prompt`);
    }
    assert.ok(lastRequest.system.includes('"type": "appointment"|"callback"|"task"|"other"'));
    assert.ok(lastRequest.system.includes(LOCALES[lang].summaryNextStepsClause));
    assert.ok(lastRequest.system.startsWith(LOCALES[lang].summarySystem("Jonas Beispiel")));
  });
}

test("Antwort mit next_steps landet strukturiert in der Ergebnis-Karte", async () => {
  modelAnswer = {
    summary: "Termin vereinbart.",
    outcome: "Termin am 20.11. 10:00.",
    next_step: "Termin eintragen.",
    next_steps: [
      {
        type: "appointment",
        text: "Termin mit Dr. X, bitte in den Kalender eintragen",
        at: "2026-11-20T10:00",
      },
    ],
  };
  await claude.summarizeCall(store.getCall("call_ns_schritte"));
  const karte = store.getCall("call_ns_schritte").result;
  assert.deepEqual(karte.nextSteps, [
    {
      type: "appointment",
      text: "Termin mit Dr. X, bitte in den Kalender eintragen",
      at: "2026-11-20T10:00",
    },
  ]);
  assert.equal(karte.nextStep, "Termin eintragen.");
});

test("Antwort ohne next_steps ergibt eine leere Liste, nichts erfunden", async () => {
  modelAnswer = { summary: "Nichts weiter.", outcome: "Auskunft erhalten." };
  await claude.summarizeCall(store.getCall("call_ns_leer"));
  assert.deepEqual(store.getCall("call_ns_leer").result.nextSteps, []);
});
