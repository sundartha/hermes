import { Router } from "express";
import { normNum } from "../begriffe/rufnummern.js";
import { DEFAULT_PROVIDER } from "../begriffe/nummern-vergabe.js";
import { MAX_CALL_DURATION_CAP_S } from "../begriffe/anrufe.js";
import { emergencyBrakeSeconds } from "../call-duration.js";
import { callTariffCentsPerMin } from "../billing/metering.js";
import { say as sayD, hangup as hangupD } from "../telephony/directives.js";
import { SPEAK_OUTCOME } from "../telephony/adapters/telnyx/speak-events.js";
import { localeFor } from "../i18n/locales.js";
import { withInboundNotice } from "../i18n/inbound-notice.ts";
import { gespeicherteBegruessungFuer } from "../i18n/greeting-catalog.js";
import { callFailureReason } from "../telephony/failure-reason.js";
import { degradedSpeechFor } from "../llm.js";
import { noteLlmBillingOutage } from "../llm-billing-outage.ts";
import { agentTurn, openingText, callerHasSpoken } from "../claude.js";
import { BUDGET_AXIS, isBudgetAxis } from "../budget-gate.js";
import { zaehleAnrufAbgelehnt, zaehleAnrufGestartet } from "../utils/betriebsmessung.js";
import { remainingMaxDurationMs } from "../store/state-ops.js";
import { noSpeechEscalation } from "../no-speech-escalation.js";
import { metrics } from "../metrics.js";
import { logInboundPath, INBOUND_PATH } from "../telephony/inbound-path.js";
import { ANSWERED_BY } from "../telephony/answered-by.js";
import { persistEndWithReason } from "../telephony/call-termination.ts";
import { KOSTENPROFIL } from "../billing/kostenarten.js";
import { makeWebhookIdempotenz } from "../telephony/webhook-idempotenz.js";
import { legRunsOurTurnLoop } from "../telephony/leg-turn-loop.js";
import { BRIDGE_STATE, bridgeStateOf, inboundAbgewiesen, istOutboundElProfil } from "../elevenlabs/inbound-bridge-state.js";
import { e164Endung, inboundPfadEntscheidung } from "../elevenlabs/inbound-path-decision.js";
import { inboundElLocaleOf } from "../elevenlabs/inbound-initiation.js";
import { EL_RUECKFALL_PFAD } from "../elevenlabs/inbound-bridges.ts";
import {
  AUSGEHENDE_RUECKFALL_ENTSCHEIDUNG,
  EL_BEIN_PFAD,
  RUECKFALL_ENTSCHEIDUNG,
  elBegruessungslautUrl,
  elStilleUrl,
  elFehlersatzDirektiven,
  elUebergabeDirektiven,
  ausgehendeRueckfallEntscheidungFuer,
  msSeitBindung,
  rueckfallEntscheidungFuer,
  rueckfallQuelleFuerLog,
} from "../elevenlabs/inbound-rueckfall.js";
import { VORSPANN_PFAD } from "../elevenlabs/vorspann-ablauf.js";
import { INBOUND_EL_GRUND, vermerkeUebergabeGescheitert } from "../elevenlabs/inbound-uebergabe-gescheitert.js";
import { callerIsOwnerGranted } from "../callee-is-owner.js";
import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_OK } from "../utils/http.ts";
import { sleep } from "../utils/timer.js";
import { ANBIETER, speicherBereiche } from "../store.js";

const RUNNING_DOCUMENT_UNTOUCHED = [];

function repeatDeliveryXml(call, deps) {
  if (inboundAbgewiesen(call)) return fehlersatzOhneAufloesungXml({ call }, deps);
  const directives = legRunsOurTurnLoop(call)
    ? deps.followupTurnDirectives(call, "")
    : RUNNING_DOCUMENT_UNTOUCHED;
  return deps.render(directives, call.provider);
}

const TURN_LOG_PREFIX = "[voice/turn]";
const STATUS_LOG_PREFIX = "[voice/status]";
const STATUS_WIEDERANBINDUNG_VERSUCHE = 3;
const STATUS_WIEDERANBINDUNG_ABSTAND_MS = 500;

