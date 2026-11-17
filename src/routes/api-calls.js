import { Router } from "express";
import { z } from "zod";
import { pruefeAbfrage, pruefeKoerper } from "../utils/eingabe-pruefen.js";
import { normNum } from "../begriffe/rufnummern.js";
import { CONSULT_ANSWER, CONSULT_ANSWER_MODE } from "../begriffe/rueckfrage.js";
import { validateAssistantContext } from "./_validation.ts";
import { consultAllowedFor } from "../consult/gate.js";
import { CONSULT_OPEN_MS } from "../consult/in-call.js";
import { CONSULT_EVENT } from "../consult/delivery.js";
import { isConsultEventId, newId } from "../store/state-ops.js";
import {
  ANBIETER,
  AUSGEHEND_JE_KUNDE,
  KEINE_DB_RESERVIERUNG,
  LEITUNGSPLATZ_ENTSCHEIDUNG,
  speicherBereiche,
} from "../store.js";
import {
  E164_FORMAT_ERROR,
  isTrunkZeroFormatError,
  leitungsplatzAblehnung,
  runOutboundGates,
} from "../telephony/outbound-gates.js";
import { startRejectionReason } from "../telephony/failure-reason.ts";
import { findDuplicateOutboundCall } from "../telephony/call-dedup.ts";
import { diagnosticRetentionGranted } from "../diagnostic-retention.ts";
import { ownerSelfCallGranted } from "../callee-is-owner.ts";
import { hangUpForCall, persistEndWithReason } from "../telephony/call-termination.ts";
import { ELEVENLABS_PROVIDER_MAX_DURATION_S, callLocaleOf, endeSchreiberFuer } from "../elevenlabs/outbound.js";
import { nachlaufPolitikFuer } from "../elevenlabs/nachlauf-politik.ts";
import { KOSTENPROFIL_FUER_WEG, OUTBOUND_WEG, meldeOutboundWeg, outboundWegFuer } from "../elevenlabs/outbound-weg.ts";
import { meldeVorspannBereit, meldeVorspannRueckfall } from "../elevenlabs/vorspann-erzeugen.js";
import { fetchOpeningLine } from "../elevenlabs/opening-line-llm.js";
import { localeFor, supportedLanguageOf } from "../i18n/locales.js";
import { fetchPrecallBriefing } from "../precall-briefing.js";
import { metrics } from "../metrics.js";
import { zaehleAnrufAbgelehnt, zaehleAnrufGestartet } from "../utils/betriebsmessung.js";
import { internalOnly } from "../wiring/internal-only.js";
import { unsupportedLanguageBody } from "./_call-request.ts";
import {
  antworteFehler,
  HTTP_BAD_GATEWAY,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_SERVER_ERROR,
  HTTP_SERVICE_UNAVAILABLE,
} from "../utils/http.ts";

function contextReceivedMeta(context, config) {
  return {
    active: config.tenancy.assistantContextEnabled,
    summary: !!context?.summary,
    key_facts_count: Array.isArray(context?.key_facts) ? context.key_facts.length : 0,
    recipient_relationship: !!context?.recipient_relationship,
    desired_outcome: !!context?.desired_outcome,
  };
}

async function anrufVonAndererInstanz(store, callId, tenantId) {
  if (!tenantId) return null;
  const { status } = await store.rueckfrageGelesen(callId, tenantId, null);
  return status === null ? null : { id: callId, tenantId };
}

const leseAnruf = (store, callId) => (store.leseCall ? store.leseCall(callId) : store.getCall(callId));

function providerStatusOf(err) {
  const status = Reflect.get(Object(err), "providerStatus");
  return typeof status === "number" || typeof status === "string" ? status : undefined;
}

const nachrichtOf = (fehler) => Reflect.get(Object(fehler), "message");

function beschreibungOf(fehler) {
  const nachricht = nachrichtOf(fehler);
  if (nachricht) return nachricht;
  return String(fehler);
}

const CONSULT_ABFRAGE = z.object({ after: z.string().nullable().catch(null) });
const ANRUF_KOERPER = z.object({}).passthrough().catch({});
const CONSULT_ANTWORT_KOERPER = z
  .object({ event_id: z.unknown(), answers: z.unknown(), status: z.unknown() })
  .catch({});

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
    "Der Anrufstart ist nicht verdrahtet (deps.elevenLabsOutbound fehlt)",
  );
}

function callQuotaDenialNotWired() {
  throw new Error(
    "callQuotaDenial ist nicht verdrahtet (deps.callQuotaDenial fehlt) - Quoten-Pruefung im Claim-Lock kann nicht laufen",
  );
}

