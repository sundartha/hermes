import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import zeitgeber from "node:timers/promises";
import { STARTSPRACHE } from "../konfiguration/standardsprache.ts";
import { normNum } from "../begriffe/rufnummern.js";
import { DEFAULT_PROVIDER } from "../begriffe/nummern-vergabe.js";
import { emergencyBrakeSeconds } from "../call-duration.ts";
import { callTariffCentsPerMin } from "../billing/metering.js";
import { say as sayD, hangup as hangupD } from "../telephony/directives.ts";
import type { VoiceProfile } from "../telephony/directives.ts";
import { SPEAK_OUTCOME } from "../telephony/adapters/telnyx/speak-events.ts";
import { localeFor } from "../i18n/locales.ts";
import { callFailureReason } from "../telephony/failure-reason.ts";
import { BUDGET_AXIS } from "../budget-gate.js";
import { zaehleAnrufAbgelehnt, zaehleAnrufGestartet } from "../utils/betriebsmessung.js";
import { logInboundPath, INBOUND_PATH } from "../telephony/inbound-path.ts";
import { persistEndWithReason } from "../telephony/call-termination.ts";
import type { billThunk, terminateAndBillCall } from "../telephony/call-termination.ts";
import { KOSTENPROFIL } from "../billing/kostenarten.ts";
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
import { CALL_CONTROL_EREIGNIS } from "../telephony/call-control-ereignis.ts";
import { VORSPANN_PFAD } from "../elevenlabs/vorspann-ablauf.js";
import { INBOUND_EL_GRUND, vermerkeUebergabeGescheitert } from "../elevenlabs/inbound-uebergabe-gescheitert.ts";
import { callerIsOwnerGranted } from "../callee-is-owner.ts";
import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVICE_UNAVAILABLE } from "../utils/http.ts";
import { sleep } from "../utils/uhr-warten.ts";
import { pruefeAbfrage, pruefeKoerper } from "../utils/eingabe-pruefen.js";
import { zaehleAbgewiesenenWebhook } from "../utils/webhook-abweisungen.js";
import { fehlerText } from "../utils/fehler-text.ts";
import { ANBIETER, speicherBereiche } from "../store.js";

type Gesetzt<T> = { [Schluessel in keyof T]-?: NonNullable<T[Schluessel]> };
type InboundKonfiguration = Parameters<typeof inboundPfadEntscheidung>[0]["config"]["voice"]["elevenLabsInbound"];
type Diagnose = NonNullable<Parameters<typeof callFailureReason>[0]>["diagnostics"];

interface Anruf {
  id: string;
  tenantId: string;
  to: string;
  provider: string;
  status?: string;
  language?: string;
  answeredAt?: string | undefined;
  elBoundAt?: string;
  maxDurationS?: number;
  costProfile?: unknown;
  elFallbackAt?: unknown;
  elevenlabsConversationId?: string | null;
  streamToken?: string;
}

type AnrufOderLeer = Anruf | null | undefined;
type AnrufTeil = Partial<Anruf>;

interface Wiederanbindung {
  call?: AnrufOderLeer;
  fehlgeschlagen?: boolean;
}

interface Lebenszyklus {
  reattachActiveCall: (callId: string) => Promise<Wiederanbindung>;
  armMaxDurationTimer: (call: Anruf, sid: string | undefined) => unknown;
}

interface Konfiguration {
  billing: unknown;
  safety: { skipTwilioSignatureCheck: boolean };
  server: { publicUrl: string };
  voice: {
    inboundOwnerGreetingEnabled: unknown;
    inboundOwnerGreetingTenantIds: unknown;
    elevenLabsInbound: InboundKonfiguration & Gesetzt<InboundKonfiguration> & { begruessungslautEnabled: boolean };
  };
}

type NummernBeleg = NonNullable<Parameters<typeof inboundPfadEntscheidung>[0]["numberRecord"]> & { tenantId: string };

