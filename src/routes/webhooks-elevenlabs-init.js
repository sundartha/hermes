import { Router } from "express";
import { z } from "zod";
import { BRIDGE_STATE, bridgeStateOf, istOutboundElProfil } from "../elevenlabs/inbound-bridge-state.js";
import { INIT_WEBHOOK_TOKEN_MIN_LENGTH, inboundElPathFor } from "../elevenlabs/inbound-path-decision.js";
import {
  INITIATION_RESPONSE_TYPE,
  buildInitiationResponse,
  callBindingTokenOf,
  inboundEroeffnungsDefekteFuer,
  sipHeadersFormOf,
} from "../elevenlabs/inbound-initiation.js";
import { msSeitAnnahme } from "../elevenlabs/inbound-rueckfall.js";
import { RATE_WINDOW_MS, respondTooManyRequests } from "../middleware.js";
import { normNum } from "../begriffe/rufnummern.js";
import { safeEqual } from "../util.js";
import { pruefeKoerper } from "../utils/eingabe-pruefen.js";
import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "../utils/http.ts";

export const ELEVENLABS_INIT_PATH = "/webhooks/elevenlabs/init";
export const INIT_TOKEN_HEADER = "x-hermes-init-token";

export const EL_INIT_WIEDERHOLUNG_FRIST_MS = 10000;

export const INIT_ANTWORT = Object.freeze({
  VERWEIGERT: Object.freeze({ error: "verweigert" }),
  GEDROSSELT: Object.freeze({ error: "gedrosselt" }),
  KEIN_ANRUF: Object.freeze({ error: "kein_laufender_anruf" }),
  INTERN: Object.freeze({ error: "intern" }),
});

export const INIT_GRUND = Object.freeze({
  TOKEN: "token",
  KEIN_WARTENDER_ANRUF: "kein_wartender_anruf",
  AGENT: "agent",
  CALLED_NUMBER: "called_number",
  SCHALTER: "schalter",
  EROEFFNUNG: "eroeffnung",
});

const INIT_LOG_TAG = "el-init";
const LOG_SCHLUESSEL_MAX = 20;
const LOG_ZEICHEN_UNERLAUBT = /[^A-Za-z0-9_]/g;
const LOG_ERSATZZEICHEN = "_";
const INIT_KOERPER = z.object({}).passthrough().catch({});
const KEINE_NUMMER = Object.freeze([undefined, null, ""]);
export const INIT_FEHLVERSUCHE_PRO_MIN = 30;
const INIT_HTTP_METHODE = "POST";
const EXAKTER_ROUTER = Object.freeze({ caseSensitive: true, strict: true });

function initTokenGueltig(config, req) {
  const erwartet = config.voice.elevenLabsInbound.initWebhookToken;
  if (typeof erwartet !== "string" || erwartet.length < INIT_WEBHOOK_TOKEN_MIN_LENGTH) return false;
  return safeEqual(req.get(INIT_TOKEN_HEADER) || "", erwartet);
}

function verweigern(res) {
  console.log(`[${INIT_LOG_TAG}] abgelehnt grund=${INIT_GRUND.TOKEN}`);
  return res.status(HTTP_FORBIDDEN).json(INIT_ANTWORT.VERWEIGERT);
}

export function istInitWebhookAnfrage(req) {
  return req.method === INIT_HTTP_METHODE && req.path === ELEVENLABS_INIT_PATH;
}

function makeDrosselungsMelder({ now, fensterMs }) {
  const stand = { seitLetzterZeile: 0, letzteZeileMs: Number.NEGATIVE_INFINITY };
  return function meldeDrosselungHoechstensJeFenster() {
    stand.seitLetzterZeile += 1;
    const nowMs = now();
    if (nowMs - stand.letzteZeileMs < fensterMs) return;
    console.log(`[${INIT_LOG_TAG}] gedrosselt anzahl=${stand.seitLetzterZeile}`);
    Object.assign(stand, { seitLetzterZeile: 0, letzteZeileMs: nowMs });
  };
}

