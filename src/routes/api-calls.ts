import { Router } from "express";
import { makeKeyedChainMutex } from "../chain-mutex.js";
import type { Request, Response } from "express";
import { z } from "zod";
import { pruefeAbfrage, pruefeKoerper } from "../utils/eingabe-pruefen.js";
import { STARTSPRACHE } from "../konfiguration/standardsprache.ts";
import { normNum } from "../begriffe/rufnummern.js";
import { RECIPIENT_NAME_MAX_LENGTH } from "../begriffe/anrufe.ts";
import { CONSULT_ANSWER, CONSULT_ANSWER_MODE } from "../begriffe/rueckfrage.ts";
import { validateAssistantContext } from "../i18n/anruf-eingabe-texte.ts";
import { consultAllowedFor } from "../consult/gate.ts";
import { CONSULT_OPEN_MS } from "../consult/in-call.js";
import { CONSULT_EVENT } from "../consult/delivery.ts";
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
import { GatesBestanden, fuehreToreAus, type Ablehnung as TorAblehnung, type Tor } from "../telephony/gates-bestanden.ts";
import { NOT_PLACED, WARTEFRIST_REASON, startRejectionReason } from "../telephony/failure-reason.ts";
import { findDuplicateOutboundCall } from "../telephony/call-dedup.ts";
import { mapStatus } from "../call-result.ts";
import { diagnosticRetentionGranted } from "../diagnostic-retention.ts";
import { ownerSelfCallGranted } from "../callee-is-owner.ts";
import { hangUpForCall, persistEndWithReason } from "../telephony/call-termination.ts";
import { elevenlabsOutbound } from "../elevenlabs/registry.ts";
import { nachlaufPolitikFuer } from "../elevenlabs/nachlauf-politik.ts";
import { KOSTENPROFIL_FUER_WEG, meldeOutboundWeg, outboundWegFuer } from "../elevenlabs/outbound-weg.ts";
import { meldeVorspannBereit, meldeVorspannRueckfall } from "../elevenlabs/vorspann-erzeugen.js";
import { beginneAnrufstartMessung } from "../elevenlabs/anrufstart-messung.ts";
import { fetchOpeningLine } from "../elevenlabs/opening-line-llm.js";
import { localeFor } from "../i18n/locales.ts";
import { sprachcodeOf } from "../i18n/sprachcode.ts";
import { sprachwahlOf } from "../i18n/sprachwahl.ts";
import { fetchPrecallBriefing } from "../precall-briefing.js";
import { metrics } from "../metrics.ts";
import { zaehleAnrufAbgelehnt, zaehleAnrufGestartet } from "../utils/betriebsmessung.js";
import { ANRUFSTART_SPERR_TORE, makeAnrufstartAuftrag } from "../elevenlabs/anrufstart-auftrag.ts";
import { anrufpauseGilt } from "../utils/anrufpause.ts";
import { sleep } from "../utils/uhr-warten.ts";
import { internalOnly } from "../utils/vertrauter-aufruf.ts";
import { invalidLanguageBody } from "./_call-request.ts";
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


export type WaehleAnruf = (call: Anruf, bestanden: GatesBestanden) => Promise<Wahlausgang>;

type WegAufruf = Parameters<typeof outboundWegFuer>[0];

const sprachtexteFuer: (language: string) => unknown = localeFor;
const gateTexteFuer: (language: string) => { gates: { queueUnavailable: string } } = localeFor;
const torePruefen: (args: { gates: unknown; ctx: Kontext }) => Promise<Ablehnung | GatesBestanden> = runOutboundGates;
const vorabBriefing: (args: {
  objective: unknown;
  ownerNotes: unknown;
  constraints: unknown;
  to: string;
  tenantId: string | undefined;
}) => Promise<{ context: AnrufKontext; mandate: unknown } | null> = fetchPrecallBriefing;
const anrufSprache: (args: {
  store: Speicher;
  config: Konfiguration;
  call: { tenantId: string | undefined; from: string | undefined; to: string; language: string };
  ownerName: unknown;
}) => { language: string } = elevenlabsOutbound().callLocaleOf;
const eroeffnungHolen: (args: {
  objective: unknown;
  tenantId: string | undefined;
  locale: unknown;
  calleeIsOwner: boolean;
}) => Promise<{ line: string; source: string }> = fetchOpeningLine;
const KONSULT_OFFEN_MS: unknown = CONSULT_OPEN_MS;

interface Anruf {
  id: string;
  tenantId: string;
  from: string;
  to: string;
  goal?: string | null;
  direction: string;
  status: string;
  answeredAt?: string | null;
  queued?: boolean;
  startedAt: string;
  twilioSid?: string;
  callControlId: string;
  elCallControlId: string;
  provider?: string;
  diagnostic?: boolean;
  elevenlabsConversationId?: string | null;
  maxDurationS?: number;
}

type AnrufKern = Pick<Anruf, "id" | "tenantId">;

interface Ablehnung {
  status: number;
  body: Record<string, unknown>;
  audit?: { grund: string; event: string; detail: string } | null;
}

type Anspruch =
  | { denial: Ablehnung; call?: undefined; created?: false; wartet?: undefined }
  | { denial?: undefined; call: Anruf; created: boolean; wartet?: boolean };

interface Abbruch {
  grund?: string | null;
}

type Wahlausgang = { callControlId: string; abbruch?: undefined } | { callControlId?: undefined; abbruch: Abbruch };