interface Speicher {
  getCall: (callId: unknown) => AnrufOderLeer;
  leseCall?: (callId: string) => Promise<AnrufOderLeer>;
  leseCallUngebunden?: (callId: string) => Promise<AnrufOderLeer>;
  anrufHierBewacht: (callId: string) => boolean;
  tenantContext: (tenantId: string | undefined) => { ownerName: unknown };
  tenantPrivateNumber: (tenantId: string) => unknown;
  tenantBudgetSnapshot: (tenantId: string, billing: unknown) => { remainingCents: number };
  budgetExceeded: (tenantId: string, billing: unknown) => boolean;
  einstellungenNachladen?: (tenantId: string) => Promise<unknown>;
  createCall: (felder: object) => Anruf;
  markAnswered: (callId: string) => unknown;
  endCallRecord: (callId: string, status: string) => unknown;
  recordFailureReason: (callId: string, grund: string | null) => unknown;
  markInboundElFallback: (callId: string, zeitpunkt: string) => unknown;
  recordWebhookAnchors: (callId: unknown, anchors: string[]) => unknown;
  leitungsplaetze: {
    belegenEingehend: (anfrage: { callId: string; tenantId: string; weg: string; maxDauerS: number }) => unknown;
  };
}

interface Bereiche {
  anrufe: {
    numberRecordByE164: (e164: string) => Promise<NummernBeleg | null | undefined>;
  };
  mandant: { tenantContext: (tenantId: string) => Promise<{ ownerName: unknown }> };
  einstellungen: { recordCostProfile: (callId: string, profil: string) => Promise<unknown> };
}

interface Ereignisse {
  parseLifecycleEvent: (body: unknown) => { status: string; diagnostics: Diagnose };
  parseSpeakOutcome: (body: unknown) => { outcome: string; reason: unknown };
  parseCallControlEvent: (body: unknown) => { ereignis?: string };
  parseWiedergabeStatus: (body: unknown) => unknown;
}

interface Bruecken {
  armDeadlines: (callId: string) => unknown;
  armBindingDeadline: (callId: string) => unknown;
  clearDeadlines: (callId: string) => unknown;
}

interface Synthese {
  synthesizeDirectiveAudio: (call: Anruf, directives: unknown[], eingangMs: unknown) => Promise<unknown[]>;
}

interface VorspannAblauf {
  behandle: (anfrage: { call: Anruf; ereignis: object; zugang: Zugang }) => Promise<unknown>;
}

interface Zugang {
  username: string;
  password: string;
}

type Render = (directives: unknown[], provider: string | undefined) => string;
type SendeXml = (res: Antwort, call: Anruf, directives: unknown[]) => Promise<void>;
interface Aufruf {
  query: { callId?: unknown; quelle?: unknown };
  body: unknown;
  headers: Request["headers"];
}

type Protokoll = (aktion: string, req: Aufruf, detail: string) => unknown;

interface VoiceDeps {
  store: Speicher;
  bereiche: Bereiche;
  config: Konfiguration;
  lifecycle: Lebenszyklus;
  webhookEvents: (provider: string | undefined) => Ereignisse;
  inboundBridges: Bruecken;
  directiveSynth: Synthese;
  render: Render;
  sendVoiceXml: SendeXml;
  vorspannAblauf: VorspannAblauf;
}

interface Anfrage extends Request {
  rawBody?: Buffer;
}

type Antwort = Response & { locals: { eingangMs?: number } };

interface Sprachtexte {
  budgetExhaustedHangup: string;
  turnErrorSpeech: string;
  voiceProfile: VoiceProfile;
  inboundFehlersatz: (ownerName: unknown) => string;
}

const sprachtexteFuer: (language: string | undefined) => Sprachtexte = localeFor;

const minutenTarifFuer: (leg: InboundLeg) => number = callTariffCentsPerMin;

interface Vermerkfall {
  call: Anruf;
  nowMs: number;
}

interface Antwortfall extends Vermerkfall {
  res: Antwort;
}

interface InboundLeg {
  direction: string;
  from: string;
  to: string;
  twilioSid: string | undefined;
  tenantId: string;
  provider: string;
  language: string;
  costProfile: string;
}

