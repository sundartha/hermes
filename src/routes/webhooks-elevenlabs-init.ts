import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BRIDGE_STATE, bridgeStateOf, istOutboundElProfil } from "../elevenlabs/inbound-bridge-state.ts";
import { INIT_WEBHOOK_TOKEN_MIN_LENGTH, inboundElPathFor } from "../elevenlabs/inbound-path-decision.ts";
import {
  INITIATION_RESPONSE_TYPE,
  buildInitiationResponse,
  callBindingTokenOf,
  inboundEroeffnungsDefekteFuer,
  sipHeadersFormOf,
} from "../elevenlabs/inbound-initiation.js";
import { eroeffnungsFelder, meldeFirstMessageErgebnis } from "../elevenlabs/anrufstart-messung.ts";
import { msSeitAnnahme } from "../elevenlabs/inbound-rueckfall.ts";
import { RATE_WINDOW_MS, respondTooManyRequests } from "../middleware.ts";
import { normNum } from "../begriffe/rufnummern.js";
import { safeEqual } from "../util.ts";
import { pruefeKoerper } from "../utils/eingabe-pruefen.js";
import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVER_ERROR } from "../utils/http.ts";

interface Anruf {
  id: string;
  to: string;
  from: string;
  tenantId: string;
  status?: string;
  streamToken?: string;
  costProfile?: unknown;
  answeredAt?: string;
  elFallbackAt?: unknown;
  elBoundAt: string;
  elevenlabsConversationId?: unknown;
}

interface InitKoerper {
  agent_id?: unknown;
  called_number?: unknown;
  conversation_id?: unknown;
}

interface Konfiguration {
  voice: {
    elevenLabsInbound: { initWebhookToken?: unknown };
    elevenLabsOutbound: { agentId?: unknown };
  };
}

interface Bindung {
  bound: boolean;
  changed: boolean;
  call: Anruf;
  dauerhaft?: Promise<unknown>;
}

interface Speicher {
  aktiveAnrufeAlle(): Promise<Anruf[]>;
  getCall(callId: string): Anruf | null | undefined;
  attachActiveCall(callId: string): Promise<Anruf | null | undefined>;
  numberRecordByE164(e164: string): NummernSatz;
  bindInboundElConversation(callId: string, bindung: { conversationId: unknown; nowIso: string; stand?: Anruf }): Bindung;
}

type NummernSatz = Parameters<typeof inboundElPathFor>[0]["numberRecord"];

interface Abhaengigkeiten {
  store: Speicher;
  config: Konfiguration;
  bridges: { clearDeadlines(callId: string): void };
  now: () => number;
  speicherFristMs: number;
  outboundInitInhalt?: ((call: Anruf, vorspann: unknown) => Record<string, unknown>) | undefined;
  vorspannText: (callId: string, tenantId: string) => unknown;
}

type Zaehler = (ip: string | undefined) => { allowed: boolean; retryAfterS: number };
type InitGrund = (typeof INIT_GRUND)[keyof typeof INIT_GRUND];
type Zuordnung = { grund: InitGrund; call: Anruf | null } | { grund: null; call: Anruf };

interface Bindbar {
  call: Anruf;
  conversationId: unknown;
  nowMs: number;
}

interface Dienste {
  store: Speicher;
  config: Konfiguration;
  call: Anruf;
}

export const ELEVENLABS_INIT_PATH = "/webhooks/elevenlabs/init";
export const INIT_TOKEN_HEADER = "x-hermes-init-token";

export const EL_INIT_WIEDERHOLUNG_FRIST_MS = 10000;
export const EL_INIT_SPEICHERN_FRIST_MS = 1000;

export const INIT_ANTWORT = Object.freeze({
  VERWEIGERT: Object.freeze({ error: "verweigert" }),
  GEDROSSELT: Object.freeze({ error: "gedrosselt" }),
  KEIN_ANRUF: Object.freeze({ error: "kein_laufender_anruf" }),
  INTERN: Object.freeze({ error: "intern" }),
});

export const INIT_GRUND = Object.freeze({
  TOKEN: "token",
  KEIN_WARTENDER_ANRUF: "kein_wartender_anruf",
  AGENT: "agent",
  CALLED_NUMBER: "called_number",
  KEIN_EL_WEG: "kein_el_weg",
  EROEFFNUNG: "eroeffnung",
});

