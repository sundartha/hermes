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
import { elevenLabsVoiceName } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";

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
// Telnyx-AI-Assistant-REST-Basis (live UNBESTAETIGT, mit Owner fixen; Muster voice.js).
const AI_ASSISTANTS_PATH = "/v2/ai/assistants";
const ASSISTANT_NAME = "Hermes"; // Telnyx-Pflicht-Scaffold, kein Verhaltensfeld
// R5: Telnyx wartet nach dem Opening-Speak diese Stille ab, bevor es den Assistant mit einer
// "[long silence]"-System-Message anstoesst (Assistant-Greeting ist leer, Regel 2). Default 10
// erzeugte 12.4s Totzeit im Live-Call (RCA 2026-07-12); 4s = spuerbarer Anlauf, ohne dem
// Angerufenen ins Wort zu fallen. Telnyx-Spec: telephony_settings.user_idle_reply_secs, integer >= 0.
const USER_IDLE_REPLY_SECS = 4;
// K1 (PLAN-CONVERSATION-OPTIMIZATION.md): Range 0.0-1.0, Default 0.0 (=aus). HOEHER = STRIKTER,
// d.h. WENIGER Unterbrechungen - filtert kurze Backchannels ("ja"/"mhm"/"okay") aus der
// Unterbrechungs-Erkennung, echtes Ins-Wort-Fallen loest weiterhin aus. 0.4 ist Telnyx' eigener
// empfohlener Startwert (Release-Note 2026-07-06), nur mit deepgram/flux verfuegbar. Das Feld
// fehlt in der oeffentlichen OpenAPI-Spec, existiert aber real am Live-Objekt (kein Tippfehler,
// per GET verifiziert - Doku-Drift ist bei Telnyx systematisch, s. PLAN-CONVERSATION-OPTIMIZATION.md §9.6).
const INTERRUPT_PREDICTION_THRESHOLD = 0.4;
// K2 (PLAN-CONVERSATION-OPTIMIZATION.md): leises Raum-Ambiente statt digitaler Stille waehrend
// Antwortpausen, gegen das Totzeit-Empfinden. "silence" ist der Default und bedeutet laut Spec
// woertlich "disables background audio" - keine bewusste Wahl, nur nie umgestellt. predefined_media
// kennt genau zwei Presets: "silence" | "office". volume 0.1-1.0 in 0.1-Schritten, bewusst niedrig.
const BACKGROUND_AUDIO_TYPE = "predefined_media";
const BACKGROUND_AUDIO_VALUE = "office";
const BACKGROUND_AUDIO_VOLUME = 0.3;
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

// Sicherheits-/Konfigurationsfelder, die woanders verwaltet werden (Telnyx-Portal bzw.
// andere Provisioning-Schritte) und beim Teil-Update dieses Skripts (NUR
// telephony_settings.user_idle_reply_secs) nicht verloren gehen duerfen - time_limit_secs
// ist der assistant-seitige Sicherheits-Cap (Absolute Regel 1), die anderen sind
// Betriebsverhalten. Jeder Eintrag ist der PFAD zum Feld im Assistant-Objekt, NICHT nur der
// Feldname: live per GET verifiziert (tasks/assistant-fix-spec.md, Bestandsaufnahme) liegen
// time_limit_secs, recording_settings und default_texml_app_id VERSCHACHTELT unter
// telephony_settings, NUR transcription liegt top-level. Ein Snapshot ueber den blossen
// Feldnamen (assistant[field]) waere fuer die drei verschachtelten Felder IMMER leer und der
// Guard koennte nie feuern (Review-Blocker Runde 2) - preservedFieldSnapshot() liest deshalb
// ueber den vollen Pfad. sendAssistantConfig verifiziert diese Liste aktiv per GET vor/nach
// jedem Update (afix-p1), statt der - live UNBESTAETIGTEN - Deep-Merge-Annahme blind zu
// vertrauen (Muster Kopf-Docstring Z. 17-22).
const PRESERVED_SAFETY_FIELDS = Object.freeze({
  time_limit_secs: ["telephony_settings", "time_limit_secs"],
  recording_settings: ["telephony_settings", "recording_settings"],
  default_texml_app_id: ["telephony_settings", "default_texml_app_id"],
  transcription: ["transcription"],
});

