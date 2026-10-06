import crypto from "node:crypto";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../turn-budget.js";
import { TS_HEADER } from "./adapters/telnyx/signature.js";

export const TURN_TOKEN_PARAM = "turnToken";
const TURN_TOKEN_BYTES = 8;
const ANSWER_CACHE_MAX = 200;

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

function answerWithinProviderDeadline(pending) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), PROVIDER_WEBHOOK_HARDCUT_MS);
    timer.unref?.();
    pending.then((answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

function replayAnswer(res, answer) {
  res.status(answer.status);
  if (answer.contentType) res.type(answer.contentType);
  return res.send(answer.body);
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

  function rememberAnswerOnSend({ req, res, anchors, deferred, remember }) {
    const send = res.send.bind(res);
    Object.assign(res, {
      send(body) {
        try {
          deferred.settle({
            status: res.statusCode,
            contentType: res.get("Content-Type"),
            body,
          });
          remember(req, anchors);
        } catch (err) {
          console.error("[webhook-idempotenz]", err.message);
        }
        return send(body);
      },
    });
    res.on("close", () => deferred.settle(null));
  }

  function makeGuard({ anchorsOf, seenBefore, remember }) {
    return async function webhookIdempotenzGuard(req, res, next) {
      const anchors = anchorsOf(req);
      if (!anchors.length) return next();
      const pending = pendingFor(anchors);
      if (pending) {
        const answer = await answerWithinProviderDeadline(pending);
        return answer ? replayAnswer(res, answer) : next();
      }
      const known = seenBefore(req, anchors);
      if (known) return res.type("text/xml").send(keepAliveXml(known));
      const deferred = makeDeferredAnswer();
      claimAnchors(anchors, deferred.answer);
      rememberAnswerOnSend({ req, res, anchors, deferred, remember });
      return next();
    };
  }

  const forIncoming = makeGuard({
    anchorsOf: incomingAnchors,
    seenBefore: (req) => store.getCall(req.body?.CallSid || ""),
    remember: () => {},
  });

  const forTurn = makeGuard({
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
  const forElRueckfall = makeGuard({ anchorsOf: elRueckfallAnchors, ...ohneNeustartSchicht });
  const forElBein = makeGuard({ anchorsOf: elBeinAnchors, ...ohneNeustartSchicht });

  return { forIncoming, forTurn, forElRueckfall, forElBein };
}