const INIT_LOG_TAG = "el-init";
const LOG_SCHLUESSEL_MAX = 20;
const LOG_ZEICHEN_UNERLAUBT = /[^A-Za-z0-9_]/g;
const LOG_ERSATZZEICHEN = "_";
const INIT_KOERPER = z.object({}).passthrough().catch({});
const KEINE_NUMMER: readonly unknown[] = Object.freeze([undefined, null, ""]);
export const INIT_FEHLVERSUCHE_PRO_MIN = 30;
const INIT_HTTP_METHODE = "POST";
const EXAKTER_ROUTER = Object.freeze({ caseSensitive: true, strict: true });

function initTokenGueltig(config: Konfiguration, req: Request): boolean {
  const erwartet = config.voice.elevenLabsInbound.initWebhookToken;
  if (typeof erwartet !== "string" || erwartet.length < INIT_WEBHOOK_TOKEN_MIN_LENGTH) return false;
  return safeEqual(req.get(INIT_TOKEN_HEADER) ?? "", erwartet);
}

function sendeAntwort({ res, status, antwort }: { res: Response; status: number; antwort: unknown }): Response {
  const anruf = typeof res.locals.initAnrufId === "string" ? ` call=${res.locals.initAnrufId}` : "";
  console.log(`[${INIT_LOG_TAG}] antwort${anruf} status=${String(status)}${eroeffnungsFelder(antwort)}`);
  return res.status(status).json(antwort);
}

function verweigern(res: Response): Response {
  console.log(`[${INIT_LOG_TAG}] abgelehnt grund=${INIT_GRUND.TOKEN}`);
  return res.status(HTTP_FORBIDDEN).json(INIT_ANTWORT.VERWEIGERT);
}

export function istInitWebhookAnfrage(req: Request): boolean {
  return req.method === INIT_HTTP_METHODE && req.path === ELEVENLABS_INIT_PATH;
}

function makeDrosselungsMelder({ now, fensterMs }: { now: () => number; fensterMs: number }): () => void {
  const stand = { seitLetzterZeile: 0, letzteZeileMs: Number.NEGATIVE_INFINITY };
  return function meldeDrosselungHoechstensJeFenster() {
    stand.seitLetzterZeile += 1;
    const nowMs = now();
    if (nowMs - stand.letzteZeileMs < fensterMs) return;
    console.log(`[${INIT_LOG_TAG}] gedrosselt anzahl=${String(stand.seitLetzterZeile)}`);
    Object.assign(stand, { seitLetzterZeile: 0, letzteZeileMs: nowMs });
  };
}

export function initTokenSchranke({
  config,
  zaehler,
  now = Date.now,
}: {
  config: Konfiguration;
  zaehler: Zaehler;
  now?: () => number;
}): (req: Request, res: Response, next: () => unknown) => unknown {
  const meldeDrosselung = makeDrosselungsMelder({ now, fensterMs: RATE_WINDOW_MS });
  return function initTokenSchrankeMiddleware(req: Request, res: Response, next: () => unknown): unknown {
    if (initTokenGueltig(config, req)) return next();
    const { allowed, retryAfterS } = zaehler(req.ip);
    if (allowed) return verweigern(res);
    meldeDrosselung();
    return respondTooManyRequests(res, { retryAfterS, body: INIT_ANTWORT.GEDROSSELT });
  };
}

function schluesselFuerLog(body: InitKoerper | null | undefined): string {
  const bereinigt = Object.keys(body ?? {}).map((name) => name.replace(LOG_ZEICHEN_UNERLAUBT, LOG_ERSATZZEICHEN));
  return bereinigt.sort().slice(0, LOG_SCHLUESSEL_MAX).join(",");
}

function keinAnruf({
  res,
  body,
  grund,
  callId = null,
}: {
  res: Response;
  body: InitKoerper | null | undefined;
  grund: string;
  callId?: string | null | undefined;
}): Response {
  const anruf = callId ? ` call=${callId}` : "";
  console.log(
    `[${INIT_LOG_TAG}] abgelehnt grund=${grund} schluessel=${schluesselFuerLog(body)} sip_headers=${sipHeadersFormOf(body)}${anruf}`,
  );
  return sendeAntwort({ res, status: HTTP_NOT_FOUND, antwort: INIT_ANTWORT.KEIN_ANRUF });
}

async function aktiverElInboundCallMitToken(store: Speicher, token: unknown): Promise<Anruf | null> {
  if (!token) return null;
  const calls = await store.aktiveAnrufeAlle();
  return (
    calls.find(
      (call: Anruf) =>
        bridgeStateOf(call) !== BRIDGE_STATE.KEIN_EL_INBOUND &&
        Boolean(call.streamToken) &&
        safeEqual(token, call.streamToken),
    ) ?? null
  );
}

