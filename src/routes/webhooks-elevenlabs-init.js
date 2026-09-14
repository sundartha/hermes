// ---- Conversation-Initiation-Webhook des ElevenLabs-Inbound-Wegs (IEL-B6) -------------
// Nimmt ElevenLabs einen eingehenden SIP-Anruf an, den unser <Dial><Sip> an den Agenten
// uebergibt, fragt der Anbieter HIER nach den dynamischen Variablen und der Eroeffnung. Die
// Antwort bindet das Anbieter-Gespraech (conversation_id) set-once an unseren Call.
//
// AUTH-AUSNAHME (Absolute Regel 3, begruendet - Eintrag in src/route-policy.js):
// HANDLER-INTERNE AUTH. Der Anbieter ruft serverseitig, ohne Session und ohne Signatur. Die
// erste Sicherung ist das geteilte Geheimnis im Header x-hermes-init-token, timing-sicher
// (safeEqual) gegen ELEVENLABS_INIT_WEBHOOK_TOKEN geprueft, BEVOR irgendetwas anderes
// geschieht. Ein leerer oder zu kurzer config-Wert lehnt JEDEN Aufruf ab (fail-closed).
// NICHT unter /voice gemountet: die Ed25519-Signaturpruefung dort bleibt unberuehrt, und der
// Per-IP-Limiter (RATE_LIMIT_PER_MIN) liegt davor.
//
// DER HEADER BEWEIST KEINE ZUGEHOERIGKEIT (R-B): der Anbieter sendet ihn bei JEDEM
// eingehenden Gespraech des Workspace mit - er beweist nur "kommt von unserem Anbieter-Konto".
// Die eigentliche Barriere ist Stufe 2: Zuordnung NUR ueber das 16-Byte-Bindungs-Token
// (call.streamToken, am SIP-Header mitgereicht) an einen aktiven, WARTENDEN Inbound-EL-Call -
// oder die identische Wiederholung derselben Bindung binnen EL_INIT_WIEDERHOLUNG_FRIST_MS.
//
// REIHENFOLGE DER STUFEN ist bindend (E11): Geheimnis (403) -> Zuordnung, nur lesend (404) ->
// Schalter/Allowlist (404) -> set-once-Bindung (404 bei verlorener Op) -> Antwort. Jede
// Ablehnung nach Stufe 1 antwortet mit DEMSELBEN konstanten Koerper ohne Daten; nur das Log
// unterscheidet die Gruende (Muster EL-P6). Der Antwort-Builder hat genau EINEN Aufrufer:
// diesen Handler, nach der Bindung. Die Route loest selbst keinen Anruf aus.
import { Router } from "express";
import { BRIDGE_STATE, bridgeStateOf } from "../elevenlabs/inbound-bridge-state.js";
import { INIT_WEBHOOK_TOKEN_MIN_LENGTH, inboundElPathFor } from "../elevenlabs/inbound-path-decision.js";
import {
  buildInitiationResponse,
  callBindingTokenOf,
  sipHeadersFormOf,
} from "../elevenlabs/inbound-initiation.js";
import { normNum } from "../store/defaults.js";
import { safeEqual } from "../util.js";

export const ELEVENLABS_INIT_PATH = "/webhooks/elevenlabs/init";
export const INIT_TOKEN_HEADER = "x-hermes-init-token";

// K1: STARTWERT - der Retry-Abstand des Anbieters ist ungemessen (Spec 8, Frist-Zeile zieht
// nach). Anker ist das persistierte elBoundAt: die Frist ueberlebt einen Neustart.
export const EL_INIT_WIEDERHOLUNG_FRIST_MS = 10000;

export const INIT_ANTWORT = Object.freeze({
  VERWEIGERT: Object.freeze({ error: "verweigert" }),
  KEIN_ANRUF: Object.freeze({ error: "kein_laufender_anruf" }),
  INTERN: Object.freeze({ error: "intern" }),
});

// PII-freie Log-Gruende (E11).
export const INIT_GRUND = Object.freeze({
  TOKEN: "token",
  KEIN_WARTENDER_ANRUF: "kein_wartender_anruf",
  AGENT: "agent",
  CALLED_NUMBER: "called_number",
  SCHALTER: "schalter",
});

const INIT_LOG_TAG = "el-init";
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
// Schluesselnamen kommen vom Aufrufer: gekappt und auf [A-Za-z0-9_] bereinigt (Log-Injection).
const LOG_SCHLUESSEL_MAX = 20;
const LOG_ZEICHEN_UNERLAUBT = /[^A-Za-z0-9_]/g;
const LOG_ERSATZZEICHEN = "_";
// called_number fehlt -> keine Zusatzpruefung (E11: "falls vorhanden").
const KEINE_NUMMER = Object.freeze([undefined, null, ""]);

// Stufe 1. Ein konfiguriertes Token unter der Mindestlaenge gilt als leer (Empty-Secret-Trap:
// safeEqual("", "") waere true).
function initTokenGueltig(config, req) {
  const erwartet = config.voice.elevenLabsInbound.initWebhookToken;
  if (typeof erwartet !== "string" || erwartet.length < INIT_WEBHOOK_TOKEN_MIN_LENGTH) return false;
  return safeEqual(req.get(INIT_TOKEN_HEADER) || "", erwartet);
}

// Bewusst OHNE Request-Schluessel: vor Stufe 1 ist der Aufrufer unbekannt.
function verweigern(res) {
  console.log(`[${INIT_LOG_TAG}] abgelehnt grund=${INIT_GRUND.TOKEN}`);
  return res.status(HTTP_FORBIDDEN).json(INIT_ANTWORT.VERWEIGERT);
}

