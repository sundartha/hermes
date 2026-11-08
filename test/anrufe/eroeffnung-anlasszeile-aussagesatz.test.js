import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  TELNYX_TEST_OWNER_NUMBER,
  TELNYX_TEST_PEER_NUMBER,
  seedState,
  startServer,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const AGENT_ID = "agent_anlass_test";
const GOAL_AUSSAGE = "Termin zur Bremsenprüfung vereinbaren (ANLASS)";
const GOAL_FRAGE = "Hast du morgen um 15 Uhr Zeit für eine Runde Tennis?";

const FALLBACK = Object.freeze({
  de: "Ich rufe an, um ein kurzes Anliegen zu klären.",
  en: "I am calling to sort out a small matter with you.",
  fr: "J'appelle pour régler une petite demande.",
});
const GUT = Object.freeze({
  de: "Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.",
  en: "I am calling to arrange a brake inspection appointment.",
  fr: "J'appelle pour prendre rendez-vous pour un contrôle des freins.",
});
const UNBRAUCHBAR = Object.freeze({
  de: {
    Frage: "Hast du morgen Zeit für einen Termin?",
    "falsche Form": "Es geht um einen Termin zur Bremsenprüfung.",
    "zwei Sätze": "Ich rufe an, um einen Termin zu vereinbaren. Es ist eilig.",
    "KI-Satz": "Ich rufe an, um zu sagen, dass hier spricht ein KI-Assistent im Auftrag von Max.",
  },
  en: {
    Frage: "Do you have time tomorrow for an appointment?",
    "falsche Form": "This is about a brake inspection appointment.",
    "zwei Sätze": "I am calling to arrange an appointment. It is urgent.",
    "KI-Satz": "I am calling to say this is an AI assistant calling on behalf of Max.",
  },
  fr: {
    Frage: "As-tu le temps demain pour un rendez-vous ?",
    "falsche Form": "Il s'agit d'un rendez-vous pour les freins.",
    "zwei Sätze": "J'appelle pour prendre rendez-vous. C'est urgent.",
    "KI-Satz": "J'appelle pour dire que ceci est un assistant IA mandaté par Max.",
  },
});

function endJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function startAnbieterAttrappen(modellZeile) {
  const starts = [];
  const systeme = [];
  const elevenlabs = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!req.url.startsWith("/v1/convai/sip-trunk/outbound-call")) {
        return endJson(res, HTTP_NOT_FOUND, {});
      }
      starts.push(JSON.parse(raw));
      return endJson(res, HTTP_OK, { success: true, conversation_id: "conv_anlass", sip_call_id: "s" });
    });
  });
  const llm = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const anfrage = JSON.parse(raw);
      const hatWerkzeug = (anfrage.tools ?? []).some((tool) => tool.name === "eroeffnungszeile");
      if (!hatWerkzeug) return endJson(res, HTTP_NOT_FOUND, { type: "error", error: { type: "not_found_error", message: "x" } });
      const system = Array.isArray(anfrage.system) ? anfrage.system.map((b) => b.text).join("\n") : anfrage.system;
      systeme.push(system);
      return endJson(res, HTTP_OK, {
        id: "msg_anlass",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "tool_use", id: "tu_anlass", name: "eroeffnungszeile", input: { reason: modellZeile.wert } }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 60, output_tokens: 25 },
      });
    });
  });
  await Promise.all([elevenlabs, llm].map((s) => new Promise((resolve) => s.listen(0, "127.0.0.1", resolve))));
  const url = (s) => `http://127.0.0.1:${s.address().port}`;
  return {
    starts,
    systeme,
    elevenlabsUrl: url(elevenlabs),
    llmUrl: url(llm),
    close: () => Promise.all([elevenlabs, llm].map((s) => new Promise((resolve) => s.close(resolve)))),
  };
}

