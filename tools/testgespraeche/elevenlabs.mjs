import { setTimeout as warte } from "node:timers/promises";
import { env } from "node:process";

const STANDARD_API = "https://api.elevenlabs.io";
const OFFEN = "pending";
const FERTIG = new Set(["passed", "failed"]);
const ERFOLG = "success";
const NICHT_GEWERTET = "The agent took part in the conversation.";
const STATUS_FERTIG = "fertig";
const UMGEBUNG = "staging";

function schluessel() {
  const wert = env.ELEVENLABS_TESTGESPRAECHE_KEY;
  if (!wert) throw new Error("ELEVENLABS_TESTGESPRAECHE_KEY fehlt");
  return wert;
}

async function api(pfad, { method = "GET", body } = {}) {
  const antwort = await fetch(`${env.ELEVENLABS_API_URL || STANDARD_API}${pfad}`, {
    method,
    headers: { "xi-api-key": schluessel(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!antwort.ok) {
    throw new Error(
      `die ElevenLabs-API auf ${method} ${pfad} mit HTTP ${antwort.status} antwortet`,
    );
  }
  return antwort.json();
}

function testDefinition(fall, variablen) {
  return {
    name: `Testgespräch ${fall.name}`,
    type: "simulation",
    simulation_scenario: fall.szenario,
    success_conditions: fall.bewerter?.length > 0 ? fall.bewerter : [NICHT_GEWERTET],
    simulation_max_turns: fall.max_zuege,
    dynamic_variables: variablen,
    simulation_environment: UMGEBUNG,
  };
}

function lauf(eintrag, namen) {
  const ergebnis = eintrag.condition_result?.result;
  return {
    fall: namen.get(eintrag.test_id),
    status: FERTIG.has(eintrag.status) ? STATUS_FERTIG : eintrag.status,
    urteil: ergebnis === ERFOLG ? "bestanden" : (ergebnis ?? "ohne Urteil"),
    zuege: (eintrag.agent_responses ?? []).map((zug) => ({
      rolle: zug.role,
      text: zug.message ?? "",
    })),
    credits: eintrag.credits_used ?? 0,
  };
}

async function abwarten(aufruf, { erwartet, frist, takt }) {
  let stand = aufruf;
  const ende = Date.now() + frist;
  const offen = (runs) =>
    runs.length < erwartet || runs.some((eintrag) => eintrag.status === OFFEN);
  while (offen(stand.test_runs) && Date.now() < ende) {
    await warte(takt);
    stand = await api(`/v1/convai/test-invocations/${encodeURIComponent(aufruf.id)}`);
  }
  return stand.test_runs;
}

async function anlegen(faelle, variablenVon, namen) {
  for (const fall of faelle) {
    const { id } = await api("/v1/convai/agent-testing/create", {
      method: "POST",
      body: testDefinition(fall, variablenVon(fall)),
    });
    namen.set(id, fall.name);
  }
}

async function aufraeumen(namen) {
  const ids = [...namen.keys()];
  await Promise.allSettled(
    ids.map((id) =>
      api(`/v1/convai/agent-testing/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ),
  );
}

export function holeAgent(agent) {
  return api(`/v1/convai/agents/${encodeURIComponent(agent)}`);
}

export async function fuehreAus({ agent, faelle, variablenVon, wiederholungen, frist, takt }) {
  const namen = new Map();
  try {
    await anlegen(faelle, variablenVon, namen);
    const aufruf = await api(`/v1/convai/agents/${encodeURIComponent(agent)}/run-tests`, {
      method: "POST",
      body: {
        tests: [...namen.keys()].map((id) => ({ test_id: id })),
        repeat_count: wiederholungen,
      },
    });
    const erwartet = faelle.length * wiederholungen;
    const runs = await abwarten(aufruf, { erwartet, frist, takt });
    return runs.map((eintrag) => lauf(eintrag, namen));
  } finally {
    await aufraeumen(namen);
  }
}
