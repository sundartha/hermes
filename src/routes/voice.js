import { Router } from "express";
import { normNum } from "../begriffe/rufnummern.js";
import { DEFAULT_PROVIDER } from "../begriffe/nummern-vergabe.js";
import { emergencyBrakeSeconds } from "../call-duration.ts";
import { callTariffCentsPerMin } from "../billing/metering.js";
import { say as sayD, hangup as hangupD } from "../telephony/directives.ts";
import { SPEAK_OUTCOME } from "../telephony/adapters/telnyx/speak-events.ts";
import { localeFor } from "../i18n/locales.js";
import { callFailureReason } from "../telephony/failure-reason.ts";
import { BUDGET_AXIS } from "../budget-gate.js";
import { zaehleAnrufAbgelehnt, zaehleAnrufGestartet } from "../utils/betriebsmessung.js";
import { logInboundPath, INBOUND_PATH } from "../telephony/inbound-path.ts";
import { persistEndWithReason } from "../telephony/call-termination.ts";
import { KOSTENPROFIL } from "../billing/kostenarten.js";
import { makeWebhookIdempotenz } from "../telephony/webhook-idempotenz.ts";
import { BRIDGE_STATE, bridgeStateOf, inboundAbgewiesen, istOutboundElProfil } from "../elevenlabs/inbound-bridge-state.ts";
import { e164Endung, inboundPfadEntscheidung } from "../elevenlabs/inbound-path-decision.ts";
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
} from "../elevenlabs/inbound-rueckfall.ts";
import { VORSPANN_PFAD } from "../elevenlabs/vorspann-ablauf.js";
import { INBOUND_EL_GRUND, vermerkeUebergabeGescheitert } from "../elevenlabs/inbound-uebergabe-gescheitert.ts";
import { callerIsOwnerGranted } from "../callee-is-owner.ts";
import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVER_ERROR } from "../utils/http.ts";
import { sleep } from "../utils/timer.js";
import { ANBIETER, speicherBereiche } from "../store.js";

const RUNNING_DOCUMENT_UNTOUCHED = [];

function repeatDeliveryXml(call, deps) {
  if (inboundAbgewiesen(call)) return fehlersatzOhneAufloesungXml({ call }, deps);
  return deps.render(RUNNING_DOCUMENT_UNTOUCHED, call.provider);
}

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
const VORSPANN_LOG_PREFIX = "[vorspann]";
const OUTBOUND_LOG_PREFIX = "[voice/outbound]";
const EL_AUSGEHEND_LOG_PREFIX = "[el-outbound-uebergabe]";
const INBOUND_LOG_PREFIX = "[inbound]";
const ABHEBEN_LOG_PREFIX = "[voice] abheben schreiben fehlgeschlagen";

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
  await deps.store.markAnswered(call.id);
  deps.store.save();
  console.log(`${EL_AUSGEHEND_LOG_PREFIX} call=${call.id}`);
  await sendElDial({ res, call, did: call.from, wartetonUrl: elStilleUrl(deps.config.server.publicUrl) }, deps);
}

async function antworteAufAusgehendeUebergabe(anfrage, deps) {
  try {
    await sendAusgehendeElUebergabe(anfrage, deps);
  } catch (err) {
    console.error(EL_AUSGEHEND_LOG_PREFIX, err.message);
    await legeGescheitertAuf({ res: anfrage.res, call: anfrage.call, nowMs: Date.now() }, deps);
  }
}

