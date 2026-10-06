import Anthropic from "@anthropic-ai/sdk";

export const JUDGE_MODEL_DEFAULT = "claude-sonnet-5";
const JUDGE_MAX_TOKENS = 2000;

const CRITERIA = ["role_fidelity", "coherence", "task_progress", "naturalness", "efficiency"];
const SCORE_MIN = 1;
const SCORE_MAX = 5;
const VALID_FLAGS = new Set(["pass", "concern", "fail"]);
const FALLBACK_FLAG = "concern";

function formatTranscript(transcript) {
  return transcript.map((t) => `${t.role === "agent" ? "AGENT" : "GEGENSEITE"}: ${t.text}`).join("\n");
}

function clampScore(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return SCORE_MIN;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, v));
}

function judgeSystemPrompt(judgeFocus) {
  const schemaHint =
    '{"scores":{"role_fidelity":1-5,"coherence":1-5,"task_progress":1-5,"naturalness":1-5,"efficiency":1-5},' +
    '"rationale":{"role_fidelity":"1 kurzer Satz (max 15 Woerter)","coherence":"1 kurzer Satz","task_progress":"1 kurzer Satz","naturalness":"1 kurzer Satz","efficiency":"1 kurzer Satz"},' +
    '"overall_flag":"pass"|"concern"|"fail"}';
  return [
    "Du bist ein strenger, unabhaengiger Qualitaets-Judge fuer ein simuliertes Telefon-KI-Gespraech.",
    "Bewerte AUSSCHLIESSLICH das gegebene Transkript. Antworte NUR mit validem JSON, ohne Erklaerung drumherum:",
    schemaHint,
    judgeFocus ? `Besonderer Fokus: ${judgeFocus}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function judgeConversation({ apiKey, model = JUDGE_MODEL_DEFAULT, scenario, transcript }) {
  const client = new Anthropic({ apiKey });
  const groundTruth = {
    goal: scenario.goal ?? null,
    briefing: scenario.briefing ?? null,
    context: scenario.context ?? null,
  };
  const user = `SZENARIO-GROUND-TRUTH: ${JSON.stringify(groundTruth)}\n\nTRANSKRIPT:\n${formatTranscript(transcript)}`;

  const resp = await client.messages.create({
    model,
    max_tokens: JUDGE_MAX_TOKENS,
    system: judgeSystemPrompt(scenario.judgeFocus),
    messages: [{ role: "user", content: user }],
  });
  const raw = resp.content.find((b) => b.type === "text")?.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return { error: "judge_parse_failed", raw_excerpt: raw.slice(0, 200), usage: resp.usage };
  }

  const scores = {};
  for (const c of CRITERIA) scores[c] = clampScore(parsed.scores?.[c]);
  const overall_flag = VALID_FLAGS.has(parsed.overall_flag) ? parsed.overall_flag : FALLBACK_FLAG;
  return { scores, rationale: parsed.rationale || {}, overall_flag, usage: resp.usage };
}