// S3-5 (Review-Befund, PLAN-CONVERSATION-OPTIMIZATION.md K1/K2): ANDERE Semantik als
// PRESERVED_SAFETY_FIELDS oben - dort ist "vorher == nachher" der Erfolgsbeweis (ein Feld,
// das WIR nicht anfassen, darf sich nicht aendern), hier ist "gesendet == live" der
// Erfolgsbeweis (ein Feld, das WIR aktiv setzen, muss auch wirklich ankommen).
// interrupt_prediction_threshold fehlt in der OEFFENTLICHEN Telnyx-OpenAPI-Spec (s. Kommentar
// bei INTERRUPT_PREDICTION_THRESHOLD oben - live per GET verifiziert, aber nicht dokumentiert).
// Der wahrscheinlichste Fehlermodus eines undokumentierten Feldes ist NICHT ein Fehler-Status,
// sondern ein stiller Drop beim Schreiben (POST bleibt 200, das Feld verschwindet einfach) -
// ohne aktive Gegenpruefung wuerde das Skript in diesem Fall smokePass=true melden, obwohl
// K1 (Barge-in-Tuning) live NICHT wirkt. background_audio ist zwar dokumentiert, wird aber aus
// Konsistenzgruenden (beide sind neue, bislang unverifizierte Felder derselben Aenderung)
// in denselben Beweis-Schritt aufgenommen.
//
// MAJOR-3-Fix (2. Review-Runde): NUR SKALARE BLAETTER eintragen, NICHT das verschachtelte
// background_audio-Objekt als Ganzes. fieldsNotApplied verglich vorher das Objekt per
// JSON.stringify GEGEN das GET-Ergebnis - anders als fieldsLostOnUpdate oben (das GET-vorher
// gegen GET-nachher vergleicht, ALSO BEIDE SEITEN von Telnyx, konsistente Shape) vergleicht
// dieser Check UNSER gesendetes Objekt gegen Telnyx' Antwort, ZWEI VERSCHIEDENE Erzeuger.
// JSON.stringify ist key-reihenfolge-sensitiv und intolerant gegen Zusatzfelder (z.B. koennte
// Telnyx media_url:null aus der oneOf-Union ergaenzen) - ein Deep-Equal-Vergleich haette dann
// bei JEDEM Lauf geworfen, obwohl der POST erfolgreich war (schlimmer als kein Guard, weil er
// einen echten Fehler vortaeuscht). Jeder Eintrag hier ist deshalb ein PFAD BIS ZUM SKALAR
// (Zahl/String), den fieldsNotApplied mit === vergleicht - reihenfolge-unabhaengig und tolerant
// gegen Zusatzfelder, die Telnyx an anderer Stelle im selben Objekt ergaenzt.
const APPLIED_FIELDS_TO_VERIFY = Object.freeze({
  interrupt_prediction_threshold: ["interruption_settings", "interrupt_prediction_threshold"],
  background_audio_value: ["voice_settings", "background_audio", "value"],
  background_audio_volume: ["voice_settings", "background_audio", "volume"],
});

// Liest einen Wert ueber eine Pfad-Segmentliste (kein IO, keine Ausnahme bei fehlenden
// Zwischenknoten - liefert dann undefined, wie ein einfacher Feldzugriff auf ein fehlendes
// Feld). Eine Stelle (G5) statt wiederholter optional-chaining-Ketten pro Feld.
function readByPath(obj, path) {
  return path.reduce((node, segment) => (node == null ? undefined : node[segment]), obj);
}

// Snapshot der APPLIED_FIELDS_TO_VERIFY-Werte aus einem beliebigen Objekt (Muster
// preservedFieldSnapshot, aber ueber eine ANDERE Feldliste - s. Kommentar oben). Dient sowohl
// fuer die GESENDETE Config (assistantConfig selbst) als auch fuer den LIVE-Zustand nach dem
// Update (GET-Antwort) - derselbe Pfad-Zugriff fuer beide Seiten des Vergleichs (G5).
export function appliedFieldSnapshot(source) {
  const snapshot = {};
  for (const [field, path] of Object.entries(APPLIED_FIELDS_TO_VERIFY)) {
    snapshot[field] = readByPath(source, path);
  }
  return snapshot;
}