function elevenLabsHangUpActionNotWired(_endActiveCall, call) {
  console.error(
    `[cancel] elevenLabsHangUpAction ist nicht verdrahtet (deps fehlt, call=${call.id})`,
  );
  return null;
}

function invalidConsultAnswerStatus(status) {
  if (status === undefined) return null;
  if (status === CONSULT_ANSWER_MODE.WORKING || status === CONSULT_ANSWER_MODE.FINAL) return null;
  return "status ist ungueltig";
}

async function ackWorkingConsult({ bereiche, audit, req, res, call, eventId }) {
  const { outcome } = await bereiche.rueckfrage.ackConsult(call.id, { eventId });
  audit("consult_acked", req, `call=${call.id} event=${eventId} ergebnis=${outcome}`);
  if (outcome !== CONSULT_ANSWER.ACCEPTED) return antworteFehler(res, HTTP_CONFLICT, outcome);
  return res.json({ accepted: true, merged_facts: 0 });
}

async function answerConsultFinal({ bereiche, audit, req, res, call, eventId, answers }) {
  const validated = validateAssistantContext({ key_facts: answers });
  if ("error" in validated) return res.status(HTTP_BAD_REQUEST).json({ error: validated.error });
  const fakten = validated.value?.key_facts;
  if (!Array.isArray(fakten) || !fakten.length)
    return res.status(HTTP_BAD_REQUEST).json({ error: "answers ist Pflicht" });
  const { outcome, mergedFacts } = await bereiche.rueckfrage.answerConsult(call.id, {
    eventId,
    facts: fakten,
    nowMs: Date.now(),
    openMs: CONSULT_OPEN_MS,
  });
  audit(
    "consult_answered",
    req,
    `call=${call.id} event=${eventId} ergebnis=${outcome} fakten=${String(mergedFacts)}`,
  );
  if (outcome !== CONSULT_ANSWER.ACCEPTED) return antworteFehler(res, HTTP_CONFLICT, outcome);
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
  zaehleAnrufAbgelehnt(denial.audit.grund);
  try {
    audit(denial.audit.event, req, denial.audit.detail);
    metrics.logCallDenied(denialDimensions({ store, grund: denial.audit.grund, tenantId }));
  } catch (fehler) {
    console.error("[place_call] Ablehnung nicht protokollierbar:", nachrichtOf(fehler));
  }
}

function denialResponseBody(denial) {
  return denial.audit ? { ...denial.body, reason: denial.audit.grund } : denial.body;
}

const vorWahlAbgebrochenBody = (callId) => ({
  error: "Der Anruf wurde vor dem Waehlen abgebrochen. Es wurde nicht gewaehlt.",
  callId,
});

const CLAIM_ERROR_MESSAGE =
  "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.";

const platzAnfrage = ({ ctx }) => ({
  tenantId: ctx.tenantId,
  weg: ANBIETER.ELEVENLABS,
  hoechstzahlKunde: AUSGEHEND_JE_KUNDE,
});

async function vorabAblehnung({ store, leitungsplaetze, ctx }) {
  const laeuftSchon = findDuplicateOutboundCall(await store.activeCallsForSql(ctx.tenantId), {
    to: ctx.to,
    nowMs: Date.now(),
  });
  if (laeuftSchon) return null;
  const entscheidung = await leitungsplaetze.pruefenAusgehend(platzAnfrage({ ctx }));
  if (entscheidung === LEITUNGSPLATZ_ENTSCHEIDUNG.FREI) return null;
  return { denial: leitungsplatzAblehnung({ store, ctx, entscheidung }) };
}

async function claimCallRecord({ store, leitungsplaetze, ctx, felder, nowMs, callQuotaDenial }) {
  const laufender = findDuplicateOutboundCall(await store.activeCallsForSql(ctx.tenantId), {
    to: ctx.to,
    nowMs,
  });
  if (laufender) return { call: laufender, created: false };
  const denial = await callQuotaDenial(ctx);
  if (denial) return { denial, created: false };
  const { entscheidung } = await leitungsplaetze.belegenAusgehend({
    ...platzAnfrage({ ctx }),
    callId: felder.id,
    maxDauerS: ctx.maxDur,
  });
  if (entscheidung !== LEITUNGSPLATZ_ENTSCHEIDUNG.FREI)
    return { denial: leitungsplatzAblehnung({ store, ctx, entscheidung }), created: false };
  const call = store.createCall(felder);
  await store.persistCall(call.id);
  zaehleAnrufGestartet("outbound");
  return { call, created: true };
}

