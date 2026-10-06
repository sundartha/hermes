import { Router } from "express";
import { normNum, CONSULT_ANSWER, CONSULT_ANSWER_MODE } from "../store/defaults.js";
import { validateAssistantContext } from "./_validation.js";
import { consultAllowedFor } from "../consult/gate.js";
import { CONSULT_OPEN_MS } from "../consult/in-call.js";
import { CONSULT_EVENT } from "../consult/delivery.js";
import { isConsultEventId } from "../store/state-ops.js";
import {
  E164_FORMAT_ERROR,
  isTrunkZeroFormatError,
  runOutboundGates,
} from "../telephony/outbound-gates.js";
import { startRejectionReason } from "../telephony/failure-reason.js";
import { findDuplicateOutboundCall } from "../telephony/call-dedup.js";
import { KOSTENPROFIL } from "../billing/kostenarten.js";
import { diagnosticRetentionGranted } from "../diagnostic-retention.js";
import { ownerSelfCallGranted } from "../callee-is-owner.js";
import { hangUpForCall, persistEndWithReason } from "../telephony/call-termination.js";
import { ELEVENLABS_PROVIDER_MAX_DURATION_S, callLocaleOf, endeSchreiberFuer } from "../elevenlabs/outbound.js";
import { nachlaufPolitikFuer } from "../elevenlabs/nachlauf-politik.js";
import { fetchOpeningLine } from "../elevenlabs/opening-line-llm.js";
import { localeFor, supportedLanguageOf } from "../i18n/locales.js";
import { fetchPrecallBriefing } from "../precall-briefing.js";
import { metrics } from "../metrics.js";
import { internalOnly } from "../wiring/internal-only.js";
import { unsupportedLanguageBody, languageUnavailableBody } from "./_call-request.js";

function contextReceivedMeta(context, config) {
  return {
    active: config.tenancy.assistantContextEnabled,
    summary: !!context?.summary,
    key_facts_count: Array.isArray(context?.key_facts) ? context.key_facts.length : 0,
    recipient_relationship: !!context?.recipient_relationship,
    desired_outcome: !!context?.desired_outcome,
  };
}

const providerStatusOf = (err) => err?.providerStatus;

export function endFailedCallWithReason(store, callId, providerStatus) {
  return persistEndWithReason({
    store,
    callId,
    reason: startRejectionReason(providerStatus),
    endCall: () => store.endCallRecord(callId, "failed"),
  });
}

function elevenLabsCallNotWired() {
  throw new Error(
    "ELEVENLABS_OUTBOUND_ENABLED ist an, aber der Anrufstart ist nicht verdrahtet (deps.elevenLabsOutbound fehlt)",
  );
}

function callQuotaDenialNotWired() {
  throw new Error(
    "callQuotaDenial ist nicht verdrahtet (deps.callQuotaDenial fehlt) - Quoten-Pruefung im Claim-Lock kann nicht laufen",
  );
}

function elevenLabsHangUpActionNotWired(_endActiveCall, call) {
  console.error(
    `[cancel] ELEVENLABS_OUTBOUND_ENABLED ist an, aber elevenLabsHangUpAction ist nicht verdrahtet (deps fehlt, call=${call.id})`,
  );
  return null;
}

function invalidConsultAnswerStatus(status) {
  if (status === undefined) return null;
  if (status === CONSULT_ANSWER_MODE.WORKING || status === CONSULT_ANSWER_MODE.FINAL) return null;
  return "status ist ungueltig";
}

function ackWorkingConsult({ store, audit, req, res, call, eventId }) {
  const { outcome } = store.ackConsult(call.id, { eventId });
  audit("consult_acked", req, `call=${call.id} event=${eventId} ergebnis=${outcome}`);
  if (outcome !== CONSULT_ANSWER.ACCEPTED) return res.status(409).json({ error: outcome });
  return res.json({ accepted: true, merged_facts: 0 });
}

function answerConsultFinal({ store, audit, req, res, call, eventId, answers }) {
  const validated = validateAssistantContext({ key_facts: answers });
  if (validated.error || !validated.value)
    return res.status(400).json({ error: validated.error || "answers ist Pflicht" });
  const { outcome, mergedFacts } = store.answerConsult(call.id, {
    eventId,
    facts: validated.value.key_facts,
    nowMs: Date.now(),
    openMs: CONSULT_OPEN_MS,
  });
  audit(
    "consult_answered",
    req,
    `call=${call.id} event=${eventId} ergebnis=${outcome} fakten=${mergedFacts}`,
  );
  if (outcome !== CONSULT_ANSWER.ACCEPTED) return res.status(409).json({ error: outcome });
  return res.json({ accepted: true, merged_facts: mergedFacts });
}