interface Wartet {
  wartet: true;
  denial?: undefined;
  call?: undefined;
  created?: undefined;
}

interface Kontext {
  req: Request;
  to: string;
  objective: unknown;
  b: Koerper;
  callId: string;
  tenantId?: string | undefined;
  numberRecord?: unknown;
  context?: AnrufKontext | undefined;
  mandate?: unknown;
  fromNumber?: string | undefined;
  maxDur?: number | undefined;
  requestedBy?: string | undefined;
  outboundProvider?: string | undefined;
  reserveCents?: number | undefined;
}

interface AnrufKontext {
  summary?: unknown;
  key_facts?: unknown;
  recipient_relationship?: unknown;
  desired_outcome?: unknown;
  open_questions?: unknown;
}

interface Koerper {
  to?: unknown;
  goal?: unknown;
  objective?: unknown;
  language?: unknown;
  briefing?: unknown;
  constraints?: unknown;
  diagnostic?: unknown;
  recipient_name?: string | null | undefined;
}

interface Konfiguration {
  tenancy: { assistantContextEnabled: boolean };
  server: { publicUrl: string };
  privacy: { diagnosticRetentionDays: number };
  voice: {
    ownerSelfCallEnabled: unknown;
    ownerSelfCallTenantIds: unknown;
    elevenLabsInbound: WegAufruf["config"]["voice"]["elevenLabsInbound"];
  };
  telephony: { telnyxCallControlAppId: string | undefined };
  safety: { outboundFrozen: boolean };
}

interface Speicher {
  tenantLanguage: (tenantId: string | undefined) => string;
  tenantGeo: (tenantId: string | undefined) => { country: string; defaultLanguage: string };
  activeCallsForSql: (tenantId: string | undefined) => Promise<Anruf[]>;
  createCall: (felder: object) => Anruf;
  persistCall: (callId: string) => Promise<unknown>;
  withStoreLock: <T>(arbeit: () => Promise<T>) => Promise<T>;
  releaseOutboundReserveCents: (tenantId: string | undefined, cents: number | undefined) => Promise<unknown>;
  rueckfrageGelesen: (callId: string, tenantId: string, nach: null) => Promise<{ status: string | null }>;
  leseCall?: (callId: string) => Promise<Anruf | null | undefined>;
  getCall: (callId: string) => Anruf | null | undefined;
  endCallRecord: (callId: string, status: string) => unknown;
  recordFailureReason: (callId: string, reason: string) => unknown;
  resolveProfile: (tenantId: string | undefined) => unknown;
  einstellungenNachladen?: (tenantId: string | undefined) => Promise<unknown>;
  save: () => unknown;
  anrufpauseGelesen?: () => Promise<unknown>;
  anrufpauseAktiv?: () => unknown;
  numberRecordByE164: WegAufruf["store"]["numberRecordByE164"];
  load: () => unknown;
}

interface Bereiche {
  rueckfrage: {
    ackConsult: (callId: string, ereignis: { eventId: unknown }) => Promise<{ outcome: string }>;
    answerConsult: (
      callId: string,
      antwort: { eventId: unknown; facts: unknown[]; nowMs: number; openMs: unknown },
    ) => Promise<{ outcome: string; mergedFacts: number }>;
    emitConsult: (callId: string, fragen: unknown[]) => Promise<unknown>;
    noteConsultPoll: (callId: string) => Promise<unknown>;
    markConsultAskDelivered: (callId: string, eventId: string) => Promise<unknown>;
  };
  rueckfrageAbschluss: {
    zustellungSchreiben: (callId: string, tenantId: string | undefined, eventId: string) => Promise<unknown>;
  };
  konto: { tenantPrivateNumberLesen: (tenantId: string | undefined) => Promise<string | null | undefined> };
  mandant: { tenantContext: (tenantId: string | undefined) => Promise<{ ownerName: unknown }> };
  einstellungen: {
    recordCostProfile: (callId: string, profil: string) => Promise<unknown>;
    resolveProfile: (tenantId: string | undefined) => Promise<unknown>;
  };
  gespraech: { getCall: (callId: string) => Promise<Anruf | null | undefined> };
}

interface Leitungsplaetze {
  pruefenAusgehend: (anfrage: PlatzAnfrage) => Promise<string>;
  belegenAusgehend: (anfrage: PlatzAnfrage & { callId: string; maxDauerS: number | undefined }) => Promise<{ entscheidung: string }>;
  belegenWartend: (anfrage: { callId: string; tenantId: string | undefined }) => Promise<string>;
  freigeben: (callId: string) => unknown;
}

interface PlatzAnfrage {
  tenantId: string | undefined;
  weg: string;
  hoechstzahlKunde: number;
}

interface BudgetReservierung {
  freigeben: (anfrage: { callId: string; tenantId: string | undefined }) => Promise<unknown>;
}

interface Vorspann {
  rueckfall?: string | null;
  callControlId?: string;
}

type AuftragsVerbindung = Omit<
  Parameters<typeof makeAnrufstartAuftrag<Anruf>>[0],
  "store" | "anbieterGespraeche" | "haltAnrufStartFest" | "beendeStartUnklar" | "mandantenToken" | "wartefristMs"
>;

interface Anrufstart {
  einreihen?: (callId: string) => Promise<boolean>;
  macheAuftrag?: ((verbindung: AuftragsVerbindung) => unknown) | null;
  verdrahtung?: { setzeHandler: (handler: unknown) => unknown } | null;
  uhr?: { jetztMs: () => number; warte: (ms: number) => Promise<void> };
  abschaltend?: (() => boolean) | undefined;
}

