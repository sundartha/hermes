import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { test } from "node:test";
import { startServer, seedState, OWNER_TEST_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";

const NATUERLICH = Object.freeze({
  de: '- Sprich wie ein Mensch am Telefon, nicht wie vorgelesener Text: Umgangssprache statt Schriftsprache, keine Floskeln wie "Gerne helfe ich Ihnen dabei". Bestätige kurz, zum Beispiel "Ah, okay" oder "Verstehe", gehe erst auf das Gesagte ein und frage dann weiter.',
  en: '- Sound like a person on the phone, not like text being read out: everyday speech instead of written language, no filler phrases like "Happy to help you with that". Acknowledge briefly, for example "Ah, okay" or "I see", respond to what was said first, then ask on.',
  fr: '- Parle comme une personne au téléphone, pas comme un texte lu à voix haute : langue de tous les jours plutôt que langue écrite, pas de formules comme "Avec plaisir, je vous aide". Confirme brièvement, par exemple "Ah, d\'accord" ou "Je vois", réagis d\'abord à ce qui a été dit, puis pose la question suivante.',
});
const ZURUECKHALTUNG = Object.freeze({
  de: '- Bleibe ruhig und sachlich-freundlich: keine Begeisterung, keine Ausrufe, keine überschwänglichen Bestätigungen wie "Super" oder "Wunderbar". Gefühl zeigst du nur, wenn dein Gegenüber es vorgibt.',
  en: '- Stay calm and matter-of-fact but friendly: no enthusiasm, no exclamations, no gushing confirmations like "Great" or "Wonderful". Show feeling only when the other person sets that tone.',
  fr: '- Reste calme, factuel et aimable : pas d\'enthousiasme, pas d\'exclamations, pas de confirmations exubérantes comme "Super" ou "Merveilleux". Tu n\'exprimes un sentiment que si ton interlocuteur donne le ton.',
});
const ALTE_REGELN = Object.freeze({
  de: "Höchstens zwei gesprochene Sätze pro Antwort, höchstens eine Frage darin.",
  en: "At most two spoken sentences per reply, at most one question in it.",
  fr: "Deux phrases orales maximum par réponse, une seule question au maximum.",
});
const KEIN_MARKDOWN = Object.freeze({
  de: "Kein Markdown, keine Aufzählungen, keine Emojis.",
  en: "No markdown, no bullet lists, no emojis.",
  fr: "Pas de markdown, pas de listes à puces, pas d'émojis.",
});
const VORLAGE_NATUERLICH =
  'Sound like a person on the phone, not like text being read out: everyday speech instead of written language, no filler phrases like "Happy to help you with that". Acknowledge briefly, for example "Ah, okay" or "I see", respond to what was said first, then ask on. Stay calm and matter-of-fact but friendly: no enthusiasm, no exclamations, no gushing confirmations like "Great" or "Wonderful". Show feeling only when the other person sets that tone.';

const textMessage = (text) => ({
  id: "msg_sprechregeln",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 6 },
});

async function startCapturingMock() {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (teil) => (raw += teil));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(textMessage("Okay.")));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    bodies,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function promptDesGespraechs(language) {
  const mock = await startCapturingMock();
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({ settings: { language } }),
  });
  try {
    await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: `CAsprech${language}`, From: "+15005550101", To: OWNER_TEST_NUMBER.e164 }),
    });
    const call = srv.readStore().calls.find((anruf) => anruf.status === "active");
    await abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${call.id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Hello" }),
    });
    const [anfrage] = mock.bodies;
    return anfrage.system.map((block) => block.text).join("\n");
  } finally {
    await srv.stop();
    await mock.close();
  }
}

const speechRulesOf = promptDesGespraechs;
const zeilenOf = (text) => text.split("\n");

const masterPrompt = () => {
  const vorlage = JSON.parse(readFileSync(new URL(`../../${TEMPLATE_REL}`, import.meta.url), "utf8"));
  const { agent } = vorlage.agent.conversation_config;
  return agent.prompt.prompt;
};
const abschnitt = (prompt, titel) => {
  const start = prompt.indexOf(`${titel}:\n`);
  const ende = prompt.indexOf("\n\n", start);
  return prompt.slice(start, ende);
};

for (const lang of ["de", "en", "fr"]) {
  test(`speechRules (${lang}) tragen die Regel fuer gesprochene Sprache`, async () => {
    assert.ok(zeilenOf(await speechRulesOf(lang)).includes(NATUERLICH[lang]));
  });
  test(`speechRules (${lang}) tragen die Zurueckhaltung ohne Begeisterung`, async () => {
    assert.ok(zeilenOf(await speechRulesOf(lang)).includes(ZURUECKHALTUNG[lang]));
  });
  test(`speechRules (${lang}) behalten zwei Saetze, eine Frage und kein Markdown`, async () => {
    const regeln = await speechRulesOf(lang);
    assert.ok(regeln.includes(ALTE_REGELN[lang]));
    assert.ok(regeln.includes(KEIN_MARKDOWN[lang]));
  });
}

test("Master-Prompt der Vorlage traegt dieselben Regeln in HOW YOU SPEAK", () => {
  const sprechen = abschnitt(masterPrompt(), "HOW YOU SPEAK");
  assert.ok(sprechen.includes(VORLAGE_NATUERLICH));
  assert.ok(sprechen.includes("Keep your replies short (one to two sentences), at most one question per turn."));
});