function resolveCallPrivacyFlags({ store, config, ctx }) {
  const ownNumber = store.tenantPrivateNumber(ctx.tenantId);
  const diagnostic = diagnosticRetentionGranted({
    requested: ctx.b.diagnostic,
    to: ctx.to,
    ownNumber,
    privacy: config.privacy,
  });
  const calleeIsOwnerOfThisCall = ownerSelfCallGranted({
    to: ctx.to,
    ownNumber,
    tenantId: ctx.tenantId,
    enabled: config.voice.ownerSelfCallEnabled,
    allowedTenantIds: config.voice.ownerSelfCallTenantIds,
  });
  return { diagnostic, calleeIsOwnerOfThisCall };
}

function denialDimensions({ store, grund, tenantId }) {
  const { country, defaultLanguage } = store.tenantGeo(tenantId);
  return { grund, country, language: defaultLanguage };
}

function beobachteAblehnung({ store, audit, denial, req, tenantId }) {
  if (!denial.audit) return;
  try {
    audit(denial.audit.event, req, denial.audit.detail);
    metrics.logCallDenied(denialDimensions({ store, grund: denial.audit.grund, tenantId }));
  } catch (fehler) {
    console.error("[place_call] Ablehnung nicht protokollierbar:", fehler?.message);
  }
}

function denialResponseBody(denial) {
  return denial.audit ? { ...denial.body, reason: denial.audit.grund } : denial.body;
}

const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_OK = 200;

const CLAIM_ERROR_MESSAGE =
  "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.";

function claimCallRecord({ store, ctx, felder, nowMs, callQuotaDenial }) {
  const laufender = findDuplicateOutboundCall(store.activeCallsFor(ctx.tenantId), {
    to: ctx.to,
    nowMs,
  });
  if (laufender) return { call: laufender, created: false };
  const denial = callQuotaDenial(ctx);
  if (denial) return { denial, created: false };
  return { call: store.createCall(felder), created: true };
}

function placeCallResponseBody({ call, ctx, config, deduplicated }) {
  return {
    ok: true,
    callId: call.id,
    twilioSid: call.twilioSid,
    status: "dialing",
    deduplicated,
    context_received: contextReceivedMeta(ctx.context, config),
    diagnostic: call.diagnostic,
  };
}

function antwortOhneNeuenAnruf({ claim, ctx, req, store, audit, config }) {
  if (claim.denial) {
    beobachteAblehnung({ store, audit, denial: claim.denial, req, tenantId: ctx.tenantId });
    return { status: claim.denial.status, body: denialResponseBody(claim.denial) };
  }
  const { call } = claim;
  audit("place_call_dedup", req, `to=${ctx.to} call=${call.id} tenant=${ctx.tenantId}`);
  return {
    status: HTTP_OK,
    body: placeCallResponseBody({ call, ctx, config, deduplicated: true }),
  };
}

async function gibReserveZurueckUndMelde({ store, ctx, fehler }) {
  console.error(`[place_call] Anlegen fehlgeschlagen tenant=${ctx.tenantId}:`, fehler?.message);
  try {
    await store.withStoreLock(() =>
      store.releaseOutboundReserveCents(ctx.tenantId, ctx.reserveCents),
    );
  } catch (freigabeFehler) {
    console.error("[place_call] Reserve nicht freigebbar:", freigabeFehler?.message);
  }
}

