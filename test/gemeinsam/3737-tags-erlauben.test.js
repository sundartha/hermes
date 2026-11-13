import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { test } from "node:test";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { OWNER_TEST_NUMBER, seedState, startServer } from "../helpers.js";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const ERWARTETES_SET = ["calm", "thoughtful", "warmly", "softly", "gently", "patient"];
const LISTE = ERWARTETES_SET.join(", ");
const MAX_TAG_ZEICHEN = 30;
const MAX_BESCHREIBUNG_ZEICHEN = 200;
const MAX_TAGS = 8;

const TEMPLATE_REGEL =
  "Never write square brackets, with one exception: you may rarely put exactly one tag from this fixed list, " +
  `written in square brackets, directly before a sentence: ${LISTE}. At most one tag per answer; when in doubt, use none. ` +
  "Every other bracketed word would be read out to the other party and would stay in the written record of this call. " +
  "Otherwise convey mood through word choice and pacing only.";

const SPEECH_TAGS = {
  de: `Keine eckigen Klammern und keine Regieanweisungen im Gesprochenen, mit einer Ausnahme: Selten darfst du genau ein Tag aus dieser festen Liste in eckigen Klammern direkt vor einen Satz setzen: ${LISTE}. Höchstens eines pro Antwort, im Zweifel keines. Jede andere Klammer wird dem Gegenüber vorgelesen und bleibt im Protokoll stehen. Stimmung trägst du sonst nur über die Wortwahl.`,
  en: `No square brackets and no stage directions in spoken text, with one exception: you may rarely put exactly one tag from this fixed list in square brackets directly before a sentence: ${LISTE}. At most one per answer, when in doubt none. Every other bracketed word is read out to the other person and stays in the record. Otherwise convey mood through word choice only.`,
  fr: `Aucun crochet ni indication de mise en scène dans le texte parlé, avec une exception : tu peux rarement placer exactement une balise de cette liste fixe entre crochets juste avant une phrase : ${LISTE}. Une seule au maximum par réponse, dans le doute aucune. Tout autre mot entre crochets est lu à voix haute à l'interlocuteur et reste dans le protocole. Sinon l'humeur passe uniquement par le choix des mots.`,
};

const vorlage = () => JSON.parse(readFileSync(new URL(`../../${TEMPLATE_REL}`, import.meta.url), "utf8"));
const konfiguration = () => vorlage().agent.conversation_config;
const antwort = {
  id: "msg_tags",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text: "Okay." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 6 },
};

let modellText = "Okay.";

async function startMock() {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (teil) => (raw += teil));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ...antwort, content: [{ type: "text", text: modellText }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { bodies, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((fertig) => server.close(fertig)) };
}

async function sprachausgabe(language, text) {
  modellText = text;
  const mock = await startMock();
  const srv = await startServer({ env: { ANTHROPIC_BASE_URL: mock.url }, seed: seedState({ settings: { language } }) });
  try {
    await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: `CAsay${language}`, From: "+15005550101", To: OWNER_TEST_NUMBER.e164 }),
    });
    const call = srv.readStore().calls.find((anruf) => anruf.status === "active");
    const antwortXml = await abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${call.id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Hello" }),
    });
    return await antwortXml.text();
  } finally {
    modellText = "Okay.";
    await srv.stop();
    await mock.close();
  }
}

async function promptRegeln(language) {
  const mock = await startMock();
  const srv = await startServer({ env: { ANTHROPIC_BASE_URL: mock.url }, seed: seedState({ settings: { language } }) });
  try {
    await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: `CAtags${language}`, From: "+15005550101", To: OWNER_TEST_NUMBER.e164 }),
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

test("Vorlage: suggested_audio_tags sind genau das Set, mit Beschreibung im Anbieter-Rahmen", () => {
  const tags = konfiguration().tts.suggested_audio_tags;
  assert.deepEqual(tags.map((eintrag) => eintrag.tag), ERWARTETES_SET);
  assert.ok(tags.length <= MAX_TAGS);
  for (const eintrag of tags) {
    assert.deepEqual(Object.keys(eintrag).sort(), ["description", "tag"]);
    assert.ok(eintrag.tag.length <= MAX_TAG_ZEICHEN, eintrag.tag);
    assert.ok(eintrag.description.length > 0, eintrag.tag);
    assert.ok(eintrag.description.length <= MAX_BESCHREIBUNG_ZEICHEN, eintrag.tag);
  }
});

test("Vorlage: der Master-Prompt erlaubt genau das Set und bleibt frei von Klammerzeichen", () => {
  const prompt = konfiguration().agent.prompt.prompt;
  assert.ok(prompt.includes(TEMPLATE_REGEL));
  assert.ok(!/[[\]]/.test(prompt));
  assert.ok(!prompt.includes("Never write square brackets. Everything"));
});

for (const sprache of Object.keys(SPEECH_TAGS)) {
  test(`speechRules ${sprache}: erlaubt genau das Set, selten, höchstens eines, ohne Klammerzeichen`, async () => {
    const regeln = await promptRegeln(sprache);
    assert.ok(regeln.includes(SPEECH_TAGS[sprache]));
    assert.ok(!/[[\]]/.test(regeln));
  });
}

test("Soft-Timeout-Anweisung verbietet weiter jede Klammer (Füllsätze bekommen keine Tags)", () => {
  const text = konfiguration().turn.soft_timeout_config.llm_generated_message_prompt_override;
  assert.ok(text.includes("Never write anything in square brackets"));
});

for (const [sprache, text, erwartet] of [
  ["de", "[calm] Okay, verstehe.", "Okay, verstehe."],
  ["en", "[calm] Okay, I see. [freundlich] Go on.", "Okay, I see. Go on."],
  ["fr", "[calm] D'accord, je comprends.", "D'accord, je comprends."],
]) {
  test(`/voice/turn ${sprache}: kein Tag landet im gesprochenen Text`, async () => {
    const xml = await sprachausgabe(sprache, text);
    assert.ok(xml.includes(`>${erwartet.replaceAll("'", "&apos;")}</Say>`) || xml.includes(`>${erwartet}</Say>`), xml);
    assert.ok(!/[[\]]/.test(xml), xml);
    assert.ok(!xml.includes("calm"), xml);
  });
}
