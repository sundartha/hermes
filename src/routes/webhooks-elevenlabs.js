import { Router } from "express";
import { blockingBudgetAxis } from "../budget-gate.js";
import { consultAllowedForCall } from "../consult/gate.js";
import { MAX_IN_CALL_CONSULTS_PER_CALL } from "../consult/in-call.js";
import { CONSULT_RESULT } from "../conversation/consult-raised.js";
import { TENANT_TOKEN_VERDICT, tenantTokenVerdict } from "../elevenlabs/tenant-tool-token.js";
import { localeFor } from "../i18n/locales.js";
import { bookLookupSearchFee } from "../llm-usage.js";
import { lookupFactsFrom, sanitizeLookupQuery } from "../research/lookup-guard.js";
import {
  LOOKUP_MAX_PER_CALL,
  elevenLabsLookupProviderFor,
} from "../research/registry.js";
import { consultQuotaUsed, elevenLabsLookupCount } from "../store/state-ops.js";
import { safeEqual } from "../util.js";

export const ELEVENLABS_CONSULT_PATH = "/webhooks/elevenlabs/consult";
export const ELEVENLABS_LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const CONSULT_LOG_TAG = "el-consult";
const LOOKUP_LOG_TAG = "el-lookup";
const EL_LOOKUP_TIMEOUT_MS = 6000;

const CONSULT_TIMEOUT_AUDIT_ACTION = "consult_timeout";

const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

const DENIAL_NO_ADDRESSABLE_CALL = "kein_laufender_anruf";

function toolResultText(outcome, locale) {
  const control = locale.prompt.turnControl;
  if (outcome.kind === CONSULT_RESULT.REJECTED) return control.consultDeclined;
  return outcome.facts.length ? outcome.facts.join(" ") : control.consultTimeout;
}

function consultResponseBody(outcome, locale) {
  return {
    status: outcome.kind,
    reason: outcome.reason ?? null,
    answer: toolResultText(outcome, locale),
  };
}

function consultTimeoutDetail(callId, reason, trace) {
  const felder = [
    `call=${callId}`,
    `consult=${trace.consultId}`,
    `grund=${reason}`,
    `halt_ms=${trace.holdMs}`,
  ];
  if (trace.deliveredAfterMs !== null) felder.push(`zugestellt_nach_ms=${trace.deliveredAfterMs}`);
  if (trace.ackedAfterMs !== null) felder.push(`quittiert_nach_ms=${trace.ackedAfterMs}`);
  return felder.join(" ");
}

function traceConsultAbort({ call, outcome, auditFor }) {
  if (!outcome.abortTrace) return;
  auditFor(call.tenantId)(
    CONSULT_TIMEOUT_AUDIT_ACTION,
    null,
    consultTimeoutDetail(call.id, outcome.reason, outcome.abortTrace),
  );
}

function activeCallBoundTo(store, conversationId) {
  if (typeof conversationId !== "string" || !conversationId) return null;
  const calls = store.load().calls;
  return (
    calls.find(
      (call) => call.elevenlabsConversationId === conversationId && call.status === "active",
    ) || null
  );
}

function toolDenied({ res, tag, status, logGrund, antwortGrund = logGrund, callId = null }) {
  console.log(`[${tag}] abgelehnt grund=${logGrund}${callId ? ` call=${callId}` : ""}`);
  return res.status(status).json({ error: antwortGrund });
}

function denyBoundCall({ res, tag, logGrund, callId = null }) {
  return toolDenied({
    res,
    tag,
    status: HTTP_NOT_FOUND,
    logGrund,
    antwortGrund: DENIAL_NO_ADDRESSABLE_CALL,
    callId,
  });
}

