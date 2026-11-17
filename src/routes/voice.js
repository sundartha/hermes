import { Router } from "express";
import { z } from "zod";
import zeitgeber from "node:timers/promises";
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
import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_OK } from "../utils/http.ts";
import { sleep } from "../utils/timer.js";
import { fehlerText } from "../utils/fehler-text.ts";
import { ANBIETER, speicherBereiche } from "../store.js";

const RUNNING_DOCUMENT_UNTOUCHED = [];

function repeatDeliveryXml(call, deps) {
  if (inboundAbgewiesen(call)) return fehlersatzOhneAufloesungXml({ call }, deps);
  return deps.render(RUNNING_DOCUMENT_UNTOUCHED, call.provider);
}

const queryText = (wert) => z.string().catch("").parse(wert);

const VOICE_KOERPER = z.object({
  To: z.string().optional().catch(undefined),
  From: z.string().min(1).catch("unbekannt"),
  CallSid: z.string().optional().catch(undefined),
});

const STATUS_LOG_PREFIX = "[voice/status]";
const STATUS_WIEDERANBINDUNG_VERSUCHE = 3;
const STATUS_WIEDERANBINDUNG_ABSTAND_MS = 500;

async function wiederanbindenMitWiederholung(callId, lifecycle) {
  let reattached = await lifecycle.reattachActiveCall(callId);
  for (let versuch = 1; versuch <= STATUS_WIEDERANBINDUNG_VERSUCHE; versuch += 1) {
    if (!reattached.fehlgeschlagen) return reattached;
    console.error(
      `${STATUS_LOG_PREFIX} Wiederanbindung fehlgeschlagen (callId=${callId}, versuch=${String(versuch)}/${String(STATUS_WIEDERANBINDUNG_VERSUCHE)})`,
    );
    await sleep(STATUS_WIEDERANBINDUNG_ABSTAND_MS);
    if (versuch < STATUS_WIEDERANBINDUNG_VERSUCHE) reattached = await lifecycle.reattachActiveCall(callId);
  }
  console.error(`${STATUS_LOG_PREFIX} Statusereignis verworfen (callId=${callId})`);
  return reattached;
}

function statusLifecycleFuer(call, lifecycle) {
  if (!call) return { reattachActiveCall: (id) => wiederanbindenMitWiederholung(id, lifecycle) };
  return {
    reattachActiveCall: (id) =>
      Promise.resolve(lifecycle.reattachActiveCall(id)).catch((err) => {
        console.error(`${STATUS_LOG_PREFIX} Wiederanbindung abgelehnt (callId=${id}): ${fehlerText(err)}`);
        throw err;
      }),
  };
}

const ANGENOMMEN_STATUS = Object.freeze(["in-progress", "answered"]);
const EL_RUECKFALL_LOG_PREFIX = "[el-rueckfall]";
const EL_BEIN_LOG_PREFIX = "[el-bein]";
const VORSPANN_LOG_PREFIX = "[vorspann]";
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

