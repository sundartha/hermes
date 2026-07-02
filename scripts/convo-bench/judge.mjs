// LLM-Judge (tasks/convo-bench-spec.md §5-ii): direkter Anthropic-Call mit bewusst
// ANDEREM (staerkerem) Modell als das gebenchte Haiku, um Selbstbewertungs-Bias zu
// vermeiden. Default HART im Code (Spec §0): claude-sonnet-5.
//
// Abweichung von der Spec-Formulierung "Structured Output (json_schema)": statt des
// erst kuerzlich verfuegbaren output_config.format-Felds (ungetestet mit dieser
// SDK-Version im Repo) nutzt der Judge dasselbe im Bestand BEWIESENE Muster wie
// claude.js:summarizeCall - System-Prompt-JSON-Instruktion + defensive Teilstring-
// Extraktion (raw.slice(indexOf("{"), lastIndexOf("}")+1)). Robustheit im
// kostenkritischen Feldtest wiegt hier schwerer als Spec-Wortlaut; siehe Report.
import Anthropic from "@anthropic-ai/sdk";

export const JUDGE_MODEL_DEFAULT = "claude-sonnet-5";
const JUDGE_MAX_TOKENS = 800;

const CRITERIA = ["role_fidelity", "coherence", "task_progress", "naturalness", "efficiency"];
const SCORE_MIN = 1;
const SCORE_MAX = 5;
const VALID_FLAGS = new Set(["pass", "concern", "fail"]);
// Neutraler Fallback-Flag, wenn das Modell keinen gueltigen overall_flag liefert -
// "concern" statt stillem "pass" (fail-safe: ein kaputter Judge-Output darf nicht als
// stilles Bestehen erscheinen).
const FALLBACK_FLAG = "concern";

function formatTranscript(transcript) {
  return transcript.map((t) => `${t.role === "agent" ? "AGENT" : "GEGENSEITE"}: ${t.text}`).join("\n");
}

// json_schema kennt kein minimum/maximum (siehe claude-api-Referenz) - Ganzzahl 1-5
// wird hier als Best-effort-Clamp erzwungen, kein Crash bei Modell-Ausreissern.
function clampScore(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return SCORE_MIN;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, v));
}

function judgeSystemPrompt(judgeFocus) {
  const schemaHint =
    '{"scores":{"role_fidelity":1-5,"coherence":1-5,"task_progress":1-5,"naturalness":1-5,"efficiency":1-5},' +
    '"rationale":{"role_fidelity":"1 Satz","coherence":"1 Satz","task_progress":"1 Satz","naturalness":"1 Satz","efficiency":"1 Satz"},' +
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