function boundCallFor({ store, config, req }) {
  const call = activeCallBoundTo(store, req.body?.conversation_id);
  if (!call) return { call: null, logGrund: "kein_laufender_anruf", callId: null };
  const urteil = tenantTokenVerdict({
    secret: config.voice.elevenLabsToolToken,
    tenantId: call.tenantId,
    presented: req.body?.tenant_token,
  });
  if (urteil === TENANT_TOKEN_VERDICT.PASSEND) return { call, logGrund: null, callId: call.id };
  if (urteil === TENANT_TOKEN_VERDICT.FEHLT && config.voice.elevenLabsTenantTokenRequired !== true)
    return { call, logGrund: null, callId: call.id };
  return { call: null, logGrund: `mandant_${urteil}`, callId: call.id };
}

function lookupAnswer(res, { callId, status, answer }) {
  console.log(`[${LOOKUP_LOG_TAG}] call=${callId} ergebnis=${status}`);
  return res.json({ status, answer });
}

function lookupPayloadQuery(req) {
  const query = req.body?.query;
  if (typeof query !== "string" || !query.trim()) return null;
  return query;
}

function preflightLookup({ call, query, control, res }) {
  const declined = () =>
    lookupAnswer(res, { callId: call.id, status: "declined", answer: control.lookUpDeclinedSpoken });
  if (elevenLabsLookupCount(call) >= LOOKUP_MAX_PER_CALL) {
    console.log(`[${LOOKUP_LOG_TAG}] abgelehnt grund=kontingent call=${call.id}`);
    return { done: declined() };
  }
  const sanitized = sanitizeLookupQuery(query, call);
  if (!sanitized) {
    console.warn(`[${LOOKUP_LOG_TAG}] verworfen grund=egress call=${call.id}`);
    return { done: declined() };
  }
  return { sanitized };
}

async function executeLookup({ store, call, provider, query, control, res }) {
  const seq = store.recordCallLookup(call.id, query);
  bookLookupSearchFee({ tenantId: call.tenantId });
  const startedAt = Date.now();
  const result = await provider.searchFacts({ query, timeoutMs: EL_LOOKUP_TIMEOUT_MS });
  const facts = result.ok ? lookupFactsFrom(result.facts) : [];
  const dauerMs = Date.now() - startedAt;
  store.finishCallLookup(call.id, seq, {
    ok: result.ok === true,
    factCount: facts.length,
    dauerMs,
  });
  console.log(
    `[${LOOKUP_LOG_TAG}] fertig call=${call.id} ok=${result.ok === true} dauer_ms=${dauerMs} fakten=${facts.length}`,
  );
  if (!facts.length) {
    return lookupAnswer(res, {
      callId: call.id,
      status: "no_results",
      answer: control.lookUpUnavailable,
    });
  }
  return lookupAnswer(res, {
    callId: call.id,
    status: "ok",
    answer: `${control.lookUpFactsFrame}${facts.join(" ")}`,
  });
}

async function handleLookup(req, res, { store, config }) {
  const secret = config.voice.elevenLabsToolToken;
  if (!secret || !safeEqual(req.get(TOOL_TOKEN_HEADER) || "", secret))
    return toolDenied({ res, tag: LOOKUP_LOG_TAG, status: HTTP_FORBIDDEN, logGrund: "token" });

  const bindung = boundCallFor({ store, config, req });
  if (!bindung.call)
    return denyBoundCall({
      res,
      tag: LOOKUP_LOG_TAG,
      logGrund: bindung.logGrund,
      callId: bindung.callId,
    });
  const call = bindung.call;

  const provider = elevenLabsLookupProviderFor(call, store.resolveProfile);
  if (!provider)
    return denyBoundCall({
      res,
      tag: LOOKUP_LOG_TAG,
      logGrund: "kanal_nicht_freigegeben",
      callId: call.id,
    });

  const budgetAxis = blockingBudgetAxis({ store, billing: config.billing, tenantId: call.tenantId });
  if (budgetAxis)
    return toolDenied({
      res,
      tag: LOOKUP_LOG_TAG,
      status: HTTP_PAYMENT_REQUIRED,
      logGrund: budgetAxis,
    });

  const query = lookupPayloadQuery(req);
  if (!query)
    return toolDenied({
      res,
      tag: LOOKUP_LOG_TAG,
      status: HTTP_BAD_REQUEST,
      logGrund: "keine_anfrage",
    });

  const control = localeFor(call.language).prompt.turnControl;
  const preflight = preflightLookup({ call, query, control, res });
  if (preflight.done) return preflight.done;

  return executeLookup({ store, call, provider, query: preflight.sanitized, control, res });
}

