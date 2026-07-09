#!/usr/bin/env node
// Provisioniert den Telnyx AI Assistant deterministisch: Ela-Stimme (ElevenLabs
// via Telnyx-Integration-Secret), Custom-LLM-URL auf unseren Shim
// (POST /v1/chat/completions, server.js), interruption_settings AN (Barge-in-
// Launch-Pflicht), greeting="" (Regel 2 - der Assistant spricht NIE zuerst, das
// spricht der Disclosure-Speak-Node zuerst). Braucht Owner-Live-Zugang: Telnyx-
// Guthaben > 2 USD (sonst stiller HTTP 402, siehe Provisioning-Historie), die
// Telnyx-Integration-Secret elevenlabs_prod IN Telnyx (nicht im Repo) und die
// unten aufgefuehrten Env-Werte. OHNE Live-Zugang meldet das Skript
// smokePass=false + Grund und bricht ab (fail-closed, nie faelschlich gruen).
//
// Code-Merge ist NICHT an einen erfolgreichen Live-Lauf gebunden - die
// PRODUKTIVE Assistant-Aktivierung schon (das Skript ausfuehren + assistant_id
// uebernehmen ist ein separater, Owner-gated Schritt, siehe
// docs/RUNBOOK-TELNYX-ASSISTANT.md).
//
// Ehrlichkeits-Hinweis (Muster src/telephony/adapters/telnyx/voice.js Z. 6-12):
// der exakte Telnyx-AI-Assistant-REST-Schema-Slot (Endpunkt, external_llm-Sub-
// Feld, Voice-Slot-Casing) ist live UNBESTAETIGT und wird beim ersten echten
// Lauf mit dem Owner an der echten API fixiert. base_url endet bewusst auf "/v1"
// (Telnyx haengt "/chat/completions" selbst an, forward_metadata legt die
// call_control_id in den Request-Body).
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import { assertTelnyxOk } from "../src/telephony/adapters/telnyx/errors.js";

// Shim-Route: dieselbe wie die Registrierung in server.js (POST /v1/chat/completions).
// Ein Literal an zwei Orten ueber Dateigrenzen hinweg; ein geteiltes Route-Symbol
// wuerde src/ anfassen (ausserhalb P7-Scope), daher hier eigene benannte Konstante.
// Exportiert, damit test/telnyx-assistant-route-drift.test.js sie gegen die echte
// Registrierung in src/server.js abgleichen kann (Drift faellt beim Testlauf auf,
// nicht erst beim naechsten Live-Provisioning-Versuch).
export const SHIM_ROUTE = "/v1/chat/completions";
// Telnyx haengt diesen Suffix selbst an base_url an -> SHIM_BASE_ROUTE + CHAT_COMPLETIONS_SUFFIX
// === SHIM_ROUTE (Drift-Test-Invariante). base_url endet damit auf "/v1".
const CHAT_COMPLETIONS_SUFFIX = "/chat/completions";
const SHIM_BASE_ROUTE = SHIM_ROUTE.slice(0, -CHAT_COMPLETIONS_SUFFIX.length);
// Voice-Slot-Praefix im Telnyx-Assistant (spec-autoritativ "ElevenLabs.<model>.<voiceId>").
// Exakte Gross-/Kleinschreibung ist live UNBESTAETIGT -> beim Live-Lauf mit Owner verifizieren.
const ELEVENLABS_VOICE_PREFIX = "ElevenLabs";
// Telnyx-AI-Assistant-REST-Basis (live UNBESTAETIGT, mit Owner fixen; Muster voice.js).
const AI_ASSISTANTS_PATH = "/v2/ai/assistants";
const ASSISTANT_NAME = "Hermes"; // Telnyx-Pflicht-Scaffold, kein Verhaltensfeld
// Telnyx verlangt `instructions` als Pflichtfeld (sonst HTTP 400 10004 /body/instructions).
// Im BYO-Custom-LLM-Betrieb ist es INERT: der Shim (agentTurn/claude.js) baut Systemprompt +
// Kontext selbst und ignoriert die von Telnyx gespiegelten messages/system - dieser Text erreicht
// claude.js nie. Regel 2 bleibt unberuehrt (greeting="" + Disclosure-Speak-Node spricht zuerst);
// bewusst KEINE Offenlegung und KEINE Greeting-Anweisung hier (die Offenlegung ist ein per-Call/
// tenant/sprach-Laufzeitwert, kein statischer Config-Wert).
const ASSISTANT_INSTRUCTIONS =
  "Die Gespraechslogik, Sprache und Pflicht-Offenlegung steuert ausschliesslich das externe LLM " +
  "(Hermes Brain-Shim via external_llm). Dieses von Telnyx verlangte Pflichtfeld wird im BYO-Betrieb " +
  "nicht als Prompt verwendet.";
const JSON_HEADERS_TYPE = "application/json";
const ASSISTANT_ID_ENV = "TELNYX_ASSISTANT_ID"; // direkt aus process.env (Env-Doku = P10)

/**
 * Baut die Telnyx-Assistant-Config DETERMINISTISCH (kein IO, keine Zeit/Zufall).
 * Ein Objekt-Argument (F1: mehrere zusammengehoerige Werte -> Objekt statt Positionsliste).
 * apiKeyRef ist die REFERENZ auf das in Telnyx liegende Integration-Secret (KEIN
 * Klartext-Key, Regel 4/5). KEINE Disclosure im Greeting (Regel 2): greeting="" -> der
 * Disclosure-Speak-Node (P4.5/P5) spricht zuerst. Das Telnyx-Pflichtfeld `instructions`
 * (ASSISTANT_INSTRUCTIONS) traegt bewusst KEINE Offenlegung/Greeting-Anweisung und ist im
 * BYO-Betrieb inert (der Shim ignoriert Provider-messages/system) - das Gespraechs-Gehirn
 * lebt im Shim (agentTurn/claude.js); die disclosureSentence ist ein per-Call/tenant/
 * sprachgebundener Laufzeitwert.
 */
