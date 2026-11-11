import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

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

let systemPrompt;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
    }),
  );
  await import("../src/config.js");
  ({ systemPrompt } = await import("../src/claude.js"));
});

const speechRulesOf = (language) =>
  systemPrompt(seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: "outbound", language }));
const zeilenOf = (text) => text.split("\n");

const masterPrompt = () => {
  const vorlage = JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));
  return vorlage.agent.conversation_config.agent.prompt.prompt;
};
const abschnitt = (prompt, titel) => {
  const start = prompt.indexOf(`${titel}:\n`);
  const ende = prompt.indexOf("\n\n", start);
  return prompt.slice(start, ende);
};

for (const lang of ["de", "en", "fr"]) {
  test(`speechRules (${lang}) tragen die Regel fuer gesprochene Sprache`, () => {
    assert.ok(zeilenOf(speechRulesOf(lang)).includes(NATUERLICH[lang]));
  });
  test(`speechRules (${lang}) tragen die Zurueckhaltung ohne Begeisterung`, () => {
    assert.ok(zeilenOf(speechRulesOf(lang)).includes(ZURUECKHALTUNG[lang]));
  });
  test(`speechRules (${lang}) behalten zwei Saetze, eine Frage und kein Markdown`, () => {
    const regeln = speechRulesOf(lang);
    assert.ok(regeln.includes(ALTE_REGELN[lang]));
    assert.ok(regeln.includes(KEIN_MARKDOWN[lang]));
  });
}

test("Master-Prompt der Vorlage traegt dieselben Regeln in HOW YOU SPEAK", () => {
  const sprechen = abschnitt(masterPrompt(), "HOW YOU SPEAK");
  assert.ok(sprechen.includes(VORLAGE_NATUERLICH));
  assert.ok(sprechen.includes("Keep your replies short (one to two sentences), at most one question per turn."));
});