type AnrufSperre = <T>(tenantId: string | undefined, arbeit: () => Promise<T>) => Promise<T>;

const ohneAnrufSperre: AnrufSperre = (_tenantId, arbeit) => arbeit();

interface Abhaengigkeiten {
  store: Speicher;
  mitAnrufSperre?: AnrufSperre;
  leitungsplaetze: Leitungsplaetze;
  budgetReservierung?: BudgetReservierung;
  config: Konfiguration;
  audit: Protokoll;
  outboundGates: unknown;
  callQuotaDenial?: (ctx: Kontext) => Promise<Ablehnung | null | undefined>;
  voiceControl: (provider: string | undefined) => VoiceControl;
  erzeugeVorspann?: (call: Anruf) => Promise<Vorspann>;
  vorspannAblauf: {
    pruefe: (anfrage: { call: Anruf }) => Promise<{ grund?: string | null }>;
    waehle: (anfrage: { call: Anruf; vorspann: Vorspann }) => Promise<{ callControlId: string }>;
  };
  terminateAndBillCall: Abwicklung;
  hangUpAction: (voiceControl: (provider: string | undefined) => VoiceControl, call: Anruf, sid: string | undefined) => (() => Promise<unknown>) | null;
  elevenLabsHangUpAction?: (endActiveCall: (callId: string) => Promise<unknown>, call: Anruf) => (() => Promise<unknown>) | null;
  endActiveCall: (callId: string) => Promise<unknown>;
  awaitAndPersistInboundElResult: (callId: string) => Promise<unknown>;
  billThunk: (finishCall: (call: unknown) => unknown, store: Speicher, callId: string) => () => unknown;
  finishCall: (call: unknown) => unknown;
  arm: {
    armMaxDurationTimer: (call: Anruf, sid: string | null | undefined) => unknown;
    armReserveReleaseTimer: (call: Anruf) => unknown;
  };
  anrufstart?: Anrufstart;
  tenant: {
    requestTenant: (req: Request) => string;
    requireTenant: (req: Request, res: Response) => string | null | undefined;
    tenantOwnsCall: (call: AnrufKern, tenantId: string | undefined) => boolean;
  };
  consultDelivery: {
    waitForEvent: (anfrage: {
      callId: string;
      tenantId: string;
      afterEventId: string | null;
      signal: null;
    }) => Promise<{ event: string; eventId?: string }>;
  };
  internalIdentity: (req: Request) => string | null | undefined;
  OWNER_ID: string;
}

interface VoiceControl {
  originateCall: (anfrage: object) => Promise<{ sid: string }>;
  endCall: (providerCallSid: string) => Promise<unknown>;
  endCallViaCallControl: (callControlId: string) => Promise<unknown>;
}

type Protokoll = (aktion: string, req: Request, detail: string) => unknown;
type Abwicklung = (anfrage: {
  persistEnd: () => unknown;
  hangUp: (() => Promise<unknown>) | null | undefined;
  bill: () => unknown;
  onHangUpError?: (fehler: unknown) => void;
  callId: string;
}) => Promise<void>;

function contextReceivedMeta(context: AnrufKontext | null | undefined, config: Konfiguration) {
  return {
    active: config.tenancy.assistantContextEnabled,
    summary: !!context?.summary,
    key_facts_count: Array.isArray(context?.key_facts) ? context.key_facts.length : 0,
    recipient_relationship: !!context?.recipient_relationship,
    desired_outcome: !!context?.desired_outcome,
  };
}

async function anrufVonAndererInstanz(store: Speicher, callId: string, tenantId: string | undefined) {
  if (!tenantId) return null;
  const { status } = await store.rueckfrageGelesen(callId, tenantId, null);
  return status === null ? null : { id: callId, tenantId };
}

const leseAnruf = (store: Speicher, callId: string) => (store.leseCall ? store.leseCall(callId) : store.getCall(callId));

function providerStatusOf(err: unknown): number | string | undefined {
  const status: unknown = Reflect.get(Object(err), "providerStatus");
  return typeof status === "number" || typeof status === "string" ? status : undefined;
}

const nachrichtOf = (fehler: unknown): unknown => Reflect.get(Object(fehler), "message");

function beschreibungOf(fehler: unknown): unknown {
  const nachricht = nachrichtOf(fehler);
  if (nachricht) return nachricht;
  return String(fehler);
}

const CONSULT_ABFRAGE = z.object({ after: z.string().nullable().catch(null) });
const GEGENSTELLE_TEXT = z.string().trim().max(RECIPIENT_NAME_MAX_LENGTH);
const GEGENSTELLE_NAME = GEGENSTELLE_TEXT.transform((name) => name || null)
  .nullish()
  .catch(null);
const ANRUF_KOERPER = z.object({ recipient_name: GEGENSTELLE_NAME }).passthrough().catch({});
const PFAD_KENNUNG_MAX = 128;
const PFAD_KENNUNG = z.object({ id: z.string().max(PFAD_KENNUNG_MAX) });
function pfadKennung(res: Response, params: unknown): string | undefined {
  const geprueft: unknown = pruefeKoerper(res, { schema: PFAD_KENNUNG }, params);
  if (geprueft === undefined) return undefined;
  return PFAD_KENNUNG.parse(geprueft).id;
}
const CONSULT_ANTWORT_KOERPER = z
  .object({ event_id: z.unknown(), answers: z.unknown(), status: z.unknown() })
  .catch({});