export function buildAssistantConfig({ publicUrl, voiceId, voiceModel, apiKeyRef, model, llmApiKeyRef }) {
  return {
    name: ASSISTANT_NAME,
    // KEIN top-level `model`: bei gesetztem external_llm lehnt Telnyx beides zusammen ab
    // (HTTP 400 10015 "Cannot provide both 'model' and 'external_llm'"). external_llm.model
    // ist der autoritative BYO-Wert (live verifiziert 2026-07-09).
    // instructions = Telnyx-Pflichtfeld (10004 sonst); INERT im BYO-Betrieb (s. ASSISTANT_INSTRUCTIONS).
    instructions: ASSISTANT_INSTRUCTIONS,
    external_llm: {
      base_url: `${publicUrl}${SHIM_BASE_ROUTE}`, // Praefix; Telnyx haengt /chat/completions an
      model, // config.claudeModel (BYO-autoritativ)
      llm_api_key_ref: llmApiKeyRef, // NAME des Telnyx-Integration-Secrets
      forward_metadata: true, // legt call_control_id in den Body (E1)
    },
    voice_settings: {
      voice: `${ELEVENLABS_VOICE_PREFIX}.${voiceModel}.${voiceId}`,
      api_key_ref: apiKeyRef,
    },
    greeting: "", // Regel 2: der Assistant spricht NIE zuerst
    interruption_settings: { enable: true }, // Barge-in an (Launch-Pflicht)
  };
}

// Bearer-Header + Content-Type. Eine Stelle (G5), analog voice.js headers().
function headers() {
  return {
    Authorization: `Bearer ${config.telnyxApiKey}`,
    "Content-Type": JSON_HEADERS_TYPE,
  };
}

// Voraussetzungen fuer den Live-Lauf. Fehlt etwas -> smokePass=false. KEINE
// Secrets loggen: nur ob gesetzt, nie der Wert (Regel 4/5).
const REQUIRED = Object.freeze([
  ["TELNYX_API_KEY", config.telnyxApiKey],
  ["PUBLIC_URL", config.publicUrl],
  ["TELNYX_ELEVENLABS_VOICE_ID", config.telnyxElevenLabs.voiceId],
  ["TELNYX_ELEVENLABS_API_KEY_REF", config.telnyxElevenLabs.apiKeyRef],
  ["TELNYX_SHIM_API_KEY_REF", config.telnyxShimApiKeyRef],
]);

// Reine Pruef-Funktion (P11 testbar, Muster smoke-stripe-payment.mjs isTestKey): liefert
// die NAMEN der fehlenden Pflichtwerte (leer bei allen gesetzt). KEIN IO, kein Secret im
// Rueckgabewert (nur Namen, nie die Werte selbst - Regel 4/5).
export function missingRequired(required) {
  return required.filter(([, v]) => !v).map(([n]) => n);
}

function report(smokePass, reason) {
  console.log(`smokePass=${smokePass}`);
  console.log(`Grund: ${reason}`);
  process.exit(smokePass ? 0 : 1);
}

// Versendet die gebaute Config an die Telnyx-Assistant-API. Create (POST) wenn keine
// bestehende ID uebergeben, sonst Update (PUT /{id}). assertTelnyxOk = EINE Fehler-Parse-
// Stelle (G5), allowlisted, kein Roh-Body/Key-Leak (Regel 4/5). Gibt die assistant_id zurueck.
async function sendAssistantConfig(assistantConfig, existingId) {
  const base = `${config.telnyxApiBase}${AI_ASSISTANTS_PATH}`;
  const url = existingId ? `${base}/${existingId}` : base;
  const res = await fetch(url, {
    method: existingId ? "PUT" : "POST",
    headers: headers(),
    body: JSON.stringify(assistantConfig),
  });
  await assertTelnyxOk(res, "provisionAssistant", { attachStatus: true });
  const json = await res.json().catch(() => ({}));
  const data = json.data || json; // Telnyx-v2 wrappt teils in {data} (Muster voice.js)
  return data.id || data.assistant_id;
}

async function main() {
  const missing = missingRequired(REQUIRED);
  if (missing.length) {
    report(false, `kein Telnyx-Live-Zugang im Worktree (fehlt: ${missing.join(", ")})`);
  }

  const assistantConfig = buildAssistantConfig({
    publicUrl: config.publicUrl,
    voiceId: config.telnyxElevenLabs.voiceId,
    voiceModel: config.telnyxElevenLabs.model,
    apiKeyRef: config.telnyxElevenLabs.apiKeyRef,
    model: config.claudeModel,
    llmApiKeyRef: config.telnyxShimApiKeyRef,
  });
  const id = await sendAssistantConfig(assistantConfig, process.env[ASSISTANT_ID_ENV] || "");
  // NUR die opake assistant_id ausgeben (kein Key/Secret, Regel 4/5). Owner uebernimmt
  // sie in die Env (P10-Doku).
  report(
    Boolean(id),
    id ? `assistant_id=${id} (in ${ASSISTANT_ID_ENV} uebernehmen)` : "keine assistant_id in der Antwort",
  );
}

// Nur als Skript ausfuehren, NICHT beim Import (der Offline-Test importiert nur
// buildAssistantConfig - main() darf dabei keinen Netz-Call/process.exit ausloesen).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => report(false, `Provisioning fehlgeschlagen: ${err.message}`));
