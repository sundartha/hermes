import { HTTP_OK } from "../utils/http.ts";
import crypto from "node:crypto";
import { z } from "zod";
import { setTimeout as pause } from "node:timers/promises";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../turn-budget.js";
import { ergebnisOderNull } from "./ergebnis-oder-null.js";
import { escapeXml } from "./adapters/telnyx/render.js";
import { TS_HEADER } from "./adapters/telnyx/signature.js";
import { BRIDGE_STATE, bridgeStateOf, istOutboundElProfil } from "../elevenlabs/inbound-bridge-state.js";

export const TURN_TOKEN_PARAM = "turnToken";
const TURN_TOKEN_BYTES = 8;
const ANSWER_CACHE_MAX = 200;
const FREMDE_ANNAHME_TAKT_MS = 200;
const KEEPALIVE_CONTENT_TYPE = "text/xml";
const GEHEIMNIS_MARKE = "hermes-el-sip-geheimnis-marke";
const REPLAY_LOG_PREFIX = "[webhook-idempotenz]";
const REPLAY_ART = Object.freeze({
  ANTWORT_WIEDERHOLT: "antwort_wiederholt",
  NEU_VERARBEITET: "neu_verarbeitet",
  KEEPALIVE: "keepalive",
  OHNE_ERKENNUNG: "ohne_erkennung",
  UEBERNOMMEN: "uebernommen",
});

const FREIGABE_GRUND = Object.freeze({
  ABBRUCH: "abbruch",
  ABLEGEN_FEHLGESCHLAGEN: "ablegen_fehlgeschlagen",
  SPAET: "spaet",
});

const REPLAY_GRUND = Object.freeze({ FRIST: "frist", FEHLER: "fehler" });

const ankerTeil = (wert) => z.string().catch("").parse(wert);

export function newTurnToken() {
  return crypto.randomBytes(TURN_TOKEN_BYTES).toString("hex");
}

function envelopeAnchor(req) {
  const timestamp = req.headers?.[TS_HEADER];
  if (!timestamp || !req.rawBody) return null;
  const hash = crypto.createHash("sha256");
  hash.update(`${timestamp}|`);
  hash.update(req.rawBody);
  return `e:${hash.digest("hex")}`;
}

export function incomingAnchors(req) {
  const sid = ankerTeil(req.body?.CallSid);
  return sid ? [`in:${sid}`] : [];
}

export function turnAnchors(req) {
  const token = ankerTeil(req.query?.[TURN_TOKEN_PARAM]);
  const anchors = [];
  if (token) anchors.push(`t:${token}`);
  const envelope = envelopeAnchor(req);
  if (envelope) anchors.push(envelope);
  return anchors;
}

function queryEreignisAnker(req, { praefix, unterscheider }) {
  const callId = ankerTeil(req.query?.callId);
  const anchors = callId ? [`${praefix}:${callId}:${ankerTeil(unterscheider)}`] : [];
  const envelope = envelopeAnchor(req);
  return envelope ? [...anchors, envelope] : anchors;
}
export const elRueckfallAnchors = (req) => queryEreignisAnker(req, { praefix: "rk", unterscheider: req.query?.quelle });
export const elUebergabeAnchors = (req) => queryEreignisAnker(req, { praefix: "eu", unterscheider: "" });
export const elBeinAnchors = (req) => queryEreignisAnker(req, { praefix: "eb", unterscheider: req.body?.CallStatus });

function makeDeferredAnswer() {
  let settle;
  const answer = new Promise((resolve) => {
    settle = resolve;
  });
  return { answer, settle };
}

const answerWithinProviderDeadline = (pending) => ergebnisOderNull(pending, PROVIDER_WEBHOOK_HARDCUT_MS);

function replayAnswer(res, answer) {
  res.status(answer.status);
  if (answer.contentType) res.type(answer.contentType);
  return res.send(answer.body);
}

function logWiederholung(weg, art, grund = null) {
  const zusatz = grund ? ` grund=${grund}` : "";
  console.log(`${REPLAY_LOG_PREFIX} wiederholte_zustellung weg=${weg} art=${art}${zusatz}`);
}

const logFreigabe = (weg, grund) => console.log(`${REPLAY_LOG_PREFIX} annahme_freigegeben weg=${weg} grund=${grund}`);

const logOhneErkennung = (weg, err) =>
  logWiederholung(weg, REPLAY_ART.OHNE_ERKENNUNG, err?.frist ? REPLAY_GRUND.FRIST : REPLAY_GRUND.FEHLER);

async function beantworteWartende({ pending, weg, res, next }) {
  const answer = await answerWithinProviderDeadline(pending);
  logWiederholung(weg, answer ? REPLAY_ART.ANTWORT_WIEDERHOLT : REPLAY_ART.NEU_VERARBEITET);
  return answer ? replayAnswer(res, answer) : next();
}