function schluesselFuerLog(body) {
  const bereinigt = Object.keys(body ?? {}).map((name) => name.replace(LOG_ZEICHEN_UNERLAUBT, LOG_ERSATZZEICHEN));
  return bereinigt.sort().slice(0, LOG_SCHLUESSEL_MAX).join(",");
}

function keinAnruf({ res, body, grund, callId = null }) {
  const anruf = callId ? ` call=${callId}` : "";
  console.log(
    `[${INIT_LOG_TAG}] abgelehnt grund=${grund} schluessel=${schluesselFuerLog(body)} sip_headers=${sipHeadersFormOf(body)}${anruf}`,
  );
  return res.status(HTTP_NOT_FOUND).json(INIT_ANTWORT.KEIN_ANRUF);
}

// Kandidaten sind NUR aktive Inbound-EL-Calls (Budget-Calls tragen ebenfalls ein streamToken).
function aktiverElInboundCallMitToken(store, token) {
  if (!token) return null;
  return (
    store
      .load()
      .calls.find(
        (call) =>
          call.status === "active" &&
          bridgeStateOf(call) !== BRIDGE_STATE.KEIN_EL_INBOUND &&
          Boolean(call.streamToken) &&
          safeEqual(token, call.streamToken),
      ) || null
  );
}

// E11 Fall (ii): die Wiederholung DERSELBEN Bindung (Anbieter-Retry) - gleiche conversation_id,
// binnen der Frist ab dem persistierten elBoundAt. Ein unlesbares elBoundAt ergibt NaN -> false.
function istWiederholung({ call, conversationId, nowMs }) {
  return (
    bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN &&
    call.elevenlabsConversationId === conversationId &&
    nowMs - Date.parse(call.elBoundAt) < EL_INIT_WIEDERHOLUNG_FRIST_MS
  );
}

function bindbar({ call, conversationId, nowMs }) {
  return bridgeStateOf(call) === BRIDGE_STATE.WARTET || istWiederholung({ call, conversationId, nowMs });
}

function agentPasst(config, body) {
  const agentId = config.voice.elevenLabsOutbound.agentId;
  return Boolean(agentId) && body.agent_id === agentId;
}

function calledNumberPasst(body, call) {
  if (KEINE_NUMMER.includes(body.called_number)) return true;
  return normNum(body.called_number) === call.to;
}

// Stufe 2, nur lesend: liefert den Call oder den Log-Grund (samt callId, wo einer gefunden war).
function zuordnungFuer({ store, config, body, nowMs }) {
  const call = aktiverElInboundCallMitToken(store, callBindingTokenOf(body));
  if (!call) return { grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, call: null };
  if (!bindbar({ call, conversationId: body.conversation_id, nowMs }))
    return { grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, call };
  if (!agentPasst(config, body)) return { grund: INIT_GRUND.AGENT, call };
  if (!calledNumberPasst(body, call)) return { grund: INIT_GRUND.CALLED_NUMBER, call };
  return { grund: null, call };
}

async function handleInit({ req, res, deps }) {
  const { store, config, bridges, now } = deps;
  // 1) Geheimnis - vor jedem Store-Zugriff.
  if (!initTokenGueltig(config, req)) return verweigern(res);

  const body = req.body ?? {};
  const nowMs = now();
  // 2) Zuordnung ueber das Bindungs-Token.
  const zuordnung = zuordnungFuer({ store, config, body, nowMs });
  if (zuordnung.grund) return keinAnruf({ res, body, grund: zuordnung.grund, callId: zuordnung.call?.id });
  const call = zuordnung.call;

  // 3) Schalter und Allowlist - dieselbe Weiche wie der Sprechpfad.
  if (!inboundElPathFor({ config, tenantId: call.tenantId }))
    return keinAnruf({ res, body, grund: INIT_GRUND.SCHALTER, callId: call.id });

  // 4) Set-once-Bindung. Eine verlorene Op (paralleler Init) ergibt bound=false.
  const bindung = store.bindInboundElConversation(call.id, {
    conversationId: body.conversation_id,
    nowIso: new Date(nowMs).toISOString(),
  });
  if (!bindung.bound) return keinAnruf({ res, body, grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, callId: call.id });

  // 5) Nur die ERSTE Bindung loescht die Fristen; eine Wiederholung laesst sie unberuehrt (K1).
  if (bindung.changed) bridges.clearDeadlines(call.id);
  console.log(`[${INIT_LOG_TAG}] ${bindung.changed ? "gebunden" : "wiederholung"} call=${call.id}`);

  // 6) Die Antwort - der EINZIGE Aufrufer des Builders.
  return res.json(buildInitiationResponse({ store, config, call: bindung.call }));
}

/**
 * @param {{store: object, config: object,
 *   bridges: {clearDeadlines: (callId: string) => void}, now?: () => number}} deps
 *   bridges = die EINE Frist-Instanz aus server.js (inbound-bridges.js, INV-7).
 *   now = injizierbare Uhr (Wiederholungsfrist, K1).
 */
export function makeElevenLabsInitWebhookRoutes({ store, config, bridges, now = Date.now }) {
  const router = Router();
  const deps = { store, config, bridges, now };

  // Eigenes Fehler-Netz (Express 4 reicht async-Rejections nicht weiter): generische 500,
  // nie err.stack oder ein Stueck der Nutzlast an den Aufrufer (Regel 4/5).
  router.post(ELEVENLABS_INIT_PATH, async (req, res) => {
    try {
      return await handleInit({ req, res, deps });
    } catch (err) {
      console.error(`[${INIT_LOG_TAG}] fehler: ${err?.message || "unbekannt"}`);
      if (res.headersSent) return res.end();
      return res.status(HTTP_SERVER_ERROR).json(INIT_ANTWORT.INTERN);
    }
  });

  return router;
}