export function endFailedCallWithReason(store: Speicher, callId: string, providerStatus: number | string | undefined): () => Promise<void> {
  return persistEndWithReason({
    store,
    callId,
    reason: startRejectionReason(providerStatus),
    endCall: () => store.endCallRecord(callId, "failed"),
  });
}

function elevenLabsCallNotWired(): never {
  throw new Error(
    "Der Anrufstart ist nicht verdrahtet (deps.erzeugeVorspann fehlt)",
  );
}

const GRUND_WARTESCHLANGE = "warteschlange";
const GRUND_TOR_FEHLER = "tor-fehler";

function anrufstartNichtVerdrahtet(): never {
  throw new Error("Der Anrufstart-Auftrag ist nicht verdrahtet (deps.anrufstart fehlt)");
}

const ANRUFSTART_UNVERDRAHTET: Required<Omit<Anrufstart, "abschaltend">> = Object.freeze({
  einreihen: anrufstartNichtVerdrahtet,
  macheAuftrag: null,
  verdrahtung: null,
  uhr: Object.freeze({ jetztMs: Date.now, warte: sleep }),
});

function callQuotaDenialNotWired(): never {
  throw new Error(
    "callQuotaDenial ist nicht verdrahtet (deps.callQuotaDenial fehlt) - Quoten-Pruefung im Claim-Lock kann nicht laufen",
  );
}

function elevenLabsHangUpActionNotWired(_endActiveCall: unknown, call: Anruf): null {
  console.error(
    `[cancel] elevenLabsHangUpAction ist nicht verdrahtet (deps fehlt, call=${call.id})`,
  );
  return null;
}

function invalidConsultAnswerStatus(status: unknown): string | null {
  if (status === undefined) return null;
  if (status === CONSULT_ANSWER_MODE.WORKING || status === CONSULT_ANSWER_MODE.FINAL) return null;
  return "status ist ungueltig";
}

interface KonsultAnfrage {
  bereiche: Bereiche;
  audit: Protokoll;
  req: Request;
  res: Response;
  call: Anruf;
  eventId: unknown;
}

async function ackWorkingConsult({ bereiche, audit, req, res, call, eventId }: KonsultAnfrage) {
  const { outcome } = await bereiche.rueckfrage.ackConsult(call.id, { eventId });
  audit("consult_acked", req, `call=${call.id} event=${String(eventId)} ergebnis=${outcome}`);
  if (outcome !== CONSULT_ANSWER.ACCEPTED) return antworteFehler(res, HTTP_CONFLICT, outcome);
  return res.json({ accepted: true, merged_facts: 0 });
}

async function answerConsultFinal({ bereiche, audit, req, res, call, eventId, answers }: KonsultAnfrage & { answers: unknown }) {
  const validated: { value: AnrufKontext | null } | { error: string } = validateAssistantContext({ key_facts: answers });
  if ("error" in validated) return res.status(HTTP_BAD_REQUEST).json({ error: validated.error });
  const fakten = validated.value?.key_facts;
  if (!Array.isArray(fakten) || !fakten.length)
    return res.status(HTTP_BAD_REQUEST).json({ error: "answers ist Pflicht" });
  const { outcome, mergedFacts } = await bereiche.rueckfrage.answerConsult(call.id, {
    eventId,
    facts: fakten,
    nowMs: Date.now(),
    openMs: KONSULT_OFFEN_MS,
  });
  audit(
    "consult_answered",
    req,
    `call=${call.id} event=${String(eventId)} ergebnis=${outcome} fakten=${String(mergedFacts)}`,
  );
  if (outcome !== CONSULT_ANSWER.ACCEPTED) return antworteFehler(res, HTTP_CONFLICT, outcome);
  return res.json({ accepted: true, merged_facts: mergedFacts });
}

async function eigeneNummerLesen({ bereiche, audit, ctx }: { bereiche: Bereiche; audit: Protokoll; ctx: Kontext }) {
  try {
    return await bereiche.konto.tenantPrivateNumberLesen(ctx.tenantId);
  } catch (fehler) {
    console.error("[place_call] eigene Nummer nicht lesbar:", nachrichtOf(fehler));
    audit("place_call_eigene_nummer", ctx.req, `grund=eigene_nummer_nicht_lesbar tenant=${String(ctx.tenantId)}`);
    return null;
  }
}