const alsText = (body) => (Buffer.isBuffer(body) ? body.toString("utf8") : body);

function geheimnisRaus(answer, geheimnis) {
  const wert = geheimnis();
  if (!wert) return answer;
  return { ...answer, body: alsText(answer.body).split(escapeXml(wert)).join(GEHEIMNIS_MARKE) };
}

function geheimnisEin(antwort, geheimnis) {
  const text = alsText(antwort.body);
  if (!text.includes(GEHEIMNIS_MARKE)) return antwort;
  const wert = geheimnis();
  if (!wert) return null;
  return { ...antwort, body: text.split(GEHEIMNIS_MARKE).join(escapeXml(wert)) };
}

function liefereAusAblage({ deferred, weg, res, antwort }) {
  deferred.settle(antwort);
  logWiederholung(weg, REPLAY_ART.ANTWORT_WIEDERHOLT);
  return replayAnswer(res, antwort);
}

function liefereKeepAlive({ deferred, weg, res, xml }) {
  const keepAlive = { status: HTTP_OK, contentType: KEEPALIVE_CONTENT_TYPE, body: xml };
  deferred.settle(keepAlive);
  logWiederholung(weg, REPLAY_ART.KEEPALIVE);
  return replayAnswer(res, keepAlive);
}

const signierterCallSid = (req) => ankerTeil(req.body?.CallSid);

const spaetFreigabe = (weg) => ({
  beiSpaeterFreigabe: () => logFreigabe(weg, FREIGABE_GRUND.SPAET),
  beiSpaeterFehler: (err) => logOhneErkennung(weg, err),
});

async function annehmenOderNull({ ablage, weg, bindung }) {
  if (!ablage) return null;
  try {
    return await ablage.annehmen(bindung, spaetFreigabe(weg));
  } catch (err) {
    logOhneErkennung(weg, err);
    return null;
  }
}

async function lesenBis({ ablage, kennung, bindung, ende }) {
  const gelesen = await ergebnisOderNull(ablage.lies(kennung, bindung), ende - Date.now());
  if (!gelesen || gelesen.antwort || !gelesen.offen) return gelesen?.antwort ?? null;
  if (Date.now() + FREMDE_ANNAHME_TAKT_MS >= ende) return null;
  await pause(FREMDE_ANNAHME_TAKT_MS);
  return lesenBis({ ablage, kennung, bindung, ende });
}

async function uebernehmen({ ablage, weg, angenommen, bindung, ankunft }) {
  const uebernommen = await ablage.uebernehmen(angenommen.kennung, bindung, spaetFreigabe(weg));
  if (uebernommen.eigen) logWiederholung(weg, `${REPLAY_ART.UEBERNOMMEN} warte_ms=${Date.now() - ankunft}`);
  return { angenommen: uebernommen.eigen ? uebernommen : angenommen, antwort: uebernommen.antwort };
}

async function wartenAufFremdeAntwort({ ablage, weg, angenommen, bindung, ankunft }) {
  if (angenommen?.eigen !== false || angenommen.antwort || !angenommen.kennung) {
    return { angenommen, antwort: angenommen?.antwort ?? null };
  }
  const ende = Date.now() + PROVIDER_WEBHOOK_HARDCUT_MS - angenommen.alterMs;
  try {
    const gelesen = await lesenBis({ ablage, kennung: angenommen.kennung, bindung, ende });
    if (gelesen) return { angenommen, antwort: gelesen };
    return await uebernehmen({ ablage, weg, angenommen, bindung, ankunft });
  } catch (err) {
    logOhneErkennung(weg, err);
    return { angenommen, antwort: null };
  }
}

function freigabeFuer({ ablage, weg, angenommen, bindung }) {
  if (!angenommen?.eigen) return () => {};
  return (grund) =>
    ablage
      .freigeben(angenommen.kennung, bindung)
      .then(() => logFreigabe(weg, grund))
      .catch((err) => logOhneErkennung(weg, err));
}

function antwortAblegen({ ablage, weg, angenommen, bindung, geheimnis, freigeben }) {
  if (angenommen && !angenommen.eigen) logWiederholung(weg, REPLAY_ART.NEU_VERARBEITET);
  if (!angenommen?.eigen) return () => {};
  return (answer) => {
    if (typeof answer.body !== "string" && !Buffer.isBuffer(answer.body)) return;
    ablage
      .beantworten(angenommen.kennung, bindung, geheimnisRaus(answer, geheimnis))
      .catch((err) => {
        logOhneErkennung(weg, err);
        return freigeben(FREIGABE_GRUND.ABLEGEN_FEHLGESCHLAGEN);
      });
  };
}