// Vergleich GESENDET vs. LIVE (P11 testbar, kein IO): liefert die NAMEN der Felder, deren
// Live-Wert vom gesendeten Wert abweicht (leer = alle Blaetter aus APPLIED_FIELDS_TO_VERIFY
// sind nachweislich live). Eigene Funktion statt fieldsLostOnUpdate (dort ist "unveraendert"
// der Erfolg, hier ist "wie gesendet" der Erfolg - aehnliche Form, andere Semantik, s.
// Kommentar bei APPLIED_FIELDS_TO_VERIFY). MAJOR-3-Fix: strikter Skalarvergleich (===) statt
// JSON.stringify-Deep-Equal - sent/live sind hier IMMER appliedFieldSnapshot()-Ergebnisse,
// also Blaetter (Zahl/String), kein verschachteltes Objekt mehr.
export function fieldsNotApplied(sent, live) {
  return Object.keys(sent).filter((field) => sent[field] !== live[field]);
}

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
      model, // config.llm.claudeModel (BYO-autoritativ)
      llm_api_key_ref: llmApiKeyRef, // NAME des Telnyx-Integration-Secrets
      forward_metadata: true, // legt call_control_id in den Body (E1)
    },
    voice_settings: {
      voice: elevenLabsVoiceName({ model: voiceModel, voiceId }), // eine Format-Quelle (G5)
      api_key_ref: apiKeyRef,
      // KEIN `type` auf dieser Ebene: das ASSISTANT-voice_settings ist flach (Telnyx-Spec:
      // required ["voice"]); nur der Call-Control-speak nutzt die per `type` diskriminierte
      // Union. background_audio darunter IST so eine `type`-diskriminierte Union (oneOf
      // predefined_media | media_url | media_name) - das ist deren eigenes Sub-Schema, kein
      // Widerspruch zum Kommentar oben.
      background_audio: {
        type: BACKGROUND_AUDIO_TYPE,
        value: BACKGROUND_AUDIO_VALUE,
        volume: BACKGROUND_AUDIO_VOLUME,
      },
    },
    greeting: "", // Regel 2: der Assistant spricht NIE zuerst
    interruption_settings: {
      enable: true, // Barge-in an (Launch-Pflicht) - bleibt UNVERAENDERT an, K1 ist reines Tuning
      interrupt_prediction_threshold: INTERRUPT_PREDICTION_THRESHOLD,
    },
    // NUR dieses eine Feld senden - die Annahme, dass der Update-POST ein Deep-Merge ist und
    // PRESERVED_SAFETY_FIELDS (time_limit_secs etc.) dabei unveraendert ueberleben, ist live
    // UNBESTAETIGT (wie der Rest des REST-Schemas, Kopf-Docstring Z. 17-22). sendAssistantConfig
    // verifiziert das deshalb aktiv per GET vor/nach dem Update statt blind darauf zu vertrauen.
    telephony_settings: { user_idle_reply_secs: USER_IDLE_REPLY_SECS },
  };
}

// Bearer-Header + Content-Type. Eine Stelle (G5), analog voice.js headers().
function headers() {
  return {
    Authorization: `Bearer ${config.telephony.telnyxApiKey}`,
    "Content-Type": JSON_HEADERS_TYPE,
  };
}