function istWiederholung({ call, conversationId, nowMs }: Bindbar): boolean {
  return (
    bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN &&
    call.elevenlabsConversationId === conversationId &&
    nowMs - Date.parse(call.elBoundAt) < EL_INIT_WIEDERHOLUNG_FRIST_MS
  );
}

function bindbar({ call, conversationId, nowMs }: Bindbar): boolean {
  return bridgeStateOf(call) === BRIDGE_STATE.WARTET || istWiederholung({ call, conversationId, nowMs });
}

function agentPasst(config: Konfiguration, body: InitKoerper): boolean {
  const agentId = config.voice.elevenLabsOutbound.agentId;
  return Boolean(agentId) && body.agent_id === agentId;
}

function calledNumberPasst(body: InitKoerper, call: Anruf): boolean {
  const fehlt = KEINE_NUMMER.includes(body.called_number);
  if (istOutboundElProfil(call)) return !fehlt && normNum(body.called_number) === call.from;
  return fehlt || normNum(body.called_number) === call.to;
}

async function zuordnungFuer({
  store,
  config,
  body,
  nowMs,
}: {
  store: Speicher;
  config: Konfiguration;
  body: InitKoerper;
  nowMs: number;
}): Promise<Zuordnung> {
  const call = await aktiverElInboundCallMitToken(store, callBindingTokenOf(body));
  if (!call) return { grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, call: null };
  if (!bindbar({ call, conversationId: body.conversation_id, nowMs }))
    return { grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, call };
  if (!agentPasst(config, body)) return { grund: INIT_GRUND.AGENT, call };
  if (!calledNumberPasst(body, call)) return { grund: INIT_GRUND.CALLED_NUMBER, call };
  return { grund: null, call };
}

const elWegFuer = ({ store, config, call }: Dienste): boolean =>
  inboundElPathFor({ config, tenantId: call.tenantId, numberRecord: store.numberRecordByE164(call.to) });

const eroeffnungSicher = ({ store, config, call }: Dienste): boolean => inboundEroeffnungsDefekteFuer({ store, config, call }).length === 0;

function bindungsLogZeile({
  bindung,
  call,
  nowMs,
  eingangMs,
}: {
  bindung: Bindung;
  call: Anruf;
  nowMs: number;
  eingangMs: number;
}): string {
  if (!bindung.changed) return `[${INIT_LOG_TAG}] wiederholung call=${call.id}`;
  const zeile = `[${INIT_LOG_TAG}] gebunden call=${call.id} ms_seit_annahme=${String(msSeitAnnahme(call, nowMs))}`;
  if (!istOutboundElProfil(call)) return zeile;
  return `${zeile} ms_bearbeitung=${String(Math.round(performance.now() - eingangMs))}`;
}

function meldeBindung({
  outboundAntwort,
  ...zeile
}: {
  bindung: Bindung;
  call: Anruf;
  nowMs: number;
  eingangMs: number;
  outboundAntwort: Record<string, unknown> | null;
}): void {
  console.log(bindungsLogZeile(zeile));
  if (outboundAntwort && zeile.bindung.changed) meldeFirstMessageErgebnis({ callId: zeile.call.id, antwort: outboundAntwort });
}

function inboundSperrgrundFuer({ store, config, call }: Dienste): InitGrund | null {
  if (istOutboundElProfil(call)) return null;
  if (!elWegFuer({ store, config, call })) return INIT_GRUND.KEIN_EL_WEG;
  if (!eroeffnungSicher({ store, config, call })) return INIT_GRUND.EROEFFNUNG;
  return null;
}

async function outboundAntwortFuer({
  outboundInitInhalt,
  vorspannText,
  call,
}: Pick<Abhaengigkeiten, "outboundInitInhalt" | "vorspannText"> & { call: Anruf }): Promise<Record<string, unknown> | null> {
  if (!istOutboundElProfil(call)) return null;
  if (typeof outboundInitInhalt !== "function") throw new Error("Outbound-Init ohne Inhaltsfabrik");
  return { type: INITIATION_RESPONSE_TYPE, ...outboundInitInhalt(call, await vorspannText(call.id, call.tenantId)) };
}