const wiederanbindungsKennung = (req, call) => queryText(req.query.callId) || call?.id;

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
    console.error(EL_RUECKFALL_LOG_PREFIX, "vermerk:", fehlerText(err));
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
    call = await aktiverCallFuer(queryText(req.query.callId), deps);
    const nowMs = Date.now();
    const weg = rueckfallWegFuer(call);
    const entscheidung = weg.entscheide({ call, nowMs });
    console.log(
      EL_RUECKFALL_LOG_PREFIX,
      JSON.stringify({
        callId: call?.id ?? null,
        quelle: rueckfallQuelleFuerLog(queryText(req.query.quelle)),
        entscheidung,
        ms_seit_bindung: msSeitBindung(call, nowMs),
      }),
    );
    await weg.antworten[entscheidung]({ res, call, nowMs }, deps);
  } catch (err) {
    console.error(EL_RUECKFALL_LOG_PREFIX, fehlerText(err));
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

async function lesenMitFehler(lesen, callId, logPrefix) {
  try {
    return { call: await lesen(callId) };
  } catch (err) {
    console.error(logPrefix, `Anruf lesen fehlgeschlagen (callId=${callId || "-"}):`, fehlerText(err));
    return { fehler: true };
  }
}

const leseCallMitFehler = (store, callId, logPrefix) => lesenMitFehler((id) => leseCall(store, id), callId, logPrefix);

const leseCallBestEffort = async (store, callId, logPrefix) => (await leseCallMitFehler(store, callId, logPrefix)).call;

const leseCallUngebundenBestEffort = async (store, callId, logPrefix) =>
  (await lesenMitFehler((id) => leseCallUngebunden(store, id), callId, logPrefix)).call;

const statusCallFinden = (req, store) => {
  const gespiegelt = store.getCall(VOICE_KOERPER.parse(req.body).CallSid);
  return gespiegelt ? { call: gespiegelt } : leseCallMitFehler(store, queryText(req.query.callId), STATUS_LOG_PREFIX);
};

async function vermerkeElBein(req, res, { store, inboundBridges, webhookEvents }) {
  res.sendStatus(HTTP_OK);
  const callId = queryText(req.query.callId);
  const gespiegelt = store.getCall(callId);
  const call = gespiegelt ?? (await leseCallUngebundenBestEffort(store, callId, EL_BEIN_LOG_PREFIX));
  if (!call) return;
  const { status } = webhookEvents(call.provider).parseLifecycleEvent(req.body);
  const angenommen = beinAngenommen({ call, status });
  console.log(EL_BEIN_LOG_PREFIX, JSON.stringify({ callId: call.id, status, angenommen }));
  if (angenommen && gespiegelt) inboundBridges.armBindingDeadline(call.id);
}

async function antworteAufVorspannEreignis(req, res, { store, config, webhookEvents, vorspannAblauf }) {
  res.sendStatus(HTTP_OK);
  const call = await leseCallBestEffort(store, queryText(req.query.callId), VORSPANN_LOG_PREFIX);
  if (!call) return;
  const ereignisse = webhookEvents(call.provider);
  const ereignis = { ...ereignisse.parseCallControlEvent(req.body), wiedergabeStatus: ereignisse.parseWiedergabeStatus(req.body) };
  await vorspannAblauf.behandle({ call, ereignis, zugang: elZugangVon(config) });
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
    jetzt: () => Date.now(),
    pause: (ms) => zeitgeber.setTimeout(ms),
  });

  router.get("/voice/tts/:token", async (req, res) => {
    try {
      const audio = await ttsStore.takeOnce(req.params.token);
      if (!audio) {
        res.status(HTTP_NOT_FOUND).end();
        return;
      }
      res.type(audio.contentType).send(audio.bytes);
    } catch (err) {
      console.error("[voice/tts]", fehlerText(err));
      res.status(HTTP_NOT_FOUND).end();
    }
  });

  router.use("/voice", (req, res, next) => {
    if (config.safety.skipTwilioSignatureCheck) {
      next();
      return;
    }
    const ok = inboundSignatureVerifier().verifyInboundSignature({
      headers: req.headers,
      rawBody: req.rawBody,
      url: config.server.publicUrl + req.originalUrl,
      params: req.body ?? {},
    });
    if (!ok) {
      console.warn(
        `[voice-signature] ungueltige Inbound-Signatur -> 403 (path=${req.baseUrl}${req.path} provider=${providerFromHeaders(req.headers) ?? "unknown"})`,
      );
      res.status(HTTP_FORBIDDEN).send("invalid inbound signature");
      return;
    }
    next();
  });

  router.post("/voice/incoming", idempotenz.forIncoming, async (req, res) => {
    const provider = providerFromHeaders(req.headers) ?? DEFAULT_PROVIDER;
    let call;
    try {
      const body = VOICE_KOERPER.parse(req.body);
      const to = normNum(body.To);
      const numberRecord = await bereiche.anrufe.numberRecordByE164(to);
      if (!numberRecord) {
        audit("inbound_unrouted", req, `to=${to || "-"}`);
        res.type("text/xml").send(render([sayD("Diese Nummer ist nicht erreichbar. Auf Wiederhören."), hangupD()], provider));
        return;
      }
      const tenantId = numberRecord.tenantId;
      await store.einstellungenNachladen?.(tenantId);
      const language = await bereiche.anrufe.resolveCallLanguage({ tenantId, numberRecord });
      const locale = localeFor(language);

      if (store.budgetExceeded(tenantId, config.billing)) {
        sendKostendeckeAbweisung({ res, provider, locale, to }, voiceDeps);
        return;
      }

      const pfad = inboundPfadFuer({ config, tenantId, numberRecord });
      const inboundLeg = {
        direction: "inbound",
        from: body.From,
        to,
        twilioSid: body.CallSid,
        tenantId,
        provider,
        language,
        costProfile: pfad.kostenprofil,
      };
      const maxDurationS = brakeSecondsFor(inboundLeg);
      const angelegt = erzeugeInboundCall({ leg: inboundLeg, maxDurationS }, voiceDeps);
      call = angelegt;
      store.leitungsplaetze.belegenEingehend({ callId: angelegt.id, tenantId, weg: pfad.weg, maxDauerS: maxDurationS });
      const abheben = Promise.resolve(store.markAnswered(angelegt.id));
      const abgehobenUm = angelegt.answeredAt;
      abheben.catch((fehler) => {
        angelegt.answeredAt = abgehobenUm;
        console.error(ABHEBEN_LOG_PREFIX, angelegt.id, fehlerText(fehler));
      });
      lifecycle.armMaxDurationTimer(angelegt, body.CallSid);
      await bereiche.einstellungen.recordCostProfile(angelegt.id, pfad.kostenprofil);
      await pfad.antworte({ res, call: angelegt, locale }, voiceDeps);
    } catch (err) {
      console.error("[incoming]", fehlerText(err));
      await sendTechnischesEnde({ res, call, provider }, voiceDeps);
    }
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
      const reattached = await wiederanbinden({ store, lifecycle: statusLifecycleFuer(call, lifecycle) }, call, callId);
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
    if (ANGENOMMEN_STATUS.includes(callStatus)) {
      await store.markAnswered(call.id);
      return;
    }
    if (!["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus)) return;
    if (bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN) {
      await startInboundNachlauf(call.id);
      return;
    }
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