// Voraussetzungen fuer den Live-Lauf. Fehlt etwas -> smokePass=false. KEINE
// Secrets loggen: nur ob gesetzt, nie der Wert (Regel 4/5).
const REQUIRED = Object.freeze([
  ["TELNYX_API_KEY", config.telephony.telnyxApiKey],
  ["PUBLIC_URL", config.server.publicUrl],
  ["TELNYX_ELEVENLABS_VOICE_ID", config.telnyxElevenLabs.voiceId],
  ["TELNYX_ELEVENLABS_API_KEY_REF", config.telnyxElevenLabs.apiKeyRef],
  ["TELNYX_SHIM_API_KEY_REF", config.telnyxAssistant.shimApiKeyRef],
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

// BUGFIX afix-p1: Der Update ist POST /v2/ai/assistants/{id} - ein PUT existiert NICHT
// (HTTP 404; die Telnyx-OpenAPI-Spec kennt unter /ai/assistants/{assistant_id} nur
// GET/POST/DELETE). Das Re-Provisioning war damit nie funktionsfaehig. Create bleibt
// POST auf die Collection. Exportiert, damit der Offline-Test die Methode/URL ohne Netz
// festnagelt (P11).
export function assistantRequest(existingId) {
  const base = `${config.telephony.telnyxApiBase}${AI_ASSISTANTS_PATH}`;
  return { method: "POST", url: existingId ? `${base}/${existingId}` : base };
}

// GET des aktuellen Assistant-Zustands - NUR fuer den Merge-Sicherheits-Check in
// sendAssistantConfig gebraucht (kein genereller Read-Pfad). Gleiche Fehler-/Envelope-
// Konvention wie sendAssistantConfig (assertTelnyxOk, {data}-Wrapper Muster voice.js).
async function fetchAssistant(id) {
  const res = await fetch(`${config.telephony.telnyxApiBase}${AI_ASSISTANTS_PATH}/${id}`, {
    method: "GET",
    headers: headers(),
  });
  await assertTelnyxOk(res, "fetchAssistant", { attachStatus: true });
  const json = await res.json().catch(() => ({}));
  return json.data || json;
}

// Snapshot NUR der PRESERVED_SAFETY_FIELDS, die im Assistant tatsaechlich gesetzt sind
// (fehlende Felder werden uebersprungen - nichts zu verlieren, kein falsch-positiver
// "verloren"-Befund fuer Felder, die nie konfiguriert waren). Liest ueber den vollen Pfad
// (readByPath), NICHT ueber assistant[field] top-level - die meisten dieser Felder liegen
// verschachtelt (s. Kommentar bei PRESERVED_SAFETY_FIELDS).
export function preservedFieldSnapshot(assistant) {
  const snapshot = {};
  for (const [field, path] of Object.entries(PRESERVED_SAFETY_FIELDS)) {
    const value = readByPath(assistant, path);
    if (value !== undefined) snapshot[field] = value;
  }
  return snapshot;
}

// Reiner Vorher/Nachher-Vergleich (P11 testbar, kein IO): liefert die NAMEN der Felder, die
// nach dem Update fehlen oder sich veraendert haben (leer = Merge-Annahme bestaetigt).
export function fieldsLostOnUpdate(before, after) {
  return Object.keys(before).filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

// Versendet die gebaute Config an die Telnyx-Assistant-API. Create (POST auf die Collection)
// wenn keine bestehende ID uebergeben, sonst Update (POST /{id}, s. assistantRequest).
// assertTelnyxOk = EINE Fehler-Parse-Stelle (G5), allowlisted, kein Roh-Body/Key-Leak
// (Regel 4/5). Gibt die assistant_id zurueck.
//
// Beim Update (existingId gesetzt) wird PRESERVED_SAFETY_FIELDS aktiv per GET vor UND nach
// dem Update verglichen (afix-p1) - die Deep-Merge-Annahme ist live UNBESTAETIGT (s. Kommentar
// bei telephony_settings in buildAssistantConfig), ein Teil-Update darf den assistant-seitigen
// Sicherheits-Cap (time_limit_secs, Absolute Regel 1) nie stillschweigend loeschen. Weicht der
// Nachher-Zustand ab, wirft dieser Aufruf statt eine falsch-gruene assistant_id zurueckzugeben
// (fail-closed, main().catch() meldet smokePass=false). Dieser Vergleich braucht ein "Vorher"
// und ist deshalb NUR beim Update sinnvoll (beim Create gibt es nichts zu verlieren).
//
// MAJOR-2-Fix (2. Review-Runde): der GET-nach-Update/-Create gegen APPLIED_FIELDS_TO_VERIFY
// (S3-5, K1/K2-Felder) laeuft dagegen IMMER, auch beim Create - ob die gesendeten Felder live
// ankamen, ist unabhaengig davon, ob vorher schon ein Assistant existierte. Vorher stand dieser
// Check ausschliesslich im existingId-Zweig: ein frischer Lauf ohne TELNYX_ASSISTANT_ID (z.B.
// Disaster-Recovery/Neuanlage) meldete damit faelschlich smokePass=true, OHNE K1/K2 je
// gegengeprueft zu haben. Die beiden K1/K2-Felder muessen im LIVE-Zustand exakt dem gesendeten
// Wert entsprechen, sonst wirft dieser Aufruf (fail-closed, gleiches Muster wie
// fieldsLostOnUpdate) - ein gruener Skript-Lauf beweist damit wirklich, dass K1/K2 live sind
// (fuer BEIDE Pfade), statt nur, dass der POST kein Fehler war.
// Exportiert, damit der Offline-Test (global.fetch gestubbt) den GET-vor/POST/GET-nach-Ablauf
// ohne echtes Netz durchspielen kann.
export async function sendAssistantConfig(assistantConfig, existingId) {
  const before = existingId ? preservedFieldSnapshot(await fetchAssistant(existingId)) : {};
  const { method, url } = assistantRequest(existingId);
  const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(assistantConfig) });
  await assertTelnyxOk(res, "provisionAssistant", { attachStatus: true });
  const json = await res.json().catch(() => ({}));
  const data = json.data || json; // Telnyx-v2 wrappt teils in {data} (Muster voice.js)
  const id = data.id || data.assistant_id || existingId;

  // GET-nach-Update/-Create: EIN Fetch deckt beide Pruefungen unten ab (kein zweiter Netz-
  // Call). Bei Create ist "before" leer ({}), der fieldsLostOnUpdate-Zweig greift also nicht -
  // fieldsNotApplied (MAJOR-2) laeuft trotzdem, weil sie NICHT von "before"/existingId abhaengt.
  const liveAfter = await fetchAssistant(id);

  if (existingId) {
    const after = preservedFieldSnapshot(liveAfter);
    const lost = fieldsLostOnUpdate(before, after);
    if (lost.length) {
      throw new Error(
        `Merge-Annahme widerlegt: Update hat folgende Felder veraendert/geloescht: ${lost.join(", ")} ` +
          "(Telnyx-Assistant-Config im Portal pruefen, ggf. manuell wiederherstellen)",
      );
    }
  }

  const notApplied = fieldsNotApplied(appliedFieldSnapshot(assistantConfig), appliedFieldSnapshot(liveAfter));
  if (notApplied.length) {
    throw new Error(
      `K1/K2-Verifikation fehlgeschlagen: Telnyx hat folgende Felder NICHT wie gesendet uebernommen ` +
        `(vermutlich stillschweigend verworfen, da nicht in der oeffentlichen OpenAPI-Spec dokumentiert): ` +
        `${notApplied.join(", ")} (Telnyx-Assistant-Config im Portal pruefen)`,
    );
  }

  return id;
}

async function main() {
  const missing = missingRequired(REQUIRED);
  if (missing.length) {
    report(false, `kein Telnyx-Live-Zugang im Worktree (fehlt: ${missing.join(", ")})`);
  }

  const assistantConfig = buildAssistantConfig({
    publicUrl: config.server.publicUrl,
    voiceId: config.telnyxElevenLabs.voiceId,
    voiceModel: config.telnyxElevenLabs.model,
    apiKeyRef: config.telnyxElevenLabs.apiKeyRef,
    model: config.llm.claudeModel,
    llmApiKeyRef: config.telnyxAssistant.shimApiKeyRef,
  });
  const id = await sendAssistantConfig(assistantConfig, process.env[ASSISTANT_ID_ENV] || "");
  // NUR die opake assistant_id ausgeben (kein Key/Secret, Regel 4/5). Owner uebernimmt
  // sie in die Env (P10-Doku).
  report(
    Boolean(id),
    id ? `assistant_id=${id} (in ${ASSISTANT_ID_ENV} uebernehmen)` : "keine assistant_id in der Antwort",
  );
}

// Nur als Skript ausfuehren, NICHT beim Import (die Offline-Tests importieren nur einzelne
// Funktionen und stubben bei Bedarf global.fetch - main() darf beim Import KEINEN echten
// Netz-Call/process.exit ausloesen).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => report(false, `Provisioning fehlgeschlagen: ${err.message}`));