export function makeElevenLabsWebhookRoutes({
  store,
  config,
  onConsultRaised,
  consultSlots,
  auditFor,
}) {
  const router = Router();

  function consultAllowed(call) {
    return (
      config.tenancy.inCallConsultEnabled === true &&
      consultAllowedForCall(call, store.resolveProfile(call.tenantId)) &&
      call.direction === "outbound" &&
      consultQuotaUsed(call) < MAX_IN_CALL_CONSULTS_PER_CALL
    );
  }

  function payloadQuestion(req) {
    const question = req.body?.question;
    if (typeof question !== "string" || !question.trim()) return null;
    return question;
  }

  async function handleConsult(req, res) {
    const secret = config.voice.elevenLabsToolToken;
    if (!secret || !safeEqual(req.get(TOOL_TOKEN_HEADER) || "", secret))
      return toolDenied({ res, tag: CONSULT_LOG_TAG, status: HTTP_FORBIDDEN, logGrund: "token" });

    const bindung = boundCallFor({ store, config, req });
    if (!bindung.call)
      return denyBoundCall({
        res,
        tag: CONSULT_LOG_TAG,
        logGrund: bindung.logGrund,
        callId: bindung.callId,
      });
    const call = bindung.call;

    if (!consultAllowed(call))
      return denyBoundCall({
        res,
        tag: CONSULT_LOG_TAG,
        logGrund: "kanal_nicht_freigegeben",
        callId: call.id,
      });

    const budgetAxis = blockingBudgetAxis({
      store,
      billing: config.billing,
      tenantId: call.tenantId,
    });
    if (budgetAxis)
      return toolDenied({
        res,
        tag: CONSULT_LOG_TAG,
        status: HTTP_PAYMENT_REQUIRED,
        logGrund: budgetAxis,
      });

    const question = payloadQuestion(req);
    if (!question)
      return toolDenied({
        res,
        tag: CONSULT_LOG_TAG,
        status: HTTP_BAD_REQUEST,
        logGrund: "keine_frage",
      });

    const held = await consultSlots.withOpenSlot(call.id, call.tenantId, () =>
      onConsultRaised({ callId: call.id, question }),
    );
    if (!held.granted)
      return toolDenied({
        res,
        tag: CONSULT_LOG_TAG,
        status: HTTP_NOT_FOUND,
        logGrund: "kein_freier_platz",
      });
    const outcome = held.value;
    console.log(`[${CONSULT_LOG_TAG}] call=${call.id} ergebnis=${outcome.kind}`);
    traceConsultAbort({ call, outcome, auditFor });
    return res.json(consultResponseBody(outcome, localeFor(call.language)));
  }

  router.post(ELEVENLABS_CONSULT_PATH, async (req, res) => {
    try {
      return await handleConsult(req, res);
    } catch (err) {
      console.error(`[${CONSULT_LOG_TAG}] fehler: ${err?.stack || err?.message || "unbekannt"}`);
      if (res.headersSent) return res.end();
      return res.status(HTTP_SERVER_ERROR).json({ error: "intern" });
    }
  });

  router.post(ELEVENLABS_LOOKUP_PATH, async (req, res) => {
    try {
      return await handleLookup(req, res, { store, config });
    } catch (err) {
      console.error(`[${LOOKUP_LOG_TAG}] fehler: ${err?.stack || err?.message || "unbekannt"}`);
      if (res.headersSent) return res.end();
      return res.status(HTTP_SERVER_ERROR).json({ error: "intern" });
    }
  });

  return router;
}
