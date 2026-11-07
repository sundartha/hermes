import crypto from "node:crypto";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../turn-budget.js";
import { ergebnisOderNull } from "./ergebnis-oder-null.js";
import { TS_HEADER } from "./adapters/telnyx/signature.js";

export const TURN_TOKEN_PARAM = "turnToken";
const TURN_TOKEN_BYTES = 8;
const ANSWER_CACHE_MAX = 200;
const HTTP_OK = 200;
const KEEPALIVE_CONTENT_TYPE = "text/xml";
const REPLAY_LOG_PREFIX = "[webhook-idempotenz]";
const REPLAY_ART = Object.freeze({
  ANTWORT_WIEDERHOLT: "antwort_wiederholt",
  NEU_VERARBEITET: "neu_verarbeitet",
  KEEPALIVE: "keepalive",
  OHNE_ERKENNUNG: "ohne_erkennung",
});

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
  const sid = req.body?.CallSid;
  return typeof sid === "string" && sid ? [`in:${sid}`] : [];
}

export function turnAnchors(req) {
  const token = req.query?.[TURN_TOKEN_PARAM];
  const anchors = [];
  if (typeof token === "string" && token) anchors.push(`t:${token}`);
  const envelope = envelopeAnchor(req);
  if (envelope) anchors.push(envelope);
  return anchors;
}

const ankerTeil = (wert) => (typeof wert === "string" ? wert : "");
function queryEreignisAnker(req, { praefix, unterscheider }) {
  const callId = ankerTeil(req.query?.callId);
  const anchors = callId ? [`${praefix}:${callId}:${ankerTeil(unterscheider)}`] : [];
  const envelope = envelopeAnchor(req);
  return envelope ? [...anchors, envelope] : anchors;
}
export const elRueckfallAnchors = (req) => queryEreignisAnker(req, { praefix: "rk", unterscheider: req.query?.quelle });
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

function logWiederholung(weg, art) {
  console.log(`${REPLAY_LOG_PREFIX} wiederholte_zustellung weg=${weg} art=${art}`);
}

async function beantworteWartende({ pending, weg, res, next }) {
  const answer = await answerWithinProviderDeadline(pending);
  logWiederholung(weg, answer ? REPLAY_ART.ANTWORT_WIEDERHOLT : REPLAY_ART.NEU_VERARBEITET);
  return answer ? replayAnswer(res, answer) : next();
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

async function annehmenOderNull({ ablage, weg, bindung }) {
  if (!ablage) return null;
  try {
    return await ablage.annehmen(bindung);
  } catch {
    logWiederholung(weg, REPLAY_ART.OHNE_ERKENNUNG);
    return null;
  }
}

function antwortAblegen({ ablage, weg, angenommen, bindung }) {
  if (angenommen && !angenommen.eigen) logWiederholung(weg, REPLAY_ART.NEU_VERARBEITET);
  if (!angenommen?.eigen) return () => {};
  return (answer) => {
    if (typeof answer.body !== "string" && !Buffer.isBuffer(answer.body)) return;
    ablage
      .beantworten(angenommen.kennung, bindung, answer)
      .catch(() => logWiederholung(weg, REPLAY_ART.OHNE_ERKENNUNG));
  };
}

function rememberAnswerOnSend({ req, res, anchors, deferred, remember, ablegen }) {
  const send = res.send.bind(res);
  Object.assign(res, {
    send(body) {
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
  res.on("close", () => deferred.settle(null));
}

export function makeWebhookIdempotenz({ store, keepAliveXml }) {
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

  function makeGuard({ weg, anchorsOf, seenBefore, remember, ablage = null }) {
    return async function webhookIdempotenzGuard(req, res, next) {
      const anchors = anchorsOf(req);
      if (!anchors.length) return next();
      const pending = pendingFor(anchors);
      if (pending) return beantworteWartende({ pending, weg, res, next });
      const deferred = makeDeferredAnswer();
      claimAnchors(anchors, deferred.answer);
      const bindung = { anker: anchors, callSid: signierterCallSid(req) };
      const angenommen = await annehmenOderNull({ ablage, weg, bindung });
      if (angenommen?.antwort) return liefereAusAblage({ deferred, weg, res, antwort: angenommen.antwort });
      const known = seenBefore(req, anchors);
      if (known) {
        releaseAnchors(anchors, deferred.answer);
        return liefereKeepAlive({ deferred, weg, res, xml: keepAliveXml(known) });
      }
      const ablegen = antwortAblegen({ ablage, weg, angenommen, bindung });
      rememberAnswerOnSend({ req, res, anchors, deferred, remember, ablegen });
      return next();
    };
  }

  const forIncoming = makeGuard({
    weg: "incoming",
    anchorsOf: incomingAnchors,
    seenBefore: (req) => store.getCall(req.body?.CallSid || ""),
    remember: () => {},
  });

  const forTurn = makeGuard({
    weg: "turn",
    ablage: store.webhookZustellung ?? null,
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
  const forElRueckfall = makeGuard({ weg: "el-rueckfall", anchorsOf: elRueckfallAnchors, ...ohneNeustartSchicht });
  const forElBein = makeGuard({ weg: "el-bein", anchorsOf: elBeinAnchors, ...ohneNeustartSchicht });

  return { forIncoming, forTurn, forElRueckfall, forElBein };
}