async function anruf({ goal, language, modellZeile, llmAn = true }) {
  const zeile = { wert: modellZeile };
  const attrappen = await startAnbieterAttrappen(zeile);
  const srv = await startServer({
    env: {
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_AGENT_ID: AGENT_ID,
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_anlass",
      ELEVENLABS_API_KEY: "el-key-anlass",
      ELEVENLABS_API_BASE: attrappen.elevenlabsUrl,
      ELEVENLABS_OPENING_LINE_LLM_ENABLED: String(llmAn),
      ANTHROPIC_BASE_URL: attrappen.llmUrl,
      ANTHROPIC_API_KEY: "test-anlass-key",
      LLM_BREAKER_THRESHOLD: "100",
    },
    seed: seedState({}),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: goal, language }),
    });
    assert.equal(res.status, HTTP_OK, await res.text());
    const { dynamic_variables: variablen } = attrappen.starts[0].conversation_initiation_client_data;
    return { openingLine: variablen.opening_line, systeme: attrappen.systeme };
  } finally {
    await srv.stop();
    await attrappen.close();
  }
}

test("E4 Anlasszeile in Ich-Form aus dem Modell wird je Sprache übernommen", async () => {
  for (const lang of Object.keys(GUT)) {
    const { openingLine } = await anruf({ goal: GOAL_AUSSAGE, language: lang, modellZeile: GUT[lang] });
    assert.ok(openingLine.startsWith(GUT[lang]), `Sprache ${lang}: ${openingLine}`);
  }
});

async function pruefeRueckfall(lang) {
  for (const [fall, zeile] of Object.entries(UNBRAUCHBAR[lang])) {
    const { openingLine } = await anruf({ goal: GOAL_FRAGE, language: lang, modellZeile: zeile });
    assert.ok(openingLine.startsWith(FALLBACK[lang]), `${lang} ${fall}: ${openingLine}`);
    assert.ok(!openingLine.includes(zeile), `${lang} ${fall}: ${openingLine}`);
  }
}

test("E4 de: Frage, falsche Form, zwei Sätze und KI-Satz vom Modell fallen auf den festen Rückfall", async () => {
  await pruefeRueckfall("de");
});

test("E4 en: Frage, falsche Form, zwei Sätze und KI-Satz vom Modell fallen auf den festen Rückfall", async () => {
  await pruefeRueckfall("en");
});

test("E4 fr: Frage, falsche Form, zwei Sätze und KI-Satz vom Modell fallen auf den festen Rückfall", async () => {
  await pruefeRueckfall("fr");
});

test("E4 Ich-Form einer fremden Sprache wird nicht übernommen", async () => {
  const { openingLine } = await anruf({ goal: GOAL_FRAGE, language: "de", modellZeile: GUT.en });
  assert.ok(openingLine.startsWith(FALLBACK.de), openingLine);
});

test("E4 Modellzeile ohne Ich-Form bei Auftrag als Aussage: der Auftrag trägt, nie die Modellzeile", async () => {
  const { openingLine } = await anruf({
    goal: GOAL_AUSSAGE,
    language: "de",
    modellZeile: UNBRAUCHBAR.de["falsche Form"],
  });
  assert.ok(openingLine.startsWith(`Es geht um Folgendes: ${GOAL_AUSSAGE}.`), openingLine);
});

test("E5 Auftrag, der selbst eine Frage ist, wird nicht Anlasszeile (ohne Modell: fester Rückfall)", async () => {
  for (const lang of Object.keys(FALLBACK)) {
    const { openingLine } = await anruf({ goal: GOAL_FRAGE, language: lang, modellZeile: "", llmAn: false });
    assert.ok(openingLine.startsWith(FALLBACK[lang]), `Sprache ${lang}: ${openingLine}`);
    assert.ok(!openingLine.includes(GOAL_FRAGE), `Sprache ${lang}: ${openingLine}`);
  }
});

test("E4 Anweisung an das Modell verlangt einen Aussagesatz in Ich-Form statt einer Frage", async () => {
  const { systeme } = await anruf({ goal: GOAL_AUSSAGE, language: "de", modellZeile: GUT.de });
  assert.equal(systeme.length, 1);
  assert.ok(systeme[0].includes("I am calling to"));
  assert.ok(systeme[0].includes("never a question"));
  assert.ok(!systeme[0].includes("already spoken right before your line"));
});