function rememberAnswerOnSend({ req, res, anchors, deferred, remember, ablegen, freigeben, verwerfen }) {
  const send = res.send.bind(res);
  let gesendet = false;
  Object.assign(res, {
    send(body) {
      gesendet = true;
      try {
        const answer = { status: res.statusCode, contentType: res.get("Content-Type"), body };
        deferred.settle(answer);
        remember(req, anchors);
        ablegen(answer);
      } catch (err) {
        console.error(REPLAY_LOG_PREFIX, err.message);
      }
      return send(body);
    },
  });
  res.on("close", () => {
    deferred.settle(null);
    if (gesendet) return;
    verwerfen();
    freigeben(FREIGABE_GRUND.ABBRUCH);
  });
}

export function makeWebhookIdempotenz({ store, keepAliveXml, elPasswort }) {
  const deliveries = new Map();

  function pendingFor(anchors) {
    for (const anchor of anchors) {
      const pending = deliveries.get(anchor);
      if (pending) return pending;
    }
    return null;
  }

  function claimAnchors(anchors, pending) {
    for (const anchor of anchors) deliveries.set(anchor, pending);
    while (deliveries.size > ANSWER_CACHE_MAX)
      deliveries.delete(deliveries.keys().next().value);
  }

  function releaseAnchors(anchors, pending) {
    for (const anchor of anchors) if (deliveries.get(anchor) === pending) deliveries.delete(anchor);
  }

  function makeGuard({ weg, anchorsOf, seenBefore, remember, ablage = null, geheimnis }) {
    return async function webhookIdempotenzGuard(req, res, next) {
      const ankunft = Date.now();
      const anchors = anchorsOf(req);
      if (!anchors.length) return next();
      const pending = pendingFor(anchors);
      if (pending) return beantworteWartende({ pending, weg, res, next });
      const deferred = makeDeferredAnswer();
      claimAnchors(anchors, deferred.answer);
      const bindung = { anker: anchors, callSid: signierterCallSid(req) };
      const zuerst = await annehmenOderNull({ ablage, weg, bindung });
      const warten = { ablage, weg, angenommen: zuerst, bindung, ankunft };
      const { angenommen, antwort: gefunden } = await wartenAufFremdeAntwort(warten);
      const fremdeAntwort = gefunden && geheimnisEin(gefunden, geheimnis);
      if (fremdeAntwort) return liefereAusAblage({ deferred, weg, res, antwort: fremdeAntwort });
      const known = seenBefore(req, anchors);
      if (known) {
        releaseAnchors(anchors, deferred.answer);
        return liefereKeepAlive({ deferred, weg, res, xml: keepAliveXml(known) });
      }
      const freigeben = freigabeFuer({ ablage, weg, angenommen, bindung });
      const ablegen = antwortAblegen({ ablage, weg, angenommen, bindung, geheimnis, freigeben });
      const verwerfen = () => angenommen?.eigen && releaseAnchors(anchors, deferred.answer);
      rememberAnswerOnSend({ req, res, anchors, deferred, remember, ablegen, freigeben, verwerfen });
      return next();
    };
  }

  const forIncoming = makeGuard({
    weg: "incoming",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: incomingAnchors,
    seenBefore: (req) => store.getCall(req.body?.CallSid || ""),
    remember: () => {},
  });

  const forTurn = makeGuard({
    weg: "turn",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: turnAnchors,
    seenBefore: (req, anchors) => {
      const call = store.getCall(req.query?.callId || "");
      if (!call) return null;
      const seen = call.webhookAnchors ?? [];
      return anchors.some((anchor) => seen.includes(anchor)) ? call : null;
    },
    remember: (req, anchors) => store.recordWebhookAnchors(req.query?.callId || "", anchors),
  });

  const ohneNeustartSchicht = { seenBefore: () => null, remember: () => {} };
  const forElRueckfall = makeGuard({
    weg: "el-rueckfall",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: elRueckfallAnchors,
    ...ohneNeustartSchicht,
  });
  const uebergabeLaeuftOderEndete = (req) => {
    const call = store.getCall(ankerTeil(req.query?.callId));
    return [BRIDGE_STATE.GEBUNDEN, BRIDGE_STATE.RUECKFALL].includes(bridgeStateOf(call)) ? call : null;
  };
  const forElUebergabe = makeGuard({
    weg: "el-uebergabe",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: (req) => (istOutboundElProfil(store.getCall(ankerTeil(req.query?.callId))) ? elUebergabeAnchors(req) : []),
    seenBefore: uebergabeLaeuftOderEndete,
    remember: ohneNeustartSchicht.remember,
  });
  const forElBein = makeGuard({ weg: "el-bein", anchorsOf: elBeinAnchors, ...ohneNeustartSchicht });

  return { forIncoming, forTurn, forElRueckfall, forElBein, forElUebergabe };
}