async function wiederanbindenMitWiederholung(callId, lifecycle) {
  let reattached;
  for (let versuch = 1; versuch <= STATUS_WIEDERANBINDUNG_VERSUCHE; versuch += 1) {
    reattached = await lifecycle.reattachActiveCall(callId);
    if (!reattached.fehlgeschlagen) return reattached;
    console.error(
      `${STATUS_LOG_PREFIX} Wiederanbindung fehlgeschlagen (callId=${callId}, versuch=${versuch}/${STATUS_WIEDERANBINDUNG_VERSUCHE})`,
    );
    await sleep(STATUS_WIEDERANBINDUNG_ABSTAND_MS);
  }
  console.error(`${STATUS_LOG_PREFIX} Statusereignis verworfen (callId=${callId})`);
  return reattached;
}

const ANGENOMMEN_STATUS = Object.freeze(["in-progress", "answered"]);
const EL_RUECKFALL_LOG_PREFIX = "[el-rueckfall]";
const EL_BEIN_LOG_PREFIX = "[el-bein]";
const EL_AUSGEHEND_LOG_PREFIX = "[el-outbound-uebergabe]";
const INBOUND_LOG_PREFIX = "[inbound]";

async function gespeicherteBegruessungDes({ call, bereiche }) {
  const ctx = await bereiche.mandant.tenantContext(call.tenantId);
  return gespeicherteBegruessungFuer({ storedGreeting: ctx.settings.greeting, language: call.language, ownerName: ctx.ownerName });
}

async function sendBudgetBegruessung({ res, call, locale }, { bereiche, sendVoiceXml, turnDirectives }) {
  const greeting = withInboundNotice(await gespeicherteBegruessungDes({ call, bereiche }), locale.inboundNotice);
  logInboundPath({ callId: call.id, path: INBOUND_PATH.BUDGET });
  await bereiche.anrufe.addTranscript(call.id, "agent", greeting);
  await sendVoiceXml(res, call, turnDirectives(call, greeting));
}

const elZugangVon = (config) => ({
  username: config.voice.elevenLabsInbound.sipUser,
  password: config.voice.elevenLabsInbound.sipPassword,
});

async function sendElDial({ res, call, did, wartetonUrl }, { config, inboundBridges, sendVoiceXml }) {
  inboundBridges.armDeadlines(call.id);
  await sendVoiceXml(
    res,
    call,
    elUebergabeDirektiven({
      call,
      did,
      zugang: elZugangVon(config),
      publicUrl: config.server.publicUrl,
      begruessungslautUrl: wartetonUrl,
    }),
  );
}

function eingehenderWartetonUrl(config) {
  return config.voice.elevenLabsInbound.begruessungslautEnabled ? elBegruessungslautUrl(config.server.publicUrl) : null;
}

async function sendElUebergabe({ res, call }, deps) {
  logInboundPath({ callId: call.id, path: INBOUND_PATH.ELEVENLABS });
  await sendElDial({ res, call, did: call.to, wartetonUrl: eingehenderWartetonUrl(deps.config) }, deps);
}

async function sendAusgehendeElUebergabe({ res, call }, deps) {
  if (call.status !== "active") return sendAuflegen({ res, call }, deps);
  deps.store.markAnswered(call.id);
  deps.store.save();
  console.log(`${EL_AUSGEHEND_LOG_PREFIX} call=${call.id}`);
  await sendElDial({ res, call, did: call.from, wartetonUrl: elStilleUrl(deps.config.server.publicUrl) }, deps);
}

async function antworteAufAusgehendeUebergabe(anfrage, deps) {
  try {
    await sendAusgehendeElUebergabe(anfrage, deps);
  } catch (err) {
    console.error(EL_AUSGEHEND_LOG_PREFIX, err.message);
    legeGescheitertAuf({ res: anfrage.res, call: anfrage.call, nowMs: Date.now() }, deps);
  }
}