interface InboundPfad {
  kostenprofil: string;
  weg: string;
  antworte: (fall: { res: Antwort; call: Anruf; locale: Sprachtexte }, deps: VoiceDeps) => Promise<void>;
}

interface RueckfallWeg {
  entscheide: (anfrage: { call: AnrufOderLeer; nowMs: number }) => string;
  antworten: Readonly<Record<string, (fall: Antwortfall, deps: VoiceDeps) => unknown>>;
  vermerkNachFehler: Readonly<Record<string, ((fall: Vermerkfall, deps: VoiceDeps) => unknown) | undefined>>;
  antworteNachFehler: (fall: { res: Antwort; call: AnrufOderLeer }, deps: VoiceDeps) => void;
}

const RUNNING_DOCUMENT_UNTOUCHED: unknown[] = [];

function repeatDeliveryXml(call: AnrufTeil, deps: VoiceDeps): string {
  if (inboundAbgewiesen(call)) return fehlersatzOhneAufloesungXml({ call }, deps);
  return deps.render(RUNNING_DOCUMENT_UNTOUCHED, call.provider);
}

const queryText = (wert: unknown): string => z.string().catch("").parse(wert);

const TTS_TOKEN_MAX = 128;
const TTS_TOKEN = z.string().max(TTS_TOKEN_MAX).regex(/^[A-Za-z0-9_-]+$/);
const TEXT_FELD = z.string().optional();
const VOICE_ABFRAGE = z.object({ callId: TEXT_FELD });
const ZAHL_ODER_TEXT = z.union([z.string(), z.number()]).optional();
const STATUS_FELDER = {
  CallSid: TEXT_FELD,
  CallStatus: TEXT_FELD,
  CallDuration: ZAHL_ODER_TEXT,
  HangupCause: TEXT_FELD,
  HangupSource: TEXT_FELD,
  SipHangupCause: TEXT_FELD,
};
const STATUS_KOERPER = z.object(STATUS_FELDER);
const VORSPANN_NUTZLAST = z.object({ call_control_id: TEXT_FELD, status: TEXT_FELD });
const VORSPANN_DATEN = z.object({ event_type: TEXT_FELD, payload: VORSPANN_NUTZLAST.optional() });
const VORSPANN_KOERPER = z.object({ data: VORSPANN_DATEN.optional() });

function anfrageGeprueft(req: { query: unknown; body: unknown }, res: Response, koerper?: z.ZodType): boolean {
  if (pruefeAbfrage(res, { schema: VOICE_ABFRAGE }, req.query) === undefined) return false;
  return koerper === undefined || pruefeKoerper(res, { schema: koerper }, req.body) !== undefined;
}

const VOICE_KOERPER = z.object({
  To: z.string().optional().catch(undefined),
  From: z.string().min(1).catch("unbekannt"),
  CallSid: z.string().optional().catch(undefined),
});

const STATUS_LOG_PREFIX = "[voice/status]";
const STATUS_WIEDERANBINDUNG_VERSUCHE = 3;
const STATUS_WIEDERANBINDUNG_ABSTAND_MS = 500;

