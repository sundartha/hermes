// Persona-Simulation der Gegenseite (tasks/convo-bench-spec.md §4): direkter Anthropic-
// Call (NICHT durch den gebenchten Server), scriptedTurns-Vorrang + sttNoise-Transform.
// ANTHROPIC_API_KEY erreicht diese Datei nur als Funktionsargument (apiKey) - niemals
// loggen, niemals in einer Fehlermeldung wiederholen.
import Anthropic from "@anthropic-ai/sdk";

// Persona-Default HART im Code (Spec §0/§4) - claude-haiku-4-5, das gebenchte
// Produktions-Modell selbst (die Gegenseite spricht mit derselben Guete wie echte
// Anrufer es taeten). --persona-model in der CLI kann das ueberschreiben.
export const PERSONA_MODEL_DEFAULT = "claude-haiku-4-5";
const PERSONA_MAX_TOKENS = 120;

const STT_NOISE_TRUNCATE_CHANCE = 0.2;
const STT_NOISE_TRUNCATE_KEEP_RATIO = 0.6;
const STT_NOISE_FILLER_CHANCE = 0.15;
const STT_NOISE_FILLER = " aeh";

// Simuliert eine verrauschte STT-Erkennung (Spec §4/§9 stt-noise): lowercase,
// Satzzeichen weg, ~20% Chance auf Kappung (an einer Wortgrenze), gelegentlich ein
// Fueller-Wort. Reine Funktion, random injizierbar (Test-Seam); Default Math.random -
// STT-Rauschen ist bewusst nicht deterministisch (reales STT ist es auch nicht).
export function applySttNoise(text, random = Math.random) {
  let out = text
    .toLowerCase()
    .replace(/[.,!?;:]/g, "")
    .trim();
  if (random() < STT_NOISE_TRUNCATE_CHANCE) {
    const words = out.split(" ");
    const keep = Math.max(1, Math.floor(words.length * STT_NOISE_TRUNCATE_KEEP_RATIO));
    out = words.slice(0, keep).join(" ");
  }
  if (random() < STT_NOISE_FILLER_CHANCE) out += STT_NOISE_FILLER;
  return out;
}

// Transkript aus Callee-Sicht gespiegelt (Spec §4): der Agent (role:"agent") ist aus
// Sicht der Persona die Gegenseite ("user"), die eigenen frueheren Antworten der
// Persona ("caller") werden zu "assistant". Erster Eintrag ist immer die Agenten-
// Offenlegung/Begruessung (role:"agent" -> "user") - erfuellt die API-Regel "erste
// Message ist user".
function mirrorTranscript(transcript) {
  return transcript.map((t) => ({
    role: t.role === "agent" ? "user" : "assistant",
    content: t.text,
  }));
}

async function callPersonaLlm({ apiKey, model, scenario, transcript, turnIndex }) {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model,
    max_tokens: PERSONA_MAX_TOKENS,
    system: personaPromptFor(scenario, turnIndex),
    messages: mirrorTranscript(transcript),
  });
  if (resp.stop_reason === "refusal") return { text: null, refused: true, usage: resp.usage };
  const text = resp.content.find((b) => b.type === "text")?.text?.trim() || "";
  return { text, refused: false, usage: resp.usage };
}

// Fallback, falls die Persona (extrem selten) leeren Text liefert: verhindert, dass
// ein leeres SpeechResult den Server in die noSpeechReprompt-Schleife schickt, ohne
// je wieder ein role:caller-Transkript zu erzeugen (Turn-Cap faengt das ohnehin ab,
// aber ein nicht-leerer Fallback ist billiger als verschwendete Turns).
const EMPTY_PERSONA_FALLBACK = "Ja.";

// P4: ein Szenario kann einzelne Callee-Turns als STILL deklarieren (silentTurns:
// number[], 0-basiert wie scriptedTurns). Ein stiller Turn geht als LEERES SpeechResult
// an /voice/turn - exakt das, was ein Gather ohne Erkennung liefert - und trifft damit
// die P3.2-Staffel (no-speech-escalation.js), nicht das Modell. Der leere Text darf
// NICHT ins Transkript: mirrorTranscript wuerde daraus einen leeren Message-Block bauen,
// den die Anthropic-API ablehnt (der Persona-Call wuerde den Lauf abbrechen). Der Runner
// setzt dafuer einen lesbaren Marker.
function silentTurn() {
  return { text: "", silent: true, refused: false, usage: null };
}

// P4: Szenario "personenwechsel" - ab fromTurnIndex (0-basiert) uebernimmt eine ZWEITE
// Persona den Hoerer. Reine Funktion, exportiert als Test-Seam (Muster applySttNoise).
export function personaPromptFor(scenario, turnIndex) {
  const sw = scenario.personaSwitch;
  if (sw && turnIndex >= sw.fromTurnIndex) return sw.personaPrompt;
  return scenario.personaPrompt;
}

// Liefert den naechsten Callee-Turn: Stille schlaegt Skript schlaegt Persona-LLM
// (scriptedTurns[turnIndex] hat Vorrang vor der Persona-LLM, Spec §4, deterministische
// Repro fuer termin-duenn); sttNoise-Transform greift auf scripted + LLM, wenn
// scenario.sttNoise gesetzt ist - ein stiller Turn traegt per Definition keinen Text,
// sttNoise ist dort gegenstandslos.
export async function nextCalleeTurn({
  apiKey,
  model = PERSONA_MODEL_DEFAULT,
  scenario,
  transcript,
  turnIndex,
}) {
  if (scenario.silentTurns?.includes(turnIndex)) return silentTurn();
  const scripted = scenario.scriptedTurns?.[turnIndex];
  if (scripted !== undefined) {
    const text = scenario.sttNoise ? applySttNoise(scripted) : scripted;
    return { text, refused: false, usage: null };
  }
  const reply = await callPersonaLlm({ apiKey, model, scenario, transcript, turnIndex });
  if (reply.refused) return reply;
  const rawText = reply.text || EMPTY_PERSONA_FALLBACK;
  const text = scenario.sttNoise ? applySttNoise(rawText) : rawText;
  return { ...reply, text };
}