const INBOUND_PFAD = Object.freeze({
  [INBOUND_PATH.BUDGET]: Object.freeze({ kostenprofil: KOSTENPROFIL.TELNYX_INBOUND_BUDGET, weg: ANBIETER.TELNYX, antworte: sendBudgetBegruessung }),
  [INBOUND_PATH.ELEVENLABS]: Object.freeze({ kostenprofil: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, weg: ANBIETER.ELEVENLABS, antworte: sendElUebergabe }),
  [INBOUND_PATH.ABGEWIESEN]: Object.freeze({ kostenprofil: KOSTENPROFIL.TELNYX_INBOUND_BUDGET, weg: ANBIETER.TELNYX, antworte: sendAbweisung }),
});
function inboundPfadFuer({ config, tenantId, numberRecord }) {
  return INBOUND_PFAD[inboundPfadEntscheidung({ config, tenantId, numberRecord })];
}

function sendKostendeckeAbweisung({ res, provider, locale, to }, { render }) {
  console.log(`${INBOUND_LOG_PREFIX} kostendecke to=${e164Endung(to)}`);
  zaehleAnrufAbgelehnt(BUDGET_AXIS.TENANT);
  const ansage = sayD(locale.budgetExhaustedHangup, locale.voiceProfile);
  res.type("text/xml").send(render([ansage, hangupD()], provider));
}

async function sendTechnischesEnde({ res, call, provider }, { directiveSynth, render }) {
  const locale = localeFor(call?.language);
  const errorDirectives = [sayD(locale.turnErrorSpeech, locale.voiceProfile), hangupD()];
  const outDirectives = call
    ? await directiveSynth.synthesizeDirectiveAudio(call, errorDirectives, res.locals.eingangMs)
    : errorDirectives;
  res.type("text/xml").send(render(outDirectives, provider));
}

async function aktiverCallFuer(callId, { store, lifecycle }) {
  const call = store.getCall(callId);
  if (call?.status === "active") return call;
  return (await lifecycle.reattachActiveCall(callId)).call;
}

function sendAuflegen({ res, call }, { render }) {
  res.type("text/xml").send(render([hangupD()], call?.provider));
}

function sendFolgeGather({ res, call }, { render, followupTurnDirectives }) {
  res.type("text/xml").send(render(followupTurnDirectives(call, ""), call.provider));
}

async function fehlersatzFuer({ call }, { store, config, bereiche }) {
  const aufloesung = inboundElLocaleOf({ store, config, call });
  const bundle = localeFor(aufloesung.language);
  return {
    text: bundle.inboundFehlersatz((await bereiche.mandant.tenantContext(call.tenantId)).ownerName),
    voiceProfile: bundle.voiceProfile,
    voiceId: aufloesung.voiceId,
  };
}

function vermerkeElGescheitert({ call, nowMs }, deps) {
  vermerkeUebergabeGescheitert({ callId: call.id, grund: INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT, nowMs }, deps);
}

function beendeElGescheitert({ call, nowMs }, deps) {
  deps.store.endCallRecord(call.id, "failed");
  vermerkeElGescheitert({ call, nowMs }, deps);
}

function legeGescheitertAuf({ res, call, nowMs }, deps) {
  beendeElGescheitert({ call, nowMs }, deps);
  sendAuflegen({ res, call }, deps);
}

async function sprecheFehlersatz({ res, call, nowMs }, deps) {
  vermerkeElGescheitert({ call, nowMs }, deps);
  await deps.sendVoiceXml(res, call, elFehlersatzDirektiven(await fehlersatzFuer({ call }, deps)));
}

async function sendAbweisung({ res, call }, deps) {
  logInboundPath({ callId: call.id, path: INBOUND_PATH.ABGEWIESEN });
  const grund = INBOUND_EL_GRUND.EL_OHNE_REGISTRIERUNG;
  vermerkeUebergabeGescheitert({ callId: call.id, grund, nowMs: Date.now() }, deps);
  console.log(`${INBOUND_LOG_PREFIX} ${INBOUND_PATH.ABGEWIESEN} grund=${grund} call=${call.id}`);
  await deps.sendVoiceXml(res, call, elFehlersatzDirektiven(await fehlersatzFuer({ call }, deps)));
}

