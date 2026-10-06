import Anthropic from "@anthropic-ai/sdk";

export const PERSONA_MODEL_DEFAULT = "claude-haiku-4-5";
const PERSONA_MAX_TOKENS = 120;

const STT_NOISE_TRUNCATE_CHANCE = 0.2;
const STT_NOISE_TRUNCATE_KEEP_RATIO = 0.6;
const STT_NOISE_FILLER_CHANCE = 0.15;
const STT_NOISE_FILLER = " aeh";

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

const EMPTY_PERSONA_FALLBACK = "Ja.";

function silentTurn() {
  return { text: "", silent: true, refused: false, usage: null };
}

export function personaPromptFor(scenario, turnIndex) {
  const sw = scenario.personaSwitch;
  if (sw && turnIndex >= sw.fromTurnIndex) return sw.personaPrompt;
  return scenario.personaPrompt;
}

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