const INBOUND_PFAD = Object.freeze({
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

const hierBewacht = (store, call) => call?.status === "active" && store.anrufHierBewacht(call.id);

const brauchtWiederanbindung = (store, call) => !call || (call.status === "active" && !hierBewacht(store, call));

const wiederanbindungsKennung = (req, call) => req.query.callId || call?.id;

async function wiederanbinden({ store, lifecycle }, call, callId) {
  if (hierBewacht(store, call)) return { call };
  if (call?.status === "active") {
    Promise.resolve(lifecycle.reattachActiveCall(callId)).catch(() => undefined);
    return { call };
  }
  return lifecycle.reattachActiveCall(callId);
}

async function aktiverCallFuer(callId, deps) {
  const call = deps.store.getCall(callId);
  return (await wiederanbinden(deps, call, callId)).call;
}

function sendAuflegen({ res, call }, { render }) {
  res.type("text/xml").send(render([hangupD()], call?.provider));
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

async function beendeElGescheitert({ call, nowMs }, deps) {
  await deps.store.endCallRecord(call.id, "failed");
  vermerkeElGescheitert({ call, nowMs }, deps);
}

async function legeGescheitertAuf({ res, call, nowMs }, deps) {
  await beendeElGescheitert({ call, nowMs }, deps);
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

async function vermerkeNachFehlerBestEffort({ call, nowMs, weg }, deps) {
  const vermerke = weg.vermerkNachFehler[weg.entscheide({ call, nowMs })];
  if (!vermerke) return;
  try {
    await vermerke({ call, nowMs }, deps);
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
    await vermerkeNachFehlerBestEffort({ call, nowMs: Date.now(), weg }, deps);
    weg.antworteNachFehler({ res, call }, deps);
  }
}

function beinAngenommen({ call, status }) {
  return ANGENOMMEN_STATUS.includes(status) && call.status === "active" && bridgeStateOf(call) === BRIDGE_STATE.WARTET;
}

const leseCall = (store, callId) => (store.leseCall ? store.leseCall(callId) : store.getCall(callId));
const leseCallUngebunden = (store, callId) =>
  store.leseCallUngebunden ? store.leseCallUngebunden(callId) : store.getCall(callId);

async function leseCallMitFehler(store, callId, logPrefix, leser = leseCall) {
  try {
    return { call: await leser(store, callId) };
  } catch (err) {
    console.error(logPrefix, `Anruf lesen fehlgeschlagen (callId=${callId || "-"}):`, err.message);
    return { fehler: true };
  }
}

const leseCallBestEffort = async (store, callId, logPrefix, leser) =>
  (await leseCallMitFehler(store, callId, logPrefix, leser)).call;

const statusCallFinden = (req, store) => {
  const gespiegelt = store.getCall(req.body.CallSid);
  return gespiegelt ? { call: gespiegelt } : leseCallMitFehler(store, req.query.callId || "", STATUS_LOG_PREFIX);
};

async function vermerkeElBein(req, res, { store, inboundBridges, webhookEvents }) {
  res.sendStatus(HTTP_OK);
  const callId = req.query.callId || "";
  const gespiegelt = store.getCall(callId);
  const call = gespiegelt || (await leseCallBestEffort(store, callId, EL_BEIN_LOG_PREFIX, leseCallUngebunden));
  if (!call) return;
  const { status } = webhookEvents(call.provider).parseLifecycleEvent(req.body);
  const angenommen = beinAngenommen({ call, status });
  console.log(EL_BEIN_LOG_PREFIX, JSON.stringify({ callId: call.id, status, angenommen }));
  if (angenommen && gespiegelt) inboundBridges.armBindingDeadline(call.id);
}

async function antworteAufVorspannEreignis(req, res, { store, config, webhookEvents, vorspannAblauf }) {
  res.sendStatus(HTTP_OK);
  const call = await leseCallBestEffort(store, req.query.callId || "", VORSPANN_LOG_PREFIX);
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
  const { render } = voiceRender;
  const bereiche = speicherBereiche(store);

  async function sendVoiceXml(res, call, directives) {
    const audio = await directiveSynth.synthesizeDirectiveAudio(call, directives, res.locals.eingangMs);
    res.type("text/xml").send(render(audio, call.provider));
  }

  const voiceDeps = {
    store, bereiche, config, lifecycle, webhookEvents, inboundBridges, directiveSynth,
    render, sendVoiceXml, vorspannAblauf,
  };

  function brakeSecondsFor(leg) {
    return emergencyBrakeSeconds({
      remainingCents: store.tenantBudgetSnapshot(leg.tenantId, config.billing).remainingCents,
      tariffCentsPerMin: callTariffCentsPerMin(leg),
    });
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
      const abheben = Promise.resolve(store.markAnswered(call.id));
      const abgehobenUm = call.answeredAt;
      abheben.catch((fehler) => {
        call.answeredAt = abgehobenUm;
        console.error(ABHEBEN_LOG_PREFIX, call.id, fehler?.message ?? fehler);
      });
      lifecycle.armMaxDurationTimer(call, req.body.CallSid);
      await bereiche.einstellungen.recordCostProfile(call.id, pfad.kostenprofil);
      await pfad.antworte({ res, call, locale }, voiceDeps);
    } catch (err) {
      console.error("[incoming]", err.message);
      await sendTechnischesEnde({ res, call, provider }, voiceDeps);
    }
  });

  router.post("/voice/outbound", idempotenz.forElUebergabe, async (req, res) => {
    const gelesen = await leseCallMitFehler(store, req.query.callId || "", OUTBOUND_LOG_PREFIX);
    if (gelesen.fehler) return res.sendStatus(HTTP_SERVER_ERROR);
    let call = gelesen.call;
    if (brauchtWiederanbindung(store, call)) {
      const reattached = await wiederanbinden({ store, lifecycle }, call, req.query.callId);
      if (reattached.call) {
        call = reattached.call;
      } else {
        if (reattached.fehlgeschlagen) return res.sendStatus(HTTP_SERVER_ERROR);
        if (reattached.logUnknown)
          console.warn(`[voice/outbound] unbekannter Call (callId=${req.query.callId || "-"}) -> Hangup`);
        return res.type("text/xml").send(render([hangupD()]));
      }
    }
    call.twilioSid = req.body.CallSid || call.twilioSid;
    if (istOutboundElProfil(call)) return antworteAufAusgehendeUebergabe({ res, call }, voiceDeps);
    await store.markAnswered(call.id);
    store.save();
    sendAuflegen({ res, call }, voiceDeps);
  });

  router.post(EL_RUECKFALL_PFAD, idempotenz.forElRueckfall, (req, res) => antworteAufElRueckfall(req, res, voiceDeps));
  router.post(EL_BEIN_PFAD, idempotenz.forElBein, (req, res) => vermerkeElBein(req, res, voiceDeps));
  router.post(VORSPANN_PFAD, idempotenz.forVorspann, (req, res) => antworteAufVorspannEreignis(req, res, voiceDeps));

  router.post("/voice/status", idempotenz.forStatus, async (req, res) => {
    res.sendStatus(HTTP_OK);
    let call = (await statusCallFinden(req, store)).call;
    const callId = wiederanbindungsKennung(req, call);
    if (brauchtWiederanbindung(store, call)) {
      if (!callId) return;
      const mitWiederholung = { reattachActiveCall: (id) => wiederanbindenMitWiederholung(id, lifecycle) };
      const reattached = await wiederanbinden({ store, lifecycle: mitWiederholung }, call, callId);
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
      return void (await store.markAnswered(call.id));
    if (!["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus)) return;
    if (bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN) return void startInboundNachlauf(call.id);
    const endeSchreiben = async () => {
      if (call.status === "active")
        await store.endCallRecord(call.id, callStatus === "completed" ? "completed" : "failed");
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
