import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { test } from "node:test";
import { startServer, seedState, OWNER_TEST_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TEMPLATE = JSON.parse(
  readFileSync(new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url), "utf8"),
);

const MENUE_REGEL = Object.freeze({
  de: "- Läuft ein automatisches Auswahlmenü, höre die Ansage bis zum Ende an, bevor du etwas tust. Drücke nur nach ausdrücklicher Aufforderung und nur die Taste, die die Ansage für dein Anliegen nennt; Stern und Raute nur, wenn die Ansage sie nennt. Achte nach der Wahl auf die Reaktion: Heißt es ungültig oder wird das Menü wiederholt, wähle neu, statt zu raten. Bei Wartemusik wartest du geduldig auf die Weiterleitung. Beende das Gespräch nie, solange das Menü läuft und noch kein Mensch dran ist.",
  en: "- While an automated menu is running, listen to the announcement to the end before you do anything. Press a key only when the announcement explicitly asks you to, and only the key it names for your request; star or pound only if the announcement names them. After choosing, watch the reaction: if it says invalid or the menu repeats, choose again instead of guessing. During hold music, wait patiently for the transfer. Never end the call while the menu is running and no person has come on the line.",
  fr: "- Pendant qu'un menu vocal automatique est en cours, écoute l'annonce jusqu'au bout avant de faire quoi que ce soit. N'appuie sur une touche que si l'annonce te le demande expressément, et seulement sur la touche qu'elle indique pour ta demande ; étoile et dièse uniquement si l'annonce les nomme. Après ton choix, observe la réaction : si elle dit invalide ou si le menu se répète, choisis à nouveau au lieu de deviner. Pendant la musique d'attente, attends patiemment le transfert. Ne termine jamais l'appel tant que le menu est en cours et qu'aucune personne n'est en ligne.",
});

const MENUE_ANSAGEN = Object.freeze([
  "Willkommen in der Praxis. Für Terminvereinbarung drücken Sie die 1, für Rezepte die 2.",
  "Ungültige Eingabe. Für Terminvereinbarung drücken Sie die 1, für Rezepte die 2.",
  "Für Absagen drücken Sie die 1, für Verschiebungen die 2.",
]);

const textMessage = (text) => ({
  id: "msg_menue",
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

async function promptsImMenue(language) {
  const mock = await startCapturingMock();
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({ settings: { language } }),
  });
  try {
    await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: `CAmenue${language}`, From: "+15005550101", To: OWNER_TEST_NUMBER.e164 }),
    });
    const call = srv.readStore().calls.find((anruf) => anruf.status === "active");
    for (const ansage of MENUE_ANSAGEN) {
      await abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${call.id}`, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: ansage }),
      });
    }
    return mock.bodies.map((anfrage) => anfrage.system.map((block) => block.text).join("\n"));
  } finally {
    await srv.stop();
    await mock.close();
  }
}

const masterPrompt = () => TEMPLATE.agent.conversation_config.agent.prompt.prompt;
const abschnitt = (prompt, titel) => {
  const start = prompt.indexOf(`${titel}:\n`);
  assert.ok(start >= 0, `Abschnitt ${titel} fehlt`);
  return prompt.slice(start, prompt.indexOf("\n\n", start));
};

for (const lang of ["de", "en", "fr"]) {
  test(`Menue-Regel (${lang}): in jedem Zug eines Menues traegt der Prompt die ganze Regel`, async () => {
    const prompts = await promptsImMenue(lang);
    assert.equal(prompts.length, MENUE_ANSAGEN.length);
    for (const prompt of prompts) {
      assert.equal(prompt.split("\n").filter((zeile) => zeile === MENUE_REGEL[lang]).length, 1);
    }
  });
}

test("Menue-Regel (de): die Regel steht in SO SPRICHST DU", async () => {
  const [prompt] = await promptsImMenue("de");
  const sprechen = abschnitt(prompt, "SO SPRICHST DU");
  assert.ok(sprechen.includes(MENUE_REGEL.de));
});

test("Menue-Regel: die Regel traegt keine eckige Klammer", () => {
  for (const regel of Object.values(MENUE_REGEL)) assert.doesNotMatch(regel, /[\[\]]/);
});

test("Master-Prompt der Vorlage hat den Abschnitt AUTOMATED MENUS mit derselben Regel", () => {
  const menue = abschnitt(masterPrompt(), "AUTOMATED MENUS");
  assert.equal(menue, `AUTOMATED MENUS:\n${MENUE_REGEL.en.slice(2)}`);
});

test("Master-Prompt der Vorlage: CLOSING gilt nicht, solange ein Menue laeuft", () => {
  const abschluss = abschnitt(masterPrompt(), "CLOSING");
  assert.ok(
    abschluss.includes(
      "While an automated menu is running, the result is not settled and you do not call end_call; see AUTOMATED MENUS.",
    ),
  );
});

test("Master-Prompt der Vorlage: AUTOMATED MENUS steht vor CLOSING", () => {
  const prompt = masterPrompt();
  assert.ok(prompt.indexOf("AUTOMATED MENUS:\n") > prompt.indexOf("HOW YOU SPEAK:\n"));
  assert.ok(prompt.indexOf("AUTOMATED MENUS:\n") < prompt.indexOf("CLOSING:\n"));
});