function vermerkeNachFehlerBestEffort({ call, nowMs, weg }, deps) {
  const vermerke = weg.vermerkNachFehler[weg.entscheide({ call, nowMs })];
  if (!vermerke) return;
  try {
    vermerke({ call, nowMs }, deps);
  } catch (err) {
    console.error(EL_RUECKFALL_LOG_PREFIX, "vermerk:", err.message);
  }
}

function ownerNameBestEffort({ call }, { store }) {
  if (!call) return "";
  try {
    return store.tenantContext(call.tenantId).ownerName;
  } catch {
    return "";
  }
}

function fehlersatzOhneAufloesungXml({ call }, deps) {
  const bundle = localeFor(call?.language);
  const satz = sayD(bundle.inboundFehlersatz(ownerNameBestEffort({ call }, deps)), bundle.voiceProfile);
  return deps.render([satz, hangupD()], call?.provider ?? DEFAULT_PROVIDER);
}

function sendFehlersatzOhneAufloesung({ res, call }, deps) {
  res.type("text/xml").send(fehlersatzOhneAufloesungXml({ call }, deps));
}

const EINGEHENDER_RUECKFALL = Object.freeze({
  entscheide: rueckfallEntscheidungFuer,
  antworten: Object.freeze({
    [RUECKFALL_ENTSCHEIDUNG.AUFLEGEN]: sendAuflegen,
    [RUECKFALL_ENTSCHEIDUNG.FOLGE_GATHER]: sendFolgeGather,
    [RUECKFALL_ENTSCHEIDUNG.FEHLERSATZ]: sprecheFehlersatz,
  }),
  vermerkNachFehler: Object.freeze({ [RUECKFALL_ENTSCHEIDUNG.FEHLERSATZ]: vermerkeElGescheitert }),
  antworteNachFehler: sendFehlersatzOhneAufloesung,
});

const AUSGEHENDER_RUECKFALL = Object.freeze({
  entscheide: ausgehendeRueckfallEntscheidungFuer,
  antworten: Object.freeze({
    [AUSGEHENDE_RUECKFALL_ENTSCHEIDUNG.AUFLEGEN]: sendAuflegen,
    [AUSGEHENDE_RUECKFALL_ENTSCHEIDUNG.AUFLEGEN_GESCHEITERT]: legeGescheitertAuf,
  }),
  vermerkNachFehler: Object.freeze({ [AUSGEHENDE_RUECKFALL_ENTSCHEIDUNG.AUFLEGEN_GESCHEITERT]: beendeElGescheitert }),
  antworteNachFehler: sendAuflegen,
});

const rueckfallWegFuer = (call) => (istOutboundElProfil(call) ? AUSGEHENDER_RUECKFALL : EINGEHENDER_RUECKFALL);

async function antworteAufElRueckfall(req, res, deps) {
  let call = null;
  try {
    call = await aktiverCallFuer(req.query.callId || "", deps);
    const nowMs = Date.now();
    const weg = rueckfallWegFuer(call);
    const entscheidung = weg.entscheide({ call, nowMs });
    console.log(
      EL_RUECKFALL_LOG_PREFIX,
      JSON.stringify({
        callId: call?.id ?? null,
        quelle: rueckfallQuelleFuerLog(req.query.quelle),
        entscheidung,
        ms_seit_bindung: msSeitBindung(call, nowMs),
      }),
    );
    await weg.antworten[entscheidung]({ res, call, nowMs }, deps);
  } catch (err) {
    console.error(EL_RUECKFALL_LOG_PREFIX, err.message);
    const weg = rueckfallWegFuer(call);
    vermerkeNachFehlerBestEffort({ call, nowMs: Date.now(), weg }, deps);
    weg.antworteNachFehler({ res, call }, deps);
  }
}

function beinAngenommen({ call, status }) {
  return ANGENOMMEN_STATUS.includes(status) && call.status === "active" && bridgeStateOf(call) === BRIDGE_STATE.WARTET;
}

function vermerkeElBein(req, res, { store, inboundBridges, webhookEvents }) {
  res.sendStatus(HTTP_OK);
  const call = store.getCall(req.query.callId || "");
  if (!call) return;
  const { status } = webhookEvents(call.provider).parseLifecycleEvent(req.body);
  const angenommen = beinAngenommen({ call, status });
  console.log(EL_BEIN_LOG_PREFIX, JSON.stringify({ callId: call.id, status, angenommen }));
  if (angenommen) inboundBridges.armBindingDeadline(call.id);
}