export function makeCallRoutes({
  store,
  config,
  audit,
  outboundGates,
  callQuotaDenial = callQuotaDenialNotWired,
  voiceControl,
  originateElevenLabsCall = elevenLabsCallNotWired,
  terminateAndBillCall,
  hangUpAction,
  elevenLabsHangUpAction = elevenLabsHangUpActionNotWired,
  endActiveCall,
  awaitAndPersistInboundElResult,
  billThunk,
  finishCall,
  arm: { armMaxDurationTimer, armReserveReleaseTimer },
  tenant: { requestTenant, requireTenant, tenantOwnsCall },
  consultDelivery,
  internalIdentity,
  OWNER_ID,
}) {
  const router = Router();


  function callVisibleTo(call, tenantId) {
    return Boolean(call) && tenantOwnsCall(call, tenantId);
  }

  function emitOpeningConsult({ req, call, context, tenantId }) {
    if (!consultAllowedFor(store.resolveProfile(tenantId))) return;
    const questions = Array.isArray(context?.open_questions) ? context.open_questions : [];
    if (!questions.length) return;
    store.emitConsult(call.id, questions);
    audit("consult_emitted", req, `call=${call.id} fragen=${questions.length}`);
  }

  router.post("/api/calls", internalOnly, async (req, res) => {
    const b = req.body || {};
    let to = normNum(b.to);
    const objective = b.objective || b.goal;
    if (!to || !objective) return res.status(400).json({ error: "to und objective sind Pflicht" });
    if (isTrunkZeroFormatError(to)) return res.status(400).json({ error: E164_FORMAT_ERROR });

    const requestedLanguage = b.language ? supportedLanguageOf(b.language) : null;
    if (b.language && !requestedLanguage) return res.status(400).json(unsupportedLanguageBody());
    if (requestedLanguage && !config.voice.elevenLabsOutbound.enabled)
      return res.status(400).json(languageUnavailableBody());

    const ctx = { req, to, objective, b };
    const denial = await runOutboundGates({ gates: outboundGates, ctx });
    if (denial) {
      beobachteAblehnung({ store, audit, denial, req, tenantId: ctx.tenantId });
      return res.status(denial.status).json(denialResponseBody(denial));
    }

    let call;
    try {
      const language =
        requestedLanguage ||
        store.resolveCallLanguage({ tenantId: ctx.tenantId, numberRecord: ctx.numberRecord });
      const { diagnostic, calleeIsOwnerOfThisCall } = resolveCallPrivacyFlags({
        store,
        config,
        ctx,
      });

      if (!ctx.context) {
        const briefed = await fetchPrecallBriefing({
          objective: ctx.objective,
          ownerNotes: b.briefing,
          constraints: b.constraints,
          to: ctx.to,
          tenantId: ctx.tenantId,
        });
        if (briefed) {
          ctx.context = briefed.context;
          ctx.mandate = ctx.mandate || briefed.mandate;
        }
      }

      let openingLine = null;
      if (config.voice.elevenLabsOutbound.enabled) {
        const { ownerName } = store.tenantContext(ctx.tenantId);
        const callLocale = callLocaleOf({
          store,
          config,
          call: { tenantId: ctx.tenantId, from: ctx.fromNumber, to: ctx.to, language },
          ownerName,
        });
        const opening = await fetchOpeningLine({
          objective: ctx.objective,
          tenantId: ctx.tenantId,
          locale: localeFor(callLocale.language),
        });
        openingLine = opening.line;
        console.log(`[opening-line] quelle=${opening.source} zeichen=${openingLine.length}`);
      }

      const felder = {
        direction: "outbound",
        from: ctx.fromNumber,
        to: ctx.to,
        goal: ctx.objective,
        openingLine,
        briefing: b.briefing,
        constraints: b.constraints,
        context: ctx.context,
        mandate: ctx.mandate,
        language,
        maxDurationS: ctx.maxDur,
        requestedBy: ctx.requestedBy,
        tenantId: ctx.tenantId,
        provider: ctx.outboundProvider,
        reserveCents: ctx.reserveCents,
        diagnostic,
        calleeIsOwner: calleeIsOwnerOfThisCall,
      };
      const claim = await store.withStoreLock(() =>
        claimCallRecord({ store, ctx, felder, nowMs: Date.now(), callQuotaDenial }),
      );
      call = claim.call;
      if (!claim.created) {
        await store.withStoreLock(() =>
          store.releaseOutboundReserveCents(ctx.tenantId, ctx.reserveCents),
        );
        const antwort = antwortOhneNeuenAnruf({ claim, ctx, req, store, audit, config });
        return res.status(antwort.status).json(antwort.body);
      }
      audit(
        "place_call",
        req,
        `to=${ctx.to} call=${call.id} provider=${ctx.outboundProvider} requestedBy=${ctx.requestedBy}`,
      );
    } catch (fehler) {
      await gibReserveZurueckUndMelde({ store, ctx, fehler });
      return res.status(HTTP_SERVICE_UNAVAILABLE).json({ error: CLAIM_ERROR_MESSAGE });
    }

    emitOpeningConsult({ req, call, context: ctx.context, tenantId: ctx.tenantId });

    try {
      if (config.voice.elevenLabsOutbound.enabled) {
        store.recordCostProfile(call.id, KOSTENPROFIL.EL_CONVAI_SIP);
        await originateElevenLabsCall(call);
        armMaxDurationTimer(call, null);
      } else {
        store.recordCostProfile(call.id, KOSTENPROFIL.TELNYX_BUDGET);
        const tw = await voiceControl(ctx.outboundProvider).originateCall({
          from: ctx.fromNumber,
          to: ctx.to,
          url: `${config.server.publicUrl}/voice/outbound?callId=${call.id}`,
          statusCallback: `${config.server.publicUrl}/voice/status?callId=${call.id}`,
          statusCallbackEvent: ["answered", "completed"],
          method: "POST",
          timeLimit: ctx.maxDur,
        });
        call.twilioSid = tw.sid;
        store.save();
        armMaxDurationTimer(call, tw.sid);
      }
      armReserveReleaseTimer(call);
      res.json(placeCallResponseBody({ call, ctx, config, deduplicated: false }));
    } catch (err) {
      const providerStatus = providerStatusOf(err);
      await terminateAndBillCall({
        persistEnd: endFailedCallWithReason(store, call.id, providerStatus),
        hangUp: null,
        bill: billThunk(finishCall, store, call.id),
        callId: call.id,
      });
      console.error(
        `[place_call] originate fehlgeschlagen call=${call.id}:`,
        err?.message || String(err),
      );
      const body = providerStatus
        ? {
            error: `Provider hat den Anruf abgelehnt (HTTP ${providerStatus}). Account-/Nummern-Konfiguration pruefen.`,
          }
        : { error: "Anruf konnte nicht gestartet werden." };
      res.status(providerStatus ? 502 : 500).json(body);
    }
  });

  router.get("/api/calls/:id/consult", internalOnly, async (req, res) => {
    const call = store.getCall(req.params.id);
    const tenantId = requestTenant(req);
    if (!callVisibleTo(call, tenantId)) return res.status(404).json({ error: "not found" });
    if (!consultAllowedFor(store.resolveProfile(tenantId)))
      return res.status(404).json({ error: "not found" });
    store.noteConsultPoll(call.id);
    const event = await consultDelivery.waitForEvent({
      callId: call.id,
      tenantId: call.tenantId,
      afterEventId: typeof req.query.after === "string" ? req.query.after : null,
      signal: null,
    });
    if (event.event === CONSULT_EVENT.CONSULT && event.eventId)
      store.markConsultAskDelivered(call.id, event.eventId);
    res.json(event);
  });

  router.post("/api/calls/:id/consult/answer", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const call = store.getCall(req.params.id);
    if (!callVisibleTo(call, tenantId)) return res.status(404).json({ error: "not found" });
    if (!consultAllowedFor(store.resolveProfile(tenantId)))
      return res
        .status(403)
        .json({ error: "Consult-Kanal ist fuer diesen Tenant nicht freigegeben." });
    const { event_id: eventId, answers, status } = req.body || {};
    if (!isConsultEventId(eventId))
      return res.status(400).json({ error: "event_id ist ungueltig" });
    const statusError = invalidConsultAnswerStatus(status);
    if (statusError) return res.status(400).json({ error: statusError });
    if (status === CONSULT_ANSWER_MODE.WORKING)
      return ackWorkingConsult({ store, audit, req, res, call, eventId });
    return answerConsultFinal({ store, audit, req, res, call, eventId, answers });
  });

  router.post("/api/calls/:id/cancel", internalOnly, async (req, res) => {
    const call = store.getCall(req.params.id);
    if (!callVisibleTo(call, requestTenant(req)))
      return res.status(404).json({ error: "not found" });
    if (call.status !== "active") return res.json({ status: call.status });
    audit("cancel_call", req, `call=${call.id} requestedBy=${internalIdentity(req) || OWNER_ID}`);
    const providerHangUp = hangUpAction(voiceControl, call, call.twilioSid);
    const isElevenLabsCall = !providerHangUp && config.voice.elevenLabsOutbound.enabled;
    const elHangUp = isElevenLabsCall ? elevenLabsHangUpAction(endActiveCall, call) : null;
    await terminateAndBillCall({
      persistEnd: endeSchreiberFuer({
        store, callId: call.id, status: "cancelled", politik: nachlaufPolitikFuer(call), nowMs: Date.now(),
      }),
      hangUp: hangUpForCall({ call, hangUp: providerHangUp ?? elHangUp, awaitAndPersistInboundElResult }),
      bill: billThunk(finishCall, store, call.id),
      onHangUpError: (e) => console.error("[cancel]", e.message),
      callId: call.id,
    });
    if (isElevenLabsCall)
      return res.json({
        status: "cancelled",
        line_hangup_confirmed: false,
        max_line_s: ELEVENLABS_PROVIDER_MAX_DURATION_S,
        hangup_attempted: Boolean(elHangUp),
      });
    res.json({ status: "cancelled" });
  });

  return router;
}
