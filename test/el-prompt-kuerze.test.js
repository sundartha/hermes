import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

const conversationConfig = TEMPLATE.agent?.conversation_config ?? {};
const agentSection = conversationConfig.agent ?? {};
const PROMPT = agentSection.prompt?.prompt ?? "";

const SECTION_SEPARATOR = "\n\n";

const sentencesOf = (text) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
const anySentenceMatchesAll = (text, concepts) =>
  sentencesOf(text).some((sentence) => concepts.every((concept) => concept.test(sentence)));

const NEGATION = /\b(do not|don't|never|must not|avoid|refrain)\b/i;
const SUMMARY = /\bsummar\w*/i;
const END_CALL = /\bend_call\b/;

const REQUIRED_BREVITY_RULES = Object.freeze([
  {
    label: "(a) nichts wiederholen, was die Gegenseite bereits bestaetigt hat",
    concepts: [NEGATION, /\b(repeat|restate)\w*/i, /\b(confirm|agree|settle)\w*/i],
    why: "der gemessene Befund: derselbe Termin dreimal, bei 73 s, bei 89 s und im end_call-Grund",
  },
  {
    label: "(b) GENAU EINE Zusammenfassung, am Ende",
    concepts: [/\b(once|single|one)\b/i, SUMMARY],
    why: "ohne die Zahl ist 'fasse zusammen' eine Einladung, es mehrfach zu tun",
  },
  {
    label: "(c) kein lautes Denken, keine Fuellsequenz",
    concepts: [NEGATION, /\b(think out loud|thinking aloud|narrate|filler)\w*/i],
    why: "jeder Fuellzug kostet einen ganzen LLM-Zug - und Zuege treiben die Kosten, nicht Sekunden",
  },
  {
    label: "(d) keine Frage, die an niemanden gerichtet ist",
    concepts: [NEGATION, /\bquestions?\b/i, /\b(nobody|no one|no-one)\b/i],
    why: 'der gemessene Befund: "[Curious] Wer ist Ihr Auftraggeber?" mitten im Gespraech',
  },
  {
    label: "(e) keine Emotions-/Audio-Tags in eckigen Klammern im gesprochenen Text",
    concepts: [NEGATION, /\b(square brackets|brackets|tags?)\b/i],
    why: "was das Modell schreibt, wird gesprochen - ein Tag im Text ist ein gesprochener Tag",
  },
  {
    label: "(f) Ziel erreicht -> verabschieden und end_call ziehen",
    concepts: [END_CALL, /\b(goodbye|hang up|end the call)\b/i],
    why: "ohne den Zug legt niemand auf, und der Anruf laeuft in die Anbieter-Notbremse",
  },
]);

const CONTROL_OK = [
  "Never restate something your counterpart has already confirmed.",
  "Give a single summary at the very end and leave it at that.",
  "Do not narrate your own reasoning while the other person waits.",
  "Never pose a question that nobody on this line is supposed to answer.",
  "Do not put emotion tags in square brackets into anything you say.",
  "Say goodbye and call end_call the moment the aim is reached.",
].join("\n");

const CONTROL_ALT = [
  "Keep your replies short (one to two sentences), at most one question per turn.",
  "At the end, briefly summarize what was agreed or found out, and say goodbye politely.",
  "Once the task is done, you may offer a helpful next step. If you lack information for " +
    "that, or the other person doesn't continue, wrap up politely.",
  "At the end, say goodbye in one sentence and then call end_call.",
].join("\n");
const ALTE_REGEL = "(f) Ziel erreicht -> verabschieden und end_call ziehen";

test("Kuerze im ElevenLabs-Prompt: das Messwerkzeug greift - Paraphrase besteht alles, der Stand von vorher nur die alte Regel", () => {
  for (const rule of REQUIRED_BREVITY_RULES) {
    assert.ok(
      anySentenceMatchesAll(CONTROL_OK, rule.concepts),
      `Messwerkzeug defekt: die erlaubte Paraphrase erfuellt ${rule.label} nicht - die ` +
        "Zusicherung klebt am Wortlaut der Vorlage statt am Kern.",
    );
  }

  for (const rule of REQUIRED_BREVITY_RULES) {
    const erwartet = rule.label === ALTE_REGEL;
    assert.equal(
      anySentenceMatchesAll(CONTROL_ALT, rule.concepts),
      erwartet,
      erwartet
        ? `Messwerkzeug defekt: ${rule.label} stand schon vor dem 18.08.2026 im Prompt und muesste am alten Stand anschlagen.`
        : `Messwerkzeug defekt: ${rule.label} schlaegt bereits am Stand VOR der Aenderung an - eine Regel, die immer anschlaegt, misst nichts.`,
    );
  }
});

test("Kuerze im ElevenLabs-Prompt: der Agent sagt nur das Noetigste, erledigt das Ziel und legt auf", () => {
  assert.ok(PROMPT.length > 0, `${TEMPLATE_REL}: der Prompt ist leer - dann prueft nichts etwas`);

  for (const rule of REQUIRED_BREVITY_RULES) {
    assert.ok(
      anySentenceMatchesAll(PROMPT, rule.concepts),
      `${TEMPLATE_REL}: der Prompt sagt nicht ${rule.label}. Verlangt ist der Sinn, nicht der ` +
        `Wortlaut - aber in EINEM zusammenhaengenden Satz. Warum die Regel da ist: ${rule.why}.`,
    );
  }
});

test("Kuerze im ElevenLabs-Prompt: die Abschluss-Anweisung steht genau einmal, und der Prompt macht nicht vor, was er verbietet", () => {
  const abschnitteMitEndCall = PROMPT.split(SECTION_SEPARATOR).filter((abschnitt) =>
    END_CALL.test(abschnitt),
  );
  assert.equal(
    abschnitteMitEndCall.length,
    1,
    `${TEMPLATE_REL}: end_call wird in ${abschnitteMitEndCall.length} Abschnitten verlangt. Eine ` +
      "Anweisung, die zweimal dasteht, ist selbst die Wiederholung, die dieser Auftrag " +
      "abstellt - und bei zwei Abschieds-Anweisungen verabschiedet sich der Agent zweimal.",
  );

  const klammerFunde = PROMPT.match(/\[[^\]\n]*\]/g) ?? [];
  assert.deepEqual(
    klammerFunde,
    [],
    `${TEMPLATE_REL}: der Prompt enthaelt selbst Ausdruecke in eckigen Klammern (${klammerFunde.join(", ")}), verbietet sie dem Modell aber. Im Zweifel gewinnt das Beispiel gegen die Regel.`,
  );
});