function antworteAufVorspannEreignis(req, res, { store, config, webhookEvents, vorspannAblauf }) {
  res.sendStatus(HTTP_OK);
  const call = store.getCall(req.query.callId);
  if (!call) return;
  const ereignisse = webhookEvents(call.provider);
  const ereignis = { ...ereignisse.parseCallControlEvent(req.body), wiedergabeStatus: ereignisse.parseWiedergabeStatus(req.body) };
  void vorspannAblauf.behandle({ call, ereignis, zugang: elZugangVon(config) });
}

function ownerTonFuer({ from, tenantId }, { store, config }) {
  return callerIsOwnerGranted({
    from: normNum(from),
    ownNumber: store.tenantPrivateNumber(tenantId),
    tenantId,
    enabled: config.voice.inboundOwnerGreetingEnabled,
    allowedTenantIds: config.voice.inboundOwnerGreetingTenantIds,
  });
}

function erzeugeInboundCall({ leg, maxDurationS }, deps) {
  const call = deps.store.createCall({
    ...leg,
    maxDurationS,
    callerIsOwner: ownerTonFuer({ from: leg.from, tenantId: leg.tenantId }, deps),
  });
  zaehleAnrufGestartet("inbound");
  return call;
}

export function makeVoiceRoutes({
  store,
  config,
  audit,
  voiceRender,
  directiveSynth,
  ttsStore,
  lifecycle,
  finishCall,
  webhookEvents,
  providerFromHeaders,
  inboundSignatureVerifier,
  terminateAndBillCall,
  billThunk,
  startInboundNachlauf,
  inboundBridges,
  vorspannAblauf,
}) {
  const { render, turnDirectives, sayInCallVoice, followupTurnDirectives } = voiceRender;
  const bereiche = speicherBereiche(store);

  async function sendVoiceXml(res, call, directives) {
    const audio = await directiveSynth.synthesizeDirectiveAudio(call, directives, res.locals.eingangMs);
    res.type("text/xml").send(render(audio, call.provider));
  }

  const voiceDeps = {
    store, bereiche, config, lifecycle, webhookEvents, inboundBridges, directiveSynth,
    render, turnDirectives, followupTurnDirectives, sendVoiceXml, vorspannAblauf,
  };

  function capFarewellOutcome(call) {
    const remaining = remainingMaxDurationMs(call, Date.now(), MAX_CALL_DURATION_CAP_S);
    if (remaining >= config.safety.capFarewellLeadMs) return null;
    return { speech: localeFor(call.language).capFarewellSpeech, endCall: true };
  }

  function brakeSecondsFor(leg) {
    return emergencyBrakeSeconds({
      remainingCents: store.tenantBudgetSnapshot(leg.tenantId, config.billing).remainingCents,
      tariffCentsPerMin: callTariffCentsPerMin(leg),
    });
  }

  function budgetHangupOutcome(turn, call) {
    if (!isBudgetAxis(turn.stopReason)) return null;
    return { speech: localeFor(call.language).budgetExhaustedHangup, endCall: true };
  }

  async function noSpeechOutcome(call) {
    return noSpeechEscalation(await bereiche.anrufe.countNoSpeechTurn(call.id), localeFor(call.language));
  }

  async function sendTurnOutcome(res, call, { speech, endCall }) {
    if (!endCall) metrics.recordTurnRendered(call.id);
    const directives = endCall
      ? [sayInCallVoice(call, speech), hangupD()]
      : followupTurnDirectives(call, speech);
    await sendVoiceXml(res, call, directives);
  }

  const router = Router();

  const idempotenz = makeWebhookIdempotenz({
    store,
    keepAliveXml: (call) => repeatDeliveryXml(call, voiceDeps),
    elPasswort: () => elZugangVon(config).password,
  });

  router.get("/voice/tts/:token", async (req, res) => {
    try {
      const audio = await ttsStore.takeOnce(req.params.token);
      if (!audio) return res.status(HTTP_NOT_FOUND).end();
      res.type(audio.contentType).send(audio.bytes);
    } catch (err) {
      console.error("[voice/tts]", err.message);
      res.status(HTTP_NOT_FOUND).end();
    }
  });

  router.use("/voice", (req, res, next) => {
    if (config.safety.skipTwilioSignatureCheck) return next();
    const ok = inboundSignatureVerifier().verifyInboundSignature({
      headers: req.headers,
      rawBody: req.rawBody,
      url: config.server.publicUrl + req.originalUrl,
      params: req.body || {},
    });
    if (!ok) {
      console.warn(
        `[voice-signature] ungueltige Inbound-Signatur -> 403 (path=${req.baseUrl}${req.path} provider=${providerFromHeaders(req.headers) || "unknown"})`,
      );
      return res.status(HTTP_FORBIDDEN).send("invalid inbound signature");
    }
    next();
  });

  router.post("/voice/incoming", idempotenz.forIncoming, async (req, res) => {
    const provider = providerFromHeaders(req.headers) ?? DEFAULT_PROVIDER;
    let call;
    try {
      const to = normNum(req.body.To);
      const numberRecord = await bereiche.anrufe.numberRecordByE164(to);
      if (!numberRecord) {
        audit("inbound_unrouted", req, `to=${to || "-"}`);
        return res
          .type("text/xml")
          .send(
            render([sayD("Diese Nummer ist nicht erreichbar. Auf Wiederhören."), hangupD()], provider),
          );
      }
      const tenantId = numberRecord.tenantId;
      await store.einstellungenNachladen?.(tenantId);
      const language = await bereiche.anrufe.resolveCallLanguage({ tenantId, numberRecord });
      const locale = localeFor(language);

      if (store.budgetExceeded(tenantId, config.billing))
        return sendKostendeckeAbweisung({ res, provider, locale, to }, voiceDeps);

      const pfad = inboundPfadFuer({ config, tenantId, numberRecord });
      const inboundLeg = {
        direction: "inbound",
        from: req.body.From || "unbekannt",
        to,
        twilioSid: req.body.CallSid,
        tenantId,
        provider,
        language,
        costProfile: pfad.kostenprofil,
      };
      const maxDurationS = brakeSecondsFor(inboundLeg);
      call = erzeugeInboundCall({ leg: inboundLeg, maxDurationS }, voiceDeps);
      store.leitungsplaetze.belegenEingehend({ callId: call.id, tenantId, weg: pfad.weg, maxDauerS: maxDurationS });
      store.markAnswered(call.id);
      lifecycle.armMaxDurationTimer(call, req.body.CallSid);
      await bereiche.einstellungen.recordCostProfile(call.id, pfad.kostenprofil);
      await pfad.antworte({ res, call, locale }, voiceDeps);
    } catch (err) {
      console.error("[incoming]", err.message);
      await sendTechnischesEnde({ res, call, provider }, voiceDeps);
    }
  });

  router.post("/voice/turn", idempotenz.forTurn, async (req, res) => {
    let call = store.getCall(req.query.callId);
    if (!call || call.status !== "active") {
      const reattached = await lifecycle.reattachActiveCall(req.query.callId);
      if (reattached.call) {
        call = reattached.call;
      } else {
        if (reattached.logUnknown)
          console.warn(
            `${TURN_LOG_PREFIX} kein aktiver Call (callId=${req.query.callId || "-"} ${call ? `status=${call.status}` : "unbekannt"}) -> Hangup`,
          );
        return res.type("text/xml").send(render([hangupD()]));
      }
    }
    metrics.logTurnGap(call.id);

    const heard = webhookEvents(call.provider).parseSpeechResult(req.body);
    metrics.logSpeechResult({ callId: call.id, chars: heard.length });
    try {
      if (!heard && callerHasSpoken(call)) {
        return await sendTurnOutcome(res, call, capFarewellOutcome(call) ?? (await noSpeechOutcome(call)));
      }
      if (heard) await bereiche.anrufe.clearNoSpeechStreak(call.id);
      const modelOutcome = await agentTurn(call, heard || null);
      await sendTurnOutcome(
        res,
        call,
        capFarewellOutcome(call) ?? budgetHangupOutcome(modelOutcome, call) ?? modelOutcome,
      );
    } catch (err) {
      console.error("[turn]", err.message);
      noteLlmBillingOutage(err, { logPrefix: TURN_LOG_PREFIX, payload: { callId: call.id } });
      const locale = localeFor(call.language);
      await sendTurnOutcome(res, call, { speech: degradedSpeechFor(err, locale), endCall: true });
    }
  });

  router.post("/voice/outbound", idempotenz.forElUebergabe, async (req, res) => {
    let call = store.getCall(req.query.callId);
    if (!call) {
      const reattached = await lifecycle.reattachActiveCall(req.query.callId);
      if (reattached.call) {
        call = reattached.call;
      } else {
        if (reattached.logUnknown)
          console.warn(`[voice/outbound] unbekannter Call (callId=${req.query.callId || "-"}) -> Hangup`);
        return res.type("text/xml").send(render([hangupD()]));
      }
    }
    call.twilioSid = req.body.CallSid || call.twilioSid;
    if (istOutboundElProfil(call)) return antworteAufAusgehendeUebergabe({ res, call }, voiceDeps);
    store.markAnswered(call.id);
    store.save();

    if (
      config.telephony.machineDetection.enabled &&
      webhookEvents(call.provider).parseAnsweredBy(req.body) === ANSWERED_BY.MACHINE
    ) {
      console.log(`[voice/outbound] Anrufbeantworter erkannt (callId=${call.id}) -> Hangup`);
      return res.type("text/xml").send(render([hangupD()], call.provider));
    }

    const opening = openingText(call);
    await bereiche.anrufe.addTranscript(call.id, "agent", opening);
    await sendVoiceXml(res, call, turnDirectives(call, opening));
  });

  router.post(EL_RUECKFALL_PFAD, idempotenz.forElRueckfall, (req, res) => antworteAufElRueckfall(req, res, voiceDeps));
  router.post(EL_BEIN_PFAD, idempotenz.forElBein, (req, res) => vermerkeElBein(req, res, voiceDeps));
  router.post(VORSPANN_PFAD, idempotenz.forVorspann, (req, res) => antworteAufVorspannEreignis(req, res, voiceDeps));

  router.post("/voice/status", idempotenz.forStatus, async (req, res) => {
    res.sendStatus(HTTP_OK);
    let call = store.getCall(req.body.CallSid) || store.getCall(req.query.callId || "");
    if (!call) {
      if (!req.query.callId) return;
      const reattached = await wiederanbindenMitWiederholung(req.query.callId, lifecycle);
      if (!reattached.call) return;
      call = reattached.call;
    }
    const provider = call.provider || DEFAULT_PROVIDER;

    const speak = webhookEvents(provider).parseSpeakOutcome(req.body);
    if (speak.outcome !== SPEAK_OUTCOME.NONE) {
      if (speak.outcome === SPEAK_OUTCOME.FAILED)
        console.error(
          "[voice/speak]",
          JSON.stringify({ callId: call.id, provider, outcome: speak.outcome, reason: speak.reason }),
        );
      return;
    }

    const { status: callStatus, diagnostics } = webhookEvents(provider).parseLifecycleEvent(req.body);
    console.log(
      "[voice/status]",
      JSON.stringify({ callId: call.id, status: callStatus, provider, diagnostics }),
    );
    if (ANGENOMMEN_STATUS.includes(callStatus))
      return void store.markAnswered(call.id);
    if (!["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus)) return;
    if (bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN) return void startInboundNachlauf(call.id);
    const endeSchreiben = () => {
      if (call.status === "active")
        store.endCallRecord(call.id, callStatus === "completed" ? "completed" : "failed");
    };
    await terminateAndBillCall({
      persistEnd: persistEndWithReason({ store, callId: call.id, endCall: endeSchreiben, reason: callFailureReason({ status: callStatus, diagnostics }) }),
      hangUp: null,
      bill: billThunk(finishCall, store, call.id),
      callId: call.id,
    });
  });

  return router;
}