function placeCallResponseBody({ call, ctx, config, deduplicated }) {
  return {
    ok: true,
    callId: call.id,
    twilioSid: call.twilioSid,
    startedAt: call.startedAt,
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
  audit("place_call_dedup", req, `to=${ctx.to} call=${call.id} tenant=${String(ctx.tenantId)}`);
  return {
    status: HTTP_OK,
    body: placeCallResponseBody({ call, ctx, config, deduplicated: true }),
  };
}

async function antwortOhneAnruf({ claim, ctx, req, res, store, budgetReservierung, audit, config }) {
  await store.withStoreLock(() => store.releaseOutboundReserveCents(ctx.tenantId, ctx.reserveCents));
  await budgetReservierung.freigeben({ callId: ctx.callId, tenantId: ctx.tenantId });
  const antwort = antwortOhneNeuenAnruf({ claim, ctx, req, store, audit, config });
  return res.status(antwort.status).json(antwort.body);
}

async function gibReserveZurueckUndMelde({ store, leitungsplaetze, budgetReservierung, callId, ctx, fehler }) {
  leitungsplaetze.freigeben(callId);
  await budgetReservierung.freigeben({ callId, tenantId: ctx.tenantId });
  console.error(`[place_call] Anlegen fehlgeschlagen tenant=${String(ctx.tenantId)}:`, nachrichtOf(fehler));
  try {
    await store.withStoreLock(() =>
      store.releaseOutboundReserveCents(ctx.tenantId, ctx.reserveCents),
    );
  } catch (freigabeFehler) {
    console.error("[place_call] Reserve nicht freigebbar:", nachrichtOf(freigabeFehler));
  }
}

function gibPlatzNachAuflegenFrei({ leitungsplaetze, callId, aufgelegt }) {
  if (aufgelegt) leitungsplaetze?.freigeben(callId);
}

export function makeCallRoutes({
  store,
  leitungsplaetze,
  budgetReservierung = KEINE_DB_RESERVIERUNG,
  config,
  audit,
  outboundGates,
  callQuotaDenial = callQuotaDenialNotWired,
  voiceControl,
  originateElevenLabsCall = elevenLabsCallNotWired,
  beschaffeAbsender = elevenLabsCallNotWired,
  erzeugeVorspann,
  vorspannAblauf,
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
  const bereiche = speicherBereiche(store);

  function sichtbarerAnruf(call, tenantId) {
    return call && tenantOwnsCall(call, tenantId) ? call : null;
  }

  async function waehleUeberTelnyx({ callId, ctx }) {
    const tw = await voiceControl(ctx.outboundProvider).originateCall({
      from: ctx.fromNumber,
      to: ctx.to,
      url: `${config.server.publicUrl}/voice/outbound?callId=${callId}`,
      statusCallback: `${config.server.publicUrl}/voice/status?callId=${callId}`,
      statusCallbackEvent: ["answered", "completed"],
      method: "POST",
      timeLimit: ctx.maxDur,
    });
    return tw.sid;
  }

  async function bereiteVorspannVor(call) {
    const vorspann = await erzeugeVorspann(call);
    if (vorspann.rueckfall) {
      meldeVorspannRueckfall({ callId: call.id, grund: vorspann.rueckfall });
      return undefined;
    }
    meldeVorspannBereit(call.id);
    return vorspann;
  }

  async function emitOpeningConsult({ req, call, context, tenantId }) {
    if (!consultAllowedFor(store.resolveProfile(tenantId))) return;
    const questions = Array.isArray(context?.open_questions) ? context.open_questions : [];
    if (!questions.length) return;
    await bereiche.rueckfrage.emitConsult(call.id, questions);
    audit("consult_emitted", req, `call=${call.id} fragen=${String(questions.length)}`);
  }

  const legeAnrufAn = async (req, res) => {
    const b = ANRUF_KOERPER.parse(pruefeKoerper(res, { schema: ANRUF_KOERPER }, req.body));
    const to = normNum(b.to);
    let objective = b.goal;
    if (b.objective) objective = b.objective;
    if (!to || !objective) return res.status(HTTP_BAD_REQUEST).json({ error: "to und objective sind Pflicht" });
    if (isTrunkZeroFormatError(to)) return res.status(HTTP_BAD_REQUEST).json({ error: E164_FORMAT_ERROR });

    const requestedLanguage = b.language ? supportedLanguageOf(b.language) : null;
    if (b.language && !requestedLanguage) return res.status(HTTP_BAD_REQUEST).json(unsupportedLanguageBody());

    const callId = newId("call");
    const ctx = { req, to, objective, b, callId };
    const denial = await runOutboundGates({ gates: outboundGates, ctx });
    if (denial) {
      beobachteAblehnung({ store, audit, denial, req, tenantId: ctx.tenantId });
      return res.status(denial.status).json(denialResponseBody(denial));
    }

    let call;
    try {
      const vorab = await vorabAblehnung({ store, leitungsplaetze, ctx });
      if (vorab) return await antwortOhneAnruf({ claim: vorab, ctx, req, res, store, budgetReservierung, audit, config });
      await store.einstellungenNachladen?.(ctx.tenantId);
      const language =
        requestedLanguage ??
        (await bereiche.anrufe.resolveCallLanguage({ tenantId: ctx.tenantId, numberRecord: ctx.numberRecord }));
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
          ctx.mandate = ctx.mandate ?? briefed.mandate;
        }
      }

      const { ownerName } = await bereiche.mandant.tenantContext(ctx.tenantId);
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
        calleeIsOwner: calleeIsOwnerOfThisCall,
      });
      const openingLine = opening.line;
      console.log(`[opening-line] quelle=${opening.source} zeichen=${String(openingLine.length)}`);

      const felder = {
        id: callId,
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
        claimCallRecord({ store, leitungsplaetze, ctx, felder, nowMs: Date.now(), callQuotaDenial }),
      );
      if (!claim.created) return await antwortOhneAnruf({ claim, ctx, req, res, store, budgetReservierung, audit, config });
      call = claim.call;
      audit(
        "place_call",
        req,
        `to=${ctx.to} call=${call.id} provider=${String(ctx.outboundProvider)} requestedBy=${String(ctx.requestedBy)}`,
      );
    } catch (fehler) {
      await gibReserveZurueckUndMelde({ store, leitungsplaetze, budgetReservierung, callId, ctx, fehler });
      return res.status(HTTP_SERVICE_UNAVAILABLE).json({ error: CLAIM_ERROR_MESSAGE });
    }

    await emitOpeningConsult({ req, call, context: ctx.context, tenantId: ctx.tenantId });

    try {
      const vorspannEin = config.voice.elevenLabsOutbound.ueberTelnyx && config.voice.elevenLabsOutbound.vorspann;
      if (vorspannEin) await beschaffeAbsender(call);
      const wahl = outboundWegFuer({ config, store, call });
      meldeOutboundWeg({ config, callId: call.id, wahl });
      await bereiche.einstellungen.recordCostProfile(call.id, KOSTENPROFIL_FUER_WEG[wahl.weg]);
      if (wahl.weg === OUTBOUND_WEG.EL_SIP_TRUNK) {
        await originateElevenLabsCall(call);
        armMaxDurationTimer(call, null);
      } else {
        const vorspannWeg = wahl.weg === OUTBOUND_WEG.TELNYX_VORSPANN;
        const vorspannBereit = vorspannWeg && (await bereiteVorspannVor(call));
        if (vorspannWeg && (await vorspannAblauf.pruefe({ call })).grund)
          return res.status(HTTP_CONFLICT).json(vorWahlAbgebrochenBody(call.id));
        if (vorspannBereit) {
          const gewaehlt = await vorspannAblauf.waehle({ call, vorspann: vorspannBereit });
          call.callControlId = gewaehlt.callControlId;
        } else call.twilioSid = await waehleUeberTelnyx({ callId: call.id, ctx });
        store.save();
        armMaxDurationTimer(call, call.twilioSid);
      }
      armReserveReleaseTimer(call);
      return res.json(placeCallResponseBody({ call, ctx, config, deduplicated: false }));
    } catch (err) {
      const providerStatus = providerStatusOf(err);
      await terminateAndBillCall({
        persistEnd: endFailedCallWithReason(store, call.id, providerStatus),
        hangUp: null,
        bill: billThunk(finishCall, store, call.id),
        callId: call.id,
      });
      console.error(`[place_call] originate fehlgeschlagen call=${call.id}:`, beschreibungOf(err));
      const body = providerStatus
        ? {
            error: `Provider hat den Anruf abgelehnt (HTTP ${String(providerStatus)}). Account-/Nummern-Konfiguration pruefen.`,
          }
        : { error: "Anruf konnte nicht gestartet werden." };
      return res.status(providerStatus ? HTTP_BAD_GATEWAY : HTTP_SERVER_ERROR).json(body);
    }
  };

  router.post("/api/calls", internalOnly, (req, res, next) => {
    legeAnrufAn(req, res).catch(next);
  });

  async function liefereConsultEreignis(req, res) {
    const tenantId = requestTenant(req);
    const call = sichtbarerAnruf(
      (await bereiche.gespraech.getCall(req.params.id)) ??
        (await anrufVonAndererInstanz(store, req.params.id, tenantId)),
      tenantId,
    );
    if (!call) return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    if (!consultAllowedFor(store.resolveProfile(tenantId)))
      return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    await bereiche.rueckfrage.noteConsultPoll(call.id);
    const event = await consultDelivery.waitForEvent({
      callId: call.id,
      tenantId: call.tenantId,
      afterEventId: CONSULT_ABFRAGE.parse(pruefeAbfrage(res, { schema: CONSULT_ABFRAGE }, req.query)).after,
      signal: null,
    });
    if (event.event === CONSULT_EVENT.CONSULT && event.eventId)
      await bereiche.rueckfrage.markConsultAskDelivered(call.id, event.eventId);
    return res.json(event);
  }

  router.get("/api/calls/:id/consult", internalOnly, (req, res, next) => {
    liefereConsultEreignis(req, res).catch(next);
  });

  async function beantworteConsult(req, res) {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return undefined;
    const call = sichtbarerAnruf(store.getCall(req.params.id), tenantId);
    if (!call) return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    if (!consultAllowedFor(store.resolveProfile(tenantId)))
      return res
        .status(HTTP_FORBIDDEN)
        .json({ error: "Consult-Kanal ist fuer diesen Tenant nicht freigegeben." });
    const { event_id: eventId, answers, status } = CONSULT_ANTWORT_KOERPER.parse(
      pruefeKoerper(res, { schema: CONSULT_ANTWORT_KOERPER }, req.body),
    );
    if (!isConsultEventId(eventId))
      return antworteFehler(res, HTTP_BAD_REQUEST, "event_id ist ungueltig");
    const statusError = invalidConsultAnswerStatus(status);
    if (statusError) return antworteFehler(res, HTTP_BAD_REQUEST, statusError);
    const antwort =
      status === CONSULT_ANSWER_MODE.WORKING
        ? ackWorkingConsult({ bereiche, audit, req, res, call, eventId })
        : answerConsultFinal({ bereiche, audit, req, res, call, eventId, answers });
    return antwort;
  }

  router.post("/api/calls/:id/consult/answer", internalOnly, (req, res, next) => {
    beantworteConsult(req, res).catch(next);
  });

  async function brecheAnrufAb(req, res) {
    const call = sichtbarerAnruf(await leseAnruf(store, req.params.id), requestTenant(req));
    if (!call) return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    if (call.status !== "active") return res.json({ status: call.status });
    audit("cancel_call", req, `call=${call.id} requestedBy=${internalIdentity(req) ?? OWNER_ID}`);
    const providerHangUp = hangUpAction(voiceControl, call, call.twilioSid);
    const isElevenLabsCall = !providerHangUp;
    const elHangUp = isElevenLabsCall ? elevenLabsHangUpAction(endActiveCall, call) : null;
    let auflegenGescheitert = false;
    await terminateAndBillCall({
      persistEnd: endeSchreiberFuer({
        store, callId: call.id, status: "cancelled", politik: nachlaufPolitikFuer(call), nowMs: Date.now(),
      }),
      hangUp: hangUpForCall({ call, hangUp: providerHangUp ?? elHangUp, awaitAndPersistInboundElResult }),
      bill: billThunk(finishCall, store, call.id),
      onHangUpError: (e) => {
        auflegenGescheitert = true;
        console.error("[cancel]", nachrichtOf(e));
      },
      callId: call.id,
    });
    gibPlatzNachAuflegenFrei({ leitungsplaetze, callId: call.id, aufgelegt: Boolean(providerHangUp) && !auflegenGescheitert });
    if (isElevenLabsCall)
      return res.json({
        status: "cancelled",
        line_hangup_confirmed: false,
        max_line_s: ELEVENLABS_PROVIDER_MAX_DURATION_S,
        hangup_attempted: Boolean(elHangUp),
      });
    return res.json({ status: "cancelled" });
  }

  router.post("/api/calls/:id/cancel", internalOnly, (req, res, next) => {
    brecheAnrufAb(req, res).catch(next);
  });

  return router;
}