async function resolveCallPrivacyFlags({ bereiche, audit, config, ctx }: { bereiche: Bereiche; audit: Protokoll; config: Konfiguration; ctx: Kontext }) {
  const ownNumber = await eigeneNummerLesen({ bereiche, audit, ctx });
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

function denialDimensions({ store, grund, tenantId }: { store: Speicher; grund: string; tenantId: string | undefined }) {
  const { country, defaultLanguage } = store.tenantGeo(tenantId);
  return { grund, country, language: defaultLanguage };
}

function beobachteAblehnung({ store, audit, denial, req, tenantId }: { store: Speicher; audit: Protokoll; denial: Ablehnung; req: Request; tenantId: string | undefined }) {
  if (!denial.audit) return;
  zaehleAnrufAbgelehnt(denial.audit.grund);
  try {
    audit(denial.audit.event, req, denial.audit.detail);
    metrics.logCallDenied(denialDimensions({ store, grund: denial.audit.grund, tenantId }));
  } catch (fehler) {
    console.error("[place_call] Ablehnung nicht protokollierbar:", nachrichtOf(fehler));
  }
}

function denialResponseBody(denial: Ablehnung) {
  return denial.audit ? { ...denial.body, reason: denial.audit.grund } : denial.body;
}

const vorWahlAbgebrochenBody = (callId: string) => ({
  error: "Der Anruf wurde vor dem Waehlen abgebrochen. Es wurde nicht gewaehlt.",
  callId,
});

const CLAIM_ERROR_MESSAGE =
  "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.";

const platzAnfrage = ({ tenantId }: { tenantId?: string | undefined }) => ({
  tenantId,
  weg: ANBIETER.ELEVENLABS,
  hoechstzahlKunde: AUSGEHEND_JE_KUNDE,
});

async function vorabAblehnung({ store, leitungsplaetze, ctx }: { store: Speicher; leitungsplaetze: Leitungsplaetze; ctx: Kontext }): Promise<Anspruch | Wartet | null> {
  const laeuftSchon = findDuplicateOutboundCall(await store.activeCallsForSql(ctx.tenantId), {
    to: ctx.to,
    nowMs: Date.now(),
  });
  if (laeuftSchon) return null;
  const entscheidung = await leitungsplaetze.pruefenAusgehend(platzAnfrage(ctx));
  if (entscheidung === LEITUNGSPLATZ_ENTSCHEIDUNG.FREI) return null;
  if (entscheidung === LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL) return { wartet: true };
  return { denial: leitungsplatzAblehnung({ store, ctx, entscheidung }) };
}

async function belegePlatzOderWarte({
  leitungsplaetze,
  ctx,
  felder,
  wartet,
}: {
  leitungsplaetze: Leitungsplaetze;
  ctx: Kontext;
  felder: { id: string };
  wartet: boolean;
}): Promise<{ wartet: boolean; abgelehnt: string | null }> {
  if (!wartet) {
    const { entscheidung } = await leitungsplaetze.belegenAusgehend({
      ...platzAnfrage(ctx),
      callId: felder.id,
      maxDauerS: ctx.maxDur,
    });
    if (entscheidung === LEITUNGSPLATZ_ENTSCHEIDUNG.FREI) return { wartet: false, abgelehnt: null };
    if (entscheidung !== LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL) return { wartet: false, abgelehnt: entscheidung };
  }
  const warteplatz = await leitungsplaetze.belegenWartend({ callId: felder.id, tenantId: ctx.tenantId });
  return { wartet: true, abgelehnt: warteplatz === LEITUNGSPLATZ_ENTSCHEIDUNG.FREI ? null : warteplatz };
}

async function claimCallRecord({
  store,
  leitungsplaetze,
  ctx,
  felder,
  nowMs,
  callQuotaDenial,
  wartet,
}: {
  store: Speicher;
  leitungsplaetze: Leitungsplaetze;
  ctx: Kontext;
  felder: { id: string };
  nowMs: number;
  callQuotaDenial: (ctx: Kontext) => Promise<Ablehnung | null | undefined>;
  wartet: boolean;
}): Promise<Anspruch> {
  const vorab = await store.withStoreLock(async (): Promise<Anspruch | null> => {
    const laufender = findDuplicateOutboundCall(await store.activeCallsForSql(ctx.tenantId), {
      to: ctx.to,
      nowMs,
    });
    if (laufender) return { call: laufender, created: false };
    const denial = await callQuotaDenial(ctx);
    return denial ? { denial, created: false } : null;
  });
  if (vorab) return vorab;
  const platz = await belegePlatzOderWarte({ leitungsplaetze, ctx, felder, wartet });
  if (platz.abgelehnt)
    return { denial: leitungsplatzAblehnung({ store, ctx, entscheidung: platz.abgelehnt }), created: false };
  const call = await store.withStoreLock(async () => {
    const angelegt = store.createCall(felder);
    await store.persistCall(angelegt.id);
    return angelegt;
  });
  zaehleAnrufGestartet("outbound");
  return { call, created: true, wartet: platz.wartet };
}

function placeCallResponseBody({ call, ctx, config, deduplicated }: { call: Anruf; ctx: Kontext; config: Konfiguration; deduplicated: boolean }) {
  return {
    ok: true,
    callId: call.id,
    twilioSid: call.twilioSid,
    startedAt: call.startedAt,
    status: deduplicated ? mapStatus(call) : "dialing",
    to: call.to,
    objective: call.goal,
    deduplicated,
    context_received: contextReceivedMeta(ctx.context, config),
    diagnostic: call.diagnostic,
  };
}

function antwortOhneNeuenAnruf({ claim, ctx, req, store, audit, config }: { claim: Anspruch; ctx: Kontext; req: Request; store: Speicher; audit: Protokoll; config: Konfiguration }) {
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

interface AntwortOhneAnruf {
  claim: Anspruch;
  ctx: Kontext;
  req: Request;
  res: Response;
  store: Speicher;
  budgetReservierung: BudgetReservierung;
  audit: Protokoll;
  config: Konfiguration;
}

async function antwortOhneAnruf({ claim, ctx, req, res, store, budgetReservierung, audit, config }: AntwortOhneAnruf) {
  await store.withStoreLock(() => store.releaseOutboundReserveCents(ctx.tenantId, ctx.reserveCents));
  await budgetReservierung.freigeben({ callId: ctx.callId, tenantId: ctx.tenantId });
  const antwort = antwortOhneNeuenAnruf({ claim, ctx, req, store, audit, config });
  return res.status(antwort.status).json(antwort.body);
}

async function gibReserveZurueckUndMelde({
  store,
  leitungsplaetze,
  budgetReservierung,
  callId,
  ctx,
  fehler,
}: {
  store: Speicher;
  leitungsplaetze: Leitungsplaetze;
  budgetReservierung: BudgetReservierung;
  callId: string;
  ctx: Kontext;
  fehler: unknown;
}) {
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

function gibPlatzNachAuflegenFrei({ leitungsplaetze, callId, aufgelegt }: { leitungsplaetze: Leitungsplaetze | undefined; callId: string; aufgelegt: boolean }) {
  if (aufgelegt) leitungsplaetze?.freigeben(callId);
}

export function makeCallRoutes({
  store,
  mitAnrufSperre = ohneAnrufSperre,
  leitungsplaetze,
  budgetReservierung = KEINE_DB_RESERVIERUNG,
  config,
  audit,
  outboundGates,
  callQuotaDenial = callQuotaDenialNotWired,
  voiceControl,
  erzeugeVorspann = elevenLabsCallNotWired,
  vorspannAblauf,
  terminateAndBillCall,
  hangUpAction,
  elevenLabsHangUpAction = elevenLabsHangUpActionNotWired,
  endActiveCall,
  awaitAndPersistInboundElResult,
  billThunk,
  finishCall,
  arm: { armMaxDurationTimer, armReserveReleaseTimer },
  anrufstart,
  tenant: { requestTenant, requireTenant, tenantOwnsCall },
  consultDelivery,
  internalIdentity,
  OWNER_ID,
}: Abhaengigkeiten): Router {
  const router = Router();
  const jeSchluessel: <T>(schluessel: string, arbeit: () => Promise<T>) => Promise<T> = makeKeyedChainMutex();
  const bereiche: Bereiche = speicherBereiche(store);
  const { einreihen, macheAuftrag, verdrahtung, uhr, abschaltend } = { ...ANRUFSTART_UNVERDRAHTET, ...anrufstart };

  function sichtbarerAnruf<T extends AnrufKern>(call: T | null | undefined, tenantId: string | undefined) {
    return call && tenantOwnsCall(call, tenantId) ? call : null;
  }

  async function bereiteVorspannVor(call: Anruf) {
    const vorspann = await erzeugeVorspann(call);
    if (vorspann.rueckfall) meldeVorspannRueckfall({ callId: call.id, grund: vorspann.rueckfall });
    else meldeVorspannBereit(call.id);
    return vorspann;
  }

  async function beendeOhneAnbieter(callId: string, reason: string) {
    const haltGrundUndEnde = persistEndWithReason({
      store,
      callId,
      reason,
      endCall: () => store.endCallRecord(callId, "failed"),
    });
    return terminateAndBillCall({
      persistEnd: async () => {
        await leseAnruf(store, callId);
        await haltGrundUndEnde();
      },
      hangUp: null,
      bill: billThunk(finishCall, store, callId),
      callId,
    });
  }

  async function brichVorWahlAb({ call, grund, res }: { call: Anruf; grund: string; res: Response }) {
    await beendeOhneAnbieter(call.id, `${NOT_PLACED}:${grund}`);
    return res.status(HTTP_CONFLICT).json({ ...vorWahlAbgebrochenBody(call.id), grund });
  }

  const waehleAnruf: WaehleAnruf = async (call, bestanden) => {
    if (!bestanden.gilt) throw new TypeError("Wählen ohne bestandene Gates");
    const wahl = outboundWegFuer({ config, store, call });
    meldeOutboundWeg({ callId: call.id, wahl });
    if (!wahl.weg) return { abbruch: { grund: wahl.grund } };
    await bereiche.einstellungen.recordCostProfile(call.id, KOSTENPROFIL_FUER_WEG[wahl.weg]);
    const messung = beginneAnrufstartMessung(uhr.jetztMs);
    const vorspann = await messung.teil("ms_tts", () => bereiteVorspannVor(call));
    if ((await messung.teil("ms_pruefe", () => vorspannAblauf.pruefe({ call }))).grund) return { abbruch: {} };
    if (vorspann.rueckfall) return { abbruch: { grund: vorspann.rueckfall } };
    const gewaehlt = await messung.teil("ms_waehle", () => vorspannAblauf.waehle({ call, vorspann }));
    messung.melde(call);
    return { callControlId: gewaehlt.callControlId };
  };

  function armeTimer(call: Anruf) {
    armMaxDurationTimer(call, call.twilioSid);
    armReserveReleaseTimer(call);
  }

  async function beendeNachStartFehler(call: Anruf, err: unknown) {
    const providerStatus = providerStatusOf(err);
    await terminateAndBillCall({
      persistEnd: endFailedCallWithReason(store, call.id, providerStatus),
      hangUp: null,
      bill: billThunk(finishCall, store, call.id),
      callId: call.id,
    });
    console.error(`[place_call] originate fehlgeschlagen call=${call.id}:`, beschreibungOf(err));
    return providerStatus;
  }

  const sperren = {
    eingefroren: () => config.safety.outboundFrozen,
    pausiert: () => anrufpauseGilt(store),
    abgebrochen: (call: Anruf) => call.status !== "active",
    abschaltend,
  };

  function sperrAblehnung(call: Anruf, grund: string): TorAblehnung {
    return { status: HTTP_CONFLICT, body: { error: grund }, audit: { event: "anrufstart_gesperrt", grund, detail: call.id } };
  }

  const wartendeTore: Tor<Anruf>[] = ANRUFSTART_SPERR_TORE.map((tor) => ({
    name: tor.name,
    run: async (call) => ((await tor.gesperrt(sperren, call)) ? sperrAblehnung(call, tor.grund) : null),
  }));

  async function starteWartendenAnruf(call: Anruf) {
    const bestanden = await fuehreToreAus(wartendeTore, call, (tor, betroffen, fehler) => {
      console.error(`[anrufstart] Tor ${tor.name} nicht lesbar call=${betroffen.id}:`, beschreibungOf(fehler));
      return sperrAblehnung(betroffen, GRUND_TOR_FEHLER);
    });
    if (!(bestanden instanceof GatesBestanden)) {
      await beendeOhneAnbieter(call.id, `${NOT_PLACED}:${bestanden.audit.grund}`);
      throw new Error(`[anrufstart] nicht gewaehlt (call=${call.id})`);
    }
    let ausgang: Wahlausgang;
    try {
      ausgang = await waehleAnruf(call, bestanden);
    } catch (fehler) {
      await beendeNachStartFehler(call, fehler);
      throw fehler;
    }
    const { abbruch } = ausgang;
    if (abbruch?.grund) await beendeOhneAnbieter(call.id, `${NOT_PLACED}:${abbruch.grund}`);
    if (abbruch) throw new Error(`[anrufstart] nicht gewaehlt (call=${call.id})`);
    const aufzeichnung = await leseAnruf(store, call.id);
    if (aufzeichnung) aufzeichnung.callControlId = ausgang.callControlId;
    store.save();
  }

  async function belegePlatzFuer(call: Anruf) {
    const { entscheidung } = await leitungsplaetze.belegenAusgehend({
      ...platzAnfrage(call),
      callId: call.id,
      maxDauerS: call.maxDurationS,
    });
    return entscheidung === LEITUNGSPLATZ_ENTSCHEIDUNG.FREI;
  }

  if (macheAuftrag && verdrahtung)
    verdrahtung.setzeHandler(
      macheAuftrag({
        starte: starteWartendenAnruf,
        sperren,
        beendeOhneWahl: (callId, grund) => beendeOhneAnbieter(callId, `${NOT_PLACED}:${grund}`),
        armeTimer,
        jetztMs: uhr.jetztMs,
        platz: {
          belege: belegePlatzFuer,
          beendeNachWartefrist: (callId) => beendeOhneAnbieter(callId, WARTEFRIST_REASON),
          warte: uhr.warte,
        },
      }),
    );

  async function reiheWartendenAnrufEin({ call, ctx, res }: { call: Anruf; ctx: Kontext; res: Response }) {
    try {
      if (!(await einreihen(call.id))) throw new Error("Auftrag nicht eingereiht");
    } catch (fehler) {
      console.error(`[place_call] Warteschlange nicht erreichbar call=${call.id}:`, nachrichtOf(fehler));
      await beendeOhneAnbieter(call.id, `${NOT_PLACED}:${GRUND_WARTESCHLANGE}`);
      const { queueUnavailable } = gateTexteFuer(store.tenantLanguage(ctx.tenantId)).gates;
      return res.status(HTTP_SERVICE_UNAVAILABLE).json({ error: queueUnavailable });
    }
    return res.json(placeCallResponseBody({ call, ctx, config, deduplicated: false }));
  }

  async function emitOpeningConsult({ req, call, context, tenantId }: { req: Request; call: Anruf; context: AnrufKontext | undefined; tenantId: string | undefined }) {
    if (!consultAllowedFor(store.resolveProfile(tenantId))) return;
    const questions = Array.isArray(context?.open_questions) ? context.open_questions : [];
    if (!questions.length) return;
    await bereiche.rueckfrage.emitConsult(call.id, questions);
    audit("consult_emitted", req, `call=${call.id} fragen=${String(questions.length)}`);
  }

  const legeAnrufAn = async (req: Request, res: Response) => {
    const b: Koerper = ANRUF_KOERPER.parse(pruefeKoerper(res, { schema: ANRUF_KOERPER }, req.body));
    const to = normNum(b.to);
    let objective = b.goal;
    if (b.objective) objective = b.objective;
    if (!to || !objective) return res.status(HTTP_BAD_REQUEST).json({ error: "to und objective sind Pflicht" });
    if (isTrunkZeroFormatError(to)) return res.status(HTTP_BAD_REQUEST).json({ error: E164_FORMAT_ERROR });

    const gewaehlt = b.language ? sprachcodeOf(b.language) : null;
    if (gewaehlt && !gewaehlt.ok) return res.status(HTTP_BAD_REQUEST).json(invalidLanguageBody());
    const requestedLanguage = gewaehlt?.wert;

    const callId = newId("call");
    const ctx: Kontext = { req, to, objective, b, callId };
    const ergebnis = await torePruefen({ gates: outboundGates, ctx });
    if (!(ergebnis instanceof GatesBestanden)) {
      const denial = ergebnis;
      beobachteAblehnung({ store, audit, denial, req, tenantId: ctx.tenantId });
      return res.status(denial.status).json(denialResponseBody(denial));
    }

    let call: Anruf;
    let wartet = false;
    try {
      const vorab = await vorabAblehnung({ store, leitungsplaetze, ctx });
      if (vorab?.denial) return await antwortOhneAnruf({ claim: vorab, ctx, req, res, store, budgetReservierung, audit, config });
      wartet = vorab?.wartet === true;
      await store.einstellungenNachladen?.(ctx.tenantId);
      const language = requestedLanguage ?? STARTSPRACHE;
      const wahl = sprachwahlOf(language);
      const { code, texte } = wahl.ok ? wahl.wert : wahl.fehler;
      console.log(`[startsprache] startsprache=${code} texte=${texte}`);
      const { diagnostic, calleeIsOwnerOfThisCall } = await resolveCallPrivacyFlags({
        bereiche,
        audit,
        config,
        ctx,
      });

      if (!ctx.context) {
        const briefed = await vorabBriefing({
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
      const callLocale = anrufSprache({
        store,
        config,
        call: { tenantId: ctx.tenantId, from: ctx.fromNumber, to: ctx.to, language },
        ownerName,
      });
      const opening = await eroeffnungHolen({
        objective: ctx.objective,
        tenantId: ctx.tenantId,
        locale: sprachtexteFuer(callLocale.language),
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
        recipientName: b.recipient_name ?? null,
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
      const claim = await jeSchluessel(String(ctx.tenantId), () =>
        mitAnrufSperre(ctx.tenantId, () =>
          claimCallRecord({ store, leitungsplaetze, ctx, felder, nowMs: Date.now(), callQuotaDenial, wartet }),
        ),
      );
      if (!claim.created) return await antwortOhneAnruf({ claim, ctx, req, res, store, budgetReservierung, audit, config });
      call = claim.call;
      wartet = claim.wartet === true;
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
    if (wartet) return await reiheWartendenAnrufEin({ call, ctx, res });

    try {
      const ausgang = await waehleAnruf(call, ergebnis);
      const { abbruch } = ausgang;
      if (abbruch?.grund) return await brichVorWahlAb({ call, grund: abbruch.grund, res });
      if (abbruch) return res.status(HTTP_CONFLICT).json(vorWahlAbgebrochenBody(call.id));
      call.callControlId = ausgang.callControlId;
      store.save();
      armeTimer(call);
      return res.json(placeCallResponseBody({ call, ctx, config, deduplicated: false }));
    } catch (err) {
      const providerStatus = await beendeNachStartFehler(call, err);
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

  async function liefereConsultEreignis(req: Request<{ id: string }>, res: Response) {
    const callId = pfadKennung(res, req.params);
    if (callId === undefined) return undefined;
    const tenantId = requestTenant(req);
    const call = sichtbarerAnruf(
      (await bereiche.gespraech.getCall(callId)) ??
        (await anrufVonAndererInstanz(store, callId, tenantId)),
      tenantId,
    );
    if (!call) return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    if (!consultAllowedFor(await bereiche.einstellungen.resolveProfile(tenantId)))
      return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    await bereiche.rueckfrage.noteConsultPoll(call.id);
    const event = await consultDelivery.waitForEvent({
      callId: call.id,
      tenantId: call.tenantId,
      afterEventId: CONSULT_ABFRAGE.parse(pruefeAbfrage(res, { schema: CONSULT_ABFRAGE }, req.query)).after,
      signal: null,
    });
    const { eventId } = event;
    if (event.event === CONSULT_EVENT.CONSULT && eventId) {
      await bereiche.rueckfrage.markConsultAskDelivered(call.id, eventId);
      await bereiche.rueckfrageAbschluss.zustellungSchreiben(call.id, call.tenantId, eventId);
    }
    return res.json(event);
  }

  router.get("/api/calls/:id/consult", internalOnly, (req, res, next) => {
    liefereConsultEreignis(req, res).catch(next);
  });

  async function beantworteConsult(req: Request<{ id: string }>, res: Response) {
    const callId = pfadKennung(res, req.params);
    if (callId === undefined) return undefined;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return undefined;
    const call = sichtbarerAnruf(store.getCall(callId), tenantId);
    if (!call) return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    if (!consultAllowedFor(await bereiche.einstellungen.resolveProfile(tenantId)))
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

  async function brecheAnrufAb(req: Request<{ id: string }>, res: Response) {
    const callId = pfadKennung(res, req.params);
    if (callId === undefined) return undefined;
    const call = sichtbarerAnruf(await leseAnruf(store, callId), requestTenant(req));
    if (!call) return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    if (call.status !== "active") return res.json({ status: call.status });
    audit("cancel_call", req, `call=${call.id} requestedBy=${internalIdentity(req) ?? OWNER_ID}`);
    const providerHangUp = hangUpAction(voiceControl, call, call.twilioSid);
    const isElevenLabsCall = !providerHangUp;
    const elHangUp = isElevenLabsCall ? elevenLabsHangUpAction(endActiveCall, call) : null;
    let auflegenGescheitert = false;
    await terminateAndBillCall({
      persistEnd: elevenlabsOutbound().endeSchreiberFuer({
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
        max_line_s: elevenlabsOutbound().ELEVENLABS_PROVIDER_MAX_DURATION_S,
        hangup_attempted: Boolean(elHangUp),
      });
    return res.json({ status: "cancelled" });
  }

  router.post("/api/calls/:id/cancel", internalOnly, (req, res, next) => {
    brecheAnrufAb(req, res).catch(next);
  });

  return router;
}