async function wiederanbindenMitWiederholung(callId: string, lifecycle: Lebenszyklus): Promise<Wiederanbindung> {
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

function statusLifecycleFuer(call: AnrufOderLeer, lifecycle: Lebenszyklus): Pick<Lebenszyklus, "reattachActiveCall"> {
  if (!call) return { reattachActiveCall: (id: string) => wiederanbindenMitWiederholung(id, lifecycle) };
  return {
    reattachActiveCall: (id: string) =>
      Promise.resolve(lifecycle.reattachActiveCall(id)).catch((err: unknown) => {
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

const elZugangVon = (config: Konfiguration): Zugang => ({
  username: config.voice.elevenLabsInbound.sipUser,
  password: config.voice.elevenLabsInbound.sipPassword,
});

async function sendElDial(
  { res, call, did, wartetonUrl }: { res: Antwort; call: Anruf; did: string; wartetonUrl: string | undefined },
  { config, inboundBridges, sendVoiceXml }: VoiceDeps,
): Promise<void> {
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

function eingehenderWartetonUrl(config: Konfiguration): string | undefined {
  return config.voice.elevenLabsInbound.begruessungslautEnabled ? elBegruessungslautUrl(config.server.publicUrl) : undefined;
}

async function sendElUebergabe({ res, call }: { res: Antwort; call: Anruf }, deps: VoiceDeps): Promise<void> {
  logInboundPath({ callId: call.id, path: INBOUND_PATH.ELEVENLABS });
  await sendElDial({ res, call, did: call.to, wartetonUrl: eingehenderWartetonUrl(deps.config) }, deps);
}

const INBOUND_PFAD: Readonly<Record<string, InboundPfad>> = Object.freeze({
  [INBOUND_PATH.ELEVENLABS]: Object.freeze({ kostenprofil: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, weg: ANBIETER.ELEVENLABS, antworte: sendElUebergabe }),
  [INBOUND_PATH.ABGEWIESEN]: Object.freeze({ kostenprofil: KOSTENPROFIL.TELNYX_INBOUND_BUDGET, weg: ANBIETER.TELNYX, antworte: sendAbweisung }),
});
function inboundPfadFuer({ config, tenantId, numberRecord }: { config: Konfiguration; tenantId: string; numberRecord: NummernBeleg }): InboundPfad {
  const pfad = INBOUND_PFAD[inboundPfadEntscheidung({ config, tenantId, numberRecord })];
  if (!pfad) throw new Error("unbekannter Eingangspfad");
  return pfad;
}

function sendKostendeckeAbweisung(
  { res, provider, locale, to }: { res: Antwort; provider: string; locale: Sprachtexte; to: string },
  { render }: VoiceDeps,
): void {
  console.log(`${INBOUND_LOG_PREFIX} kostendecke to=${e164Endung(to)}`);
  zaehleAnrufAbgelehnt(BUDGET_AXIS.TENANT);
  const ansage = sayD(locale.budgetExhaustedHangup, locale.voiceProfile);
  res.type("text/xml").send(render([ansage, hangupD()], provider));
}

async function sendTechnischesEnde(
  { res, call, provider }: { res: Antwort; call: AnrufOderLeer; provider: string },
  { directiveSynth, render }: VoiceDeps,
): Promise<void> {
  const locale = sprachtexteFuer(call?.language);
  const errorDirectives = [sayD(locale.turnErrorSpeech, locale.voiceProfile), hangupD()];
  const outDirectives = call
    ? await directiveSynth.synthesizeDirectiveAudio(call, errorDirectives, res.locals.eingangMs)
    : errorDirectives;
  res.type("text/xml").send(render(outDirectives, provider));
}

const hierBewacht = (store: Speicher, call: AnrufOderLeer): boolean => call?.status === "active" && store.anrufHierBewacht(call.id);

const brauchtWiederanbindung = (store: Speicher, call: Anruf): boolean => call.status === "active" && !hierBewacht(store, call);

const wiederanbindungsKennung = (req: Aufruf, call: AnrufOderLeer): string | undefined => queryText(req.query.callId) || call?.id;

async function wiederanbinden(
  { store, lifecycle }: { store: Speicher; lifecycle: Pick<Lebenszyklus, "reattachActiveCall"> },
  call: AnrufOderLeer,
  callId: string,
): Promise<Wiederanbindung> {
  if (hierBewacht(store, call)) return { call };
  if (call?.status === "active") {
    Promise.resolve(lifecycle.reattachActiveCall(callId)).catch(() => undefined);
    return { call };
  }
  return lifecycle.reattachActiveCall(callId);
}

async function aktiverCallFuer(callId: string, deps: VoiceDeps): Promise<AnrufOderLeer> {
  const call = deps.store.getCall(callId);
  return (await wiederanbinden(deps, call, callId)).call;
}

function sendAuflegen({ res, call }: { res: Antwort; call: AnrufOderLeer }, { render }: VoiceDeps): void {
  res.type("text/xml").send(render([hangupD()], call?.provider));
}

async function fehlersatzFuer({ call }: { call: Anruf }, { store, config, bereiche }: VoiceDeps) {
  const aufloesung = inboundElLocaleOf({ store, config, call });
  const bundle = sprachtexteFuer(aufloesung.language);
  return {
    text: bundle.inboundFehlersatz((await bereiche.mandant.tenantContext(call.tenantId)).ownerName),
    voiceProfile: bundle.voiceProfile,
    voiceId: aufloesung.voiceId,
  };
}

function vermerkeElGescheitert({ call, nowMs }: Vermerkfall, deps: VoiceDeps): void {
  vermerkeUebergabeGescheitert({ callId: call.id, grund: INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT, nowMs }, deps);
}

async function beendeElGescheitert({ call, nowMs }: Vermerkfall, deps: VoiceDeps): Promise<void> {
  await deps.store.endCallRecord(call.id, "failed");
  vermerkeElGescheitert({ call, nowMs }, deps);
}

async function legeGescheitertAuf({ res, call, nowMs }: Antwortfall, deps: VoiceDeps): Promise<void> {
  await beendeElGescheitert({ call, nowMs }, deps);
  sendAuflegen({ res, call }, deps);
}

async function sprecheFehlersatz({ res, call, nowMs }: Antwortfall, deps: VoiceDeps): Promise<void> {
  vermerkeElGescheitert({ call, nowMs }, deps);
  await deps.sendVoiceXml(res, call, elFehlersatzDirektiven(await fehlersatzFuer({ call }, deps)));
}

async function sendAbweisung({ res, call }: { res: Antwort; call: Anruf }, deps: VoiceDeps): Promise<void> {
  logInboundPath({ callId: call.id, path: INBOUND_PATH.ABGEWIESEN });
  const grund = INBOUND_EL_GRUND.EL_OHNE_REGISTRIERUNG;
  vermerkeUebergabeGescheitert({ callId: call.id, grund, nowMs: Date.now() }, deps);
  console.log(`${INBOUND_LOG_PREFIX} ${INBOUND_PATH.ABGEWIESEN} grund=${grund} call=${call.id}`);
  await deps.sendVoiceXml(res, call, elFehlersatzDirektiven(await fehlersatzFuer({ call }, deps)));
}

async function vermerkeNachFehlerBestEffort(
  { call, nowMs, weg }: { call: AnrufOderLeer; nowMs: number; weg: RueckfallWeg },
  deps: VoiceDeps,
): Promise<void> {
  const vermerke = weg.vermerkNachFehler[weg.entscheide({ call, nowMs })];
  if (!call || !vermerke) return;
  try {
    await vermerke({ call, nowMs }, deps);
  } catch (err) {
    console.error(EL_RUECKFALL_LOG_PREFIX, "vermerk:", fehlerText(err));
  }
}

function ownerNameBestEffort({ call }: { call: AnrufTeil | null | undefined }, { store }: VoiceDeps): unknown {
  if (!call) return "";
  try {
    return store.tenantContext(call.tenantId).ownerName;
  } catch {
    return "";
  }
}

function fehlersatzOhneAufloesungXml({ call }: { call: AnrufTeil | null | undefined }, deps: VoiceDeps): string {
  const bundle = sprachtexteFuer(call?.language);
  const satz = sayD(bundle.inboundFehlersatz(ownerNameBestEffort({ call }, deps)), bundle.voiceProfile);
  return deps.render([satz, hangupD()], call?.provider ?? DEFAULT_PROVIDER);
}

function sendFehlersatzOhneAufloesung({ res, call }: { res: Antwort; call: AnrufOderLeer }, deps: VoiceDeps): void {
  res.type("text/xml").send(fehlersatzOhneAufloesungXml({ call }, deps));
}

const EINGEHENDER_RUECKFALL: RueckfallWeg = Object.freeze({
  entscheide: rueckfallEntscheidungFuer,
  antworten: Object.freeze({
    [RUECKFALL_ENTSCHEIDUNG.AUFLEGEN]: sendAuflegen,
    [RUECKFALL_ENTSCHEIDUNG.FEHLERSATZ]: sprecheFehlersatz,
  }),
  vermerkNachFehler: Object.freeze({ [RUECKFALL_ENTSCHEIDUNG.FEHLERSATZ]: vermerkeElGescheitert }),
  antworteNachFehler: sendFehlersatzOhneAufloesung,
});

const AUSGEHENDER_RUECKFALL: RueckfallWeg = Object.freeze({
  entscheide: ausgehendeRueckfallEntscheidungFuer,
  antworten: Object.freeze({
    [AUSGEHENDE_RUECKFALL_ENTSCHEIDUNG.AUFLEGEN]: sendAuflegen,
    [AUSGEHENDE_RUECKFALL_ENTSCHEIDUNG.AUFLEGEN_GESCHEITERT]: legeGescheitertAuf,
  }),
  vermerkNachFehler: Object.freeze({ [AUSGEHENDE_RUECKFALL_ENTSCHEIDUNG.AUFLEGEN_GESCHEITERT]: beendeElGescheitert }),
  antworteNachFehler: sendAuflegen,
});

const rueckfallWegFuer = (call: AnrufOderLeer): RueckfallWeg => (istOutboundElProfil(call) ? AUSGEHENDER_RUECKFALL : EINGEHENDER_RUECKFALL);

async function antworteAufElRueckfall(req: Aufruf, res: Antwort, deps: VoiceDeps): Promise<void> {
  if (!anfrageGeprueft(req, res)) return;
  let call: AnrufOderLeer = null;
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
    if (!call) {
      sendAuflegen({ res, call }, deps);
      return;
    }
    const antworte = weg.antworten[entscheidung];
    if (!antworte) throw new Error("unbekannte Rueckfallentscheidung");
    await antworte({ res, call, nowMs }, deps);
  } catch (err) {
    console.error(EL_RUECKFALL_LOG_PREFIX, fehlerText(err));
    const weg = rueckfallWegFuer(call);
    await vermerkeNachFehlerBestEffort({ call, nowMs: Date.now(), weg }, deps);
    weg.antworteNachFehler({ res, call }, deps);
  }
}

function beinAngenommen({ call, status }: { call: Anruf; status: string }): boolean {
  return ANGENOMMEN_STATUS.includes(status) && call.status === "active" && bridgeStateOf(call) === BRIDGE_STATE.WARTET;
}

const leseCall = (store: Speicher, callId: string): AnrufOderLeer | Promise<AnrufOderLeer> => (store.leseCall ? store.leseCall(callId) : store.getCall(callId));
const leseCallUngebunden = (store: Speicher, callId: string): AnrufOderLeer | Promise<AnrufOderLeer> =>
  store.leseCallUngebunden ? store.leseCallUngebunden(callId) : store.getCall(callId);

async function lesenMitFehler(
  lesen: (callId: string) => AnrufOderLeer | Promise<AnrufOderLeer>,
  callId: string,
  logPrefix: string,
): Promise<{ call?: AnrufOderLeer; fehler?: true }> {
  try {
    return { call: await lesen(callId) };
  } catch (err) {
    console.error(logPrefix, `Anruf lesen fehlgeschlagen (callId=${callId || "-"}):`, fehlerText(err));
    return { fehler: true };
  }
}

const leseCallMitFehler = (store: Speicher, callId: string, logPrefix: string) => lesenMitFehler((id: string) => leseCall(store, id), callId, logPrefix);

const leseCallBestEffort = async (store: Speicher, callId: string, logPrefix: string): Promise<AnrufOderLeer> => (await leseCallMitFehler(store, callId, logPrefix)).call;

const leseCallUngebundenBestEffort = async (store: Speicher, callId: string, logPrefix: string): Promise<AnrufOderLeer> =>
  (await lesenMitFehler((id: string) => leseCallUngebunden(store, id), callId, logPrefix)).call;

const statusCallFinden = (req: Aufruf, store: Speicher): Promise<{ call?: AnrufOderLeer; fehler?: true }> | { call: Anruf } => {
  const gespiegelt = store.getCall(VOICE_KOERPER.parse(req.body).CallSid);
  return gespiegelt ? { call: gespiegelt } : leseCallMitFehler(store, queryText(req.query.callId), STATUS_LOG_PREFIX);
};

async function vermerkeElBein(req: Aufruf, res: Antwort, { store, inboundBridges, webhookEvents }: VoiceDeps): Promise<void> {
  if (!anfrageGeprueft(req, res, STATUS_KOERPER)) return;
  res.sendStatus(HTTP_OK);
  const callId = queryText(req.query.callId);
  const gespiegelt = store.getCall(callId);
  const call = gespiegelt ?? (await leseCallUngebundenBestEffort(store, callId, EL_BEIN_LOG_PREFIX));
  if (!call) return;
  const { status } = webhookEvents(call.provider).parseLifecycleEvent(req.body);
  const angenommen = beinAngenommen({ call, status });
  console.log(EL_BEIN_LOG_PREFIX, JSON.stringify({ callId: call.id, status, angenommen }));
  if (angenommen) inboundBridges.armBindingDeadline(call.id);
}

async function antworteAufVorspannEreignis(
  req: Aufruf,
  res: Antwort,
  { store, config, webhookEvents, vorspannAblauf }: VoiceDeps,
): Promise<void> {
  if (!anfrageGeprueft(req, res, VORSPANN_KOERPER)) return;
  const call = await leseCallBestEffort(store, queryText(req.query.callId), VORSPANN_LOG_PREFIX);
  if (!call) {
    res.sendStatus(HTTP_OK);
    return;
  }
  const ereignisse = webhookEvents(call.provider);
  const ereignis = { ...ereignisse.parseCallControlEvent(req.body), wiedergabeStatus: ereignisse.parseWiedergabeStatus(req.body) };
  const verarbeitung = vorspannAblauf.behandle({ call, ereignis, zugang: elZugangVon(config) });
  const aufgelegt = ereignis.ereignis === CALL_CONTROL_EREIGNIS.AUFGELEGT;
  if (!aufgelegt) res.sendStatus(HTTP_OK);
  try {
    await verarbeitung;
  } catch (fehler) {
    if (!aufgelegt) throw fehler;
    res.status(HTTP_SERVICE_UNAVAILABLE).end();
    console.error(VORSPANN_LOG_PREFIX, "neu_zustellen", fehlerText(fehler));
    return;
  }
  if (aufgelegt) res.sendStatus(HTTP_OK);
  console.log(VORSPANN_LOG_PREFIX, "verarbeitet", JSON.stringify({ callId: call.id, ereignis: ereignis.ereignis }));
}

function ownerTonFuer({ from, tenantId }: { from: string; tenantId: string }, { store, config }: VoiceDeps): boolean {
  return callerIsOwnerGranted({
    from: normNum(from),
    ownNumber: store.tenantPrivateNumber(tenantId),
    tenantId,
    enabled: config.voice.inboundOwnerGreetingEnabled,
    allowedTenantIds: config.voice.inboundOwnerGreetingTenantIds,
  });
}

function erzeugeInboundCall({ leg, maxDurationS }: { leg: InboundLeg; maxDurationS: number }, deps: VoiceDeps): Anruf {
  const call = deps.store.createCall({
    ...leg,
    maxDurationS,
    callerIsOwner: ownerTonFuer({ from: leg.from, tenantId: leg.tenantId }, deps),
  });
  zaehleAnrufGestartet("inbound");
  return call;
}

interface VoiceRoutenParameter {
  store: Speicher;
  config: Konfiguration;
  audit: Protokoll;
  voiceRender: { render: Render };
  directiveSynth: Synthese;
  ttsStore: { takeOnce: (token: string | undefined) => Promise<{ contentType: string; bytes: Buffer } | null | undefined> };
  lifecycle: Lebenszyklus;
  finishCall: (call: unknown) => unknown;
  webhookEvents: VoiceDeps["webhookEvents"];
  providerFromHeaders: (headers: Request["headers"]) => string | null | undefined;
  inboundSignatureVerifier: () => {
    verifyInboundSignature: (anfrage: {
      headers: Request["headers"];
      rawBody: Buffer | undefined;
      url: string;
      params: unknown;
    }) => boolean;
  };
  terminateAndBillCall: typeof terminateAndBillCall;
  billThunk: typeof billThunk;
  startInboundNachlauf: (callId: string) => unknown;
  inboundBridges: Bruecken;
  vorspannAblauf: VorspannAblauf;
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
}: VoiceRoutenParameter): Router {
  const { render } = voiceRender;
  const bereiche: Bereiche = speicherBereiche(store);

  async function sendVoiceXml(res: Antwort, call: Anruf, directives: unknown[]): Promise<void> {
    const audio = await directiveSynth.synthesizeDirectiveAudio(call, directives, res.locals.eingangMs);
    res.type("text/xml").send(render(audio, call.provider));
  }

  const voiceDeps: VoiceDeps = {
    store, bereiche, config, lifecycle, webhookEvents, inboundBridges, directiveSynth,
    render, sendVoiceXml, vorspannAblauf,
  };

  function brakeSecondsFor(leg: InboundLeg): number {
    return emergencyBrakeSeconds({
      remainingCents: store.tenantBudgetSnapshot(leg.tenantId, config.billing).remainingCents,
      tariffCentsPerMin: minutenTarifFuer(leg),
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

  const liefereTts = async (req: Request<{ token: string }>, res: Antwort): Promise<void> => {
    if (!TTS_TOKEN.safeParse(req.params.token).success) {
      res.status(HTTP_NOT_FOUND).end();
      return;
    }
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
  };
  router.get("/voice/tts/:token", (req: Request<{ token: string }>, res: Antwort, next: NextFunction): void => {
    liefereTts(req, res).catch(next);
  });

  router.use("/voice", (req: Anfrage, res: Antwort, next: NextFunction): void => {
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
      zaehleAbgewiesenenWebhook();
      console.warn(
        `[voice-signature] ungueltige Inbound-Signatur -> 403 (path=${req.baseUrl}${req.path} provider=${providerFromHeaders(req.headers) ?? "unknown"})`,
      );
      res.status(HTTP_FORBIDDEN).send("invalid inbound signature");
      return;
    }
    next();
  });

  const nimmEingehendAn = async (req: Aufruf, res: Antwort): Promise<void> => {
    const provider = providerFromHeaders(req.headers) ?? DEFAULT_PROVIDER;
    let call: Anruf | undefined;
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
      const language = STARTSPRACHE;
      const locale = sprachtexteFuer(language);

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
      abheben.catch((fehler: unknown) => {
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
  };
  router.post("/voice/incoming", idempotenz.forIncoming, (req, res, next) => {
    nimmEingehendAn(req, res).catch(next);
  });

  router.post(EL_RUECKFALL_PFAD, idempotenz.forElRueckfall, (req, res, next) => {
    antworteAufElRueckfall(req, res, voiceDeps).catch(next);
  });
  router.post(EL_BEIN_PFAD, idempotenz.forElBein, (req, res, next) => {
    vermerkeElBein(req, res, voiceDeps).catch(next);
  });
  router.post(VORSPANN_PFAD, idempotenz.forVorspann, (req, res, next) => {
    antworteAufVorspannEreignis(req, res, voiceDeps).catch(next);
  });

  const statusAnruf = async (req: Aufruf, gefunden: AnrufOderLeer): Promise<AnrufOderLeer> => {
    const callId = wiederanbindungsKennung(req, gefunden);
    if (gefunden && !brauchtWiederanbindung(store, gefunden)) return gefunden;
    if (!callId) return null;
    return (await wiederanbinden({ store, lifecycle: statusLifecycleFuer(gefunden, lifecycle) }, gefunden, callId)).call;
  };
  const verarbeiteStatus = async (req: Aufruf, res: Antwort): Promise<void> => {
    if (!anfrageGeprueft(req, res, STATUS_KOERPER)) return;
    res.sendStatus(HTTP_OK);
    const call = await statusAnruf(req, (await statusCallFinden(req, store)).call);
    if (!call) return;
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
  };
  router.post("/voice/status", idempotenz.forStatus, (req, res, next) => {
    verarbeiteStatus(req, res).catch(next);
  });

  return router;
}