async function bindungDauerhaft({ dauerhaft, fristMs }: { dauerhaft: unknown; fristMs: number }): Promise<boolean> {
  const abgelaufen = new Promise<never>((_ignoriert, abbrechen) => {
    setTimeout(() => {
      abbrechen(new Error(`Frist von ${String(fristMs)} ms abgelaufen`));
    }, fristMs).unref();
  });
  try {
    return (await Promise.race([dauerhaft, abgelaufen])) !== false;
  } catch {
    console.error(`[${INIT_LOG_TAG}] speichern fehlgeschlagen oder Frist abgelaufen`);
    return true;
  }
}

async function bindungUebernommen({
  bindung,
  bridges,
  callId,
  fristMs,
}: {
  bindung: Bindung;
  bridges: Abhaengigkeiten["bridges"];
  callId: string;
  fristMs: number;
}): Promise<boolean> {
  if (!bindung.changed) return true;
  if (!(await bindungDauerhaft({ dauerhaft: bindung.dauerhaft, fristMs }))) return false;
  bridges.clearDeadlines(callId);
  return true;
}

async function handleInit({ req, res, deps }: { req: Request; res: Response; deps: Abhaengigkeiten }): Promise<unknown> {
  const eingangMs = performance.now();
  const { store, config, bridges, now, outboundInitInhalt, vorspannText, speicherFristMs } = deps;
  if (!initTokenGueltig(config, req)) return verweigern(res);

  const body: InitKoerper = INIT_KOERPER.parse(pruefeKoerper(res, { schema: INIT_KOERPER }, req.body));
  const nowMs = now();
  const zuordnung = await zuordnungFuer({ store, config, body, nowMs });
  if (zuordnung.call) {
    res.locals.initAnrufId = zuordnung.call.id;
    console.log(`[${INIT_LOG_TAG}] eingang call=${zuordnung.call.id}`);
  }
  if (zuordnung.grund) return keinAnruf({ res, body, grund: zuordnung.grund, callId: zuordnung.call?.id });
  const call = zuordnung.call;

  const sperrgrund = inboundSperrgrundFuer({ store, config, call });
  if (sperrgrund) return keinAnruf({ res, body, grund: sperrgrund, callId: call.id });

  const outboundAntwort = await outboundAntwortFuer({ outboundInitInhalt, vorspannText, call });

  if (!(store.getCall(call.id) ?? (await store.attachActiveCall(call.id))))
    return keinAnruf({ res, body, grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, callId: call.id });

  const bindung = store.bindInboundElConversation(call.id, {
    conversationId: body.conversation_id,
    nowIso: new Date(nowMs).toISOString(),
    stand: call,
  });
  if (!bindung.bound) return keinAnruf({ res, body, grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, callId: call.id });

  if (!(await bindungUebernommen({ bindung, bridges, callId: call.id, fristMs: speicherFristMs })))
    return keinAnruf({ res, body, grund: INIT_GRUND.KEIN_WARTENDER_ANRUF, callId: call.id });
  meldeBindung({ bindung, call, nowMs, eingangMs, outboundAntwort });

  const antwort = outboundAntwort ?? buildInitiationResponse({ store, config, call: bindung.call, jetzt: () => new Date() });
  return sendeAntwort({ res, status: HTTP_OK, antwort });
}

function fehlerNachricht(err: unknown): string {
  if (typeof err !== "object" || err === null || !("message" in err)) return "";
  return typeof err.message === "string" ? err.message : "";
}

async function antworteInitSicher({ req, res, deps }: { req: Request; res: Response; deps: Abhaengigkeiten }): Promise<unknown> {
  try {
    return await handleInit({ req, res, deps });
  } catch (err) {
    console.error(`[${INIT_LOG_TAG}] fehler: ${fehlerNachricht(err) || "unbekannt"}`);
    if (res.headersSent) return res.end();
    return sendeAntwort({ res, status: HTTP_SERVER_ERROR, antwort: INIT_ANTWORT.INTERN });
  }
}

export function makeElevenLabsInitWebhookRoutes({
  store,
  config,
  bridges,
  now = Date.now,
  speicherFristMs = EL_INIT_SPEICHERN_FRIST_MS,
  outboundInitInhalt,
  vorspannText,
}: Omit<Abhaengigkeiten, "now" | "speicherFristMs"> & { now?: () => number; speicherFristMs?: number }): Router {
  const router = Router(EXAKTER_ROUTER);
  const deps = { store, config, bridges, now, speicherFristMs, outboundInitInhalt, vorspannText };

  router.post(ELEVENLABS_INIT_PATH, (req: Request, res: Response, next: NextFunction): void => {
    antworteInitSicher({ req, res, deps }).catch(next);
  });

  return router;
}