export function initTokenSchranke({ config, zaehler, now = Date.now }) {
  const meldeDrosselung = makeDrosselungsMelder({ now, fensterMs: RATE_WINDOW_MS });
  return function initTokenSchrankeMiddleware(req, res, next) {
    if (initTokenGueltig(config, req)) return next();
    const { allowed, retryAfterS } = zaehler(req.ip);
    if (allowed) return verweigern(res);
    meldeDrosselung();
    return respondTooManyRequests(res, { retryAfterS, body: INIT_ANTWORT.GEDROSSELT });
  };
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
  const fehlt = KEINE_NUMMER.includes(body.called_number);
  if (istOutboundElProfil(call)) return !fehlt && normNum(body.called_number) === call.from;
  return fehlt || normNum(body.called_number) === call.to;
}

function zuordnungFuer({ store, config, body, nowMs }) {
  const call = aktiverElInboundCallMitToken(store, callBindingTokenOf(body));
  if (!call) return { grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, call: null };
  if (!bindbar({ call, conversationId: body.conversation_id, nowMs }))
    return { grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, call };
  if (!agentPasst(config, body)) return { grund: INIT_GRUND.AGENT, call };
  if (!calledNumberPasst(body, call)) return { grund: INIT_GRUND.CALLED_NUMBER, call };
  return { grund: null, call };
}

const elWegFuer = ({ store, config, call }) =>
  inboundElPathFor({ config, tenantId: call.tenantId, numberRecord: store.numberRecordByE164(call.to) });

const eroeffnungSicher = ({ store, config, call }) => inboundEroeffnungsDefekteFuer({ store, config, call }).length === 0;

function bindungsLogZeile({ bindung, call, nowMs, eingangMs }) {
  if (!bindung.changed) return `[${INIT_LOG_TAG}] wiederholung call=${call.id}`;
  const zeile = `[${INIT_LOG_TAG}] gebunden call=${call.id} ms_seit_annahme=${msSeitAnnahme(call, nowMs)}`;
  if (!istOutboundElProfil(call)) return zeile;
  return `${zeile} ms_bearbeitung=${Math.round(performance.now() - eingangMs)}`;
}

function inboundSperrgrundFuer({ store, config, call }) {
  if (istOutboundElProfil(call)) return null;
  if (!elWegFuer({ store, config, call })) return INIT_GRUND.SCHALTER;
  if (!eroeffnungSicher({ store, config, call })) return INIT_GRUND.EROEFFNUNG;
  return null;
}

function outboundAntwortFuer({ outboundInitInhalt, vorspannText, call }) {
  if (!istOutboundElProfil(call)) return null;
  if (typeof outboundInitInhalt !== "function") throw new Error("Outbound-Init ohne Inhaltsfabrik");
  return { type: INITIATION_RESPONSE_TYPE, ...outboundInitInhalt(call, vorspannText(call.id)) };
}

async function handleInit({ req, res, deps }) {
  const eingangMs = performance.now();
  const { store, config, bridges, now, outboundInitInhalt, vorspannText } = deps;
  if (!initTokenGueltig(config, req)) return verweigern(res);

  const body = pruefeKoerper(res, { schema: INIT_KOERPER }, req.body);
  const nowMs = now();
  const zuordnung = zuordnungFuer({ store, config, body, nowMs });
  if (zuordnung.grund) return keinAnruf({ res, body, grund: zuordnung.grund, callId: zuordnung.call?.id });
  const call = zuordnung.call;

  const sperrgrund = inboundSperrgrundFuer({ store, config, call });
  if (sperrgrund) return keinAnruf({ res, body, grund: sperrgrund, callId: call.id });

  const outboundAntwort = outboundAntwortFuer({ outboundInitInhalt, vorspannText, call });

  const bindung = store.bindInboundElConversation(call.id, {
    conversationId: body.conversation_id,
    nowIso: new Date(nowMs).toISOString(),
  });
  if (!bindung.bound) return keinAnruf({ res, body, grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, callId: call.id });

  if (bindung.changed) bridges.clearDeadlines(call.id);
  console.log(bindungsLogZeile({ bindung, call, nowMs, eingangMs }));

  return res.json(outboundAntwort ?? buildInitiationResponse({ store, config, call: bindung.call }));
}

export function makeElevenLabsInitWebhookRoutes({ store, config, bridges, now = Date.now, outboundInitInhalt, vorspannText }) {
  const router = Router(EXAKTER_ROUTER);
  const deps = { store, config, bridges, now, outboundInitInhalt, vorspannText };

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
