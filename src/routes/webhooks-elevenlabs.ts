import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { blockingBudgetAxisFrisch } from "../budget-gate.js";
import { consultAllowedForCall } from "../consult/gate.ts";
import { MAX_IN_CALL_CONSULTS_PER_CALL } from "../consult/in-call.js";
import { CONSULT_RESULT } from "../conversation/consult-raised.js";
import { TENANT_TOKEN_VERDICT, tenantTokenVerdict } from "../elevenlabs/tenant-tool-token.ts";
import { localeFor } from "../i18n/locales.ts";
import { bookLookupSearchFee } from "../llm-usage.js";
import { lookupFactsFrom, sanitizeLookupQuery } from "../research/lookup-guard.ts";
import {
  LOOKUP_MAX_PER_CALL,
  elevenLabsLookupProviderFor,
} from "../research/registry.js";
import { speicherBereiche } from "../store.js";
import { consultQuotaUsed, elevenLabsLookupCount } from "../store/state-ops.js";
import { safeEqual } from "../util.ts";
import {
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_PAYMENT_REQUIRED,
  HTTP_SERVER_ERROR,
  antworteFehler,
} from "../utils/http.ts";
import { pruefeKoerper } from "../utils/eingabe-pruefen.js";
import type { TranscriptLine } from "../utils/text.ts";

export const ELEVENLABS_CONSULT_PATH = "/webhooks/elevenlabs/consult";
export const ELEVENLABS_LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const CONSULT_LOG_TAG = "el-consult";
const LOOKUP_LOG_TAG = "el-lookup";
const EL_LOOKUP_TIMEOUT_MS = 6000;

const CONSULT_TIMEOUT_AUDIT_ACTION = "consult_timeout";

const DENIAL_NO_ADDRESSABLE_CALL = "kein_laufender_anruf";

const KEIN_TEXT = "";
const TOOL_FELDER = z.object({
  conversation_id: z.string().catch(KEIN_TEXT),
  tenant_token: z.string().catch(KEIN_TEXT),
  query: z.string().catch(KEIN_TEXT),
  question: z.string().catch(KEIN_TEXT),
});
const TOOL_KOERPER = TOOL_FELDER.catch(TOOL_FELDER.parse({}));

interface Sprachtexte {
  prompt: {
    turnControl: {
      consultDeclined: string;
      consultTimeout: string;
      lookUpDeclinedSpoken: string;
      lookUpUnavailable: string;
      lookUpFactsFrame: string;
    };
  };
}

type TurnControl = Sprachtexte["prompt"]["turnControl"];

interface AbbruchSpur {
  consultId: string;
  holdMs: number;
  deliveredAfterMs: number | null;
  ackedAfterMs: number | null;
}

type KonsultErgebnis =
  | { kind: string; facts: string[]; reason?: string | null; abortTrace?: null }
  | { kind: string; facts: string[]; reason: string; abortTrace: AbbruchSpur };

interface Anruf {
  id: string;
  tenantId: string;
  language: string;
  direction: string;
  status: string;
  to?: unknown;
  transcript?: TranscriptLine[] | null;
  elevenlabsConversationId?: unknown;
}

interface Speicher {
  aktiveAnrufeAlle(): Promise<Anruf[]>;
  getCall(callId: string): Anruf | null | undefined;
  attachActiveCall(callId: string): Promise<Anruf | null | undefined>;
  resolveProfile: (tenantId: string) => unknown;
  recordCallLookup(callId: string, query: string): number;
  countCallLookup(callId: string): Promise<number>;
}

interface Konfiguration {
  voice: { elevenLabsToolToken?: unknown; elevenLabsTenantTokenRequired?: unknown };
  tenancy: { inCallConsultEnabled?: unknown };
  billing: unknown;
}

interface Suchergebnis {
  ok: unknown;
  facts?: unknown;
}

interface Suchanbieter {
  searchFacts(anfrage: { query: string; timeoutMs: number }): Promise<Suchergebnis>;
}

interface KonsultPlaetze {
  withOpenSlot(
    callId: string,
    tenantId: string,
    run: () => Promise<KonsultErgebnis>,
  ): Promise<{ granted: false } | { granted: true; value: KonsultErgebnis }>;
}

type AuditFuer = (tenantId: string) => (aktion: string, ziel: null, detail: string) => unknown;

interface Koerper {
  conversation_id: string;
  tenant_token: string;
  query: string;
  question: string;
}

type Bindung =
  | { call: Anruf; logGrund: null; callId: string }
  | { call: null; logGrund: string; callId: string | null };

interface Abgelehnt {
  res: Response;
  tag: string;
  status: number;
  logGrund: string;
  antwortGrund?: string;
  callId?: string | null;
}

type Handler = (req: Request, res: Response) => unknown;

const sprachtexteFuer: (language: string) => Sprachtexte = localeFor;

function fehlerText(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unbekannt";
  const stack = "stack" in err && typeof err.stack === "string" ? err.stack : "";
  const nachricht = "message" in err && typeof err.message === "string" ? err.message : "";
  return stack || nachricht || "unbekannt";
}

function toolResultText(outcome: KonsultErgebnis, locale: Sprachtexte): string {
  const control = locale.prompt.turnControl;
  if (outcome.kind === CONSULT_RESULT.REJECTED) return control.consultDeclined;
  return outcome.facts.length ? outcome.facts.join(" ") : control.consultTimeout;
}

function consultResponseBody(
  outcome: KonsultErgebnis,
  locale: Sprachtexte,
): { status: string; reason: string | null; answer: string } {
  return {
    status: outcome.kind,
    reason: outcome.reason ?? null,
    answer: toolResultText(outcome, locale),
  };
}

function consultTimeoutDetail(callId: string, reason: string, trace: AbbruchSpur): string {
  const felder = [
    `call=${callId}`,
    `consult=${trace.consultId}`,
    `grund=${reason}`,
    `halt_ms=${String(trace.holdMs)}`,
  ];
  if (trace.deliveredAfterMs !== null) felder.push(`zugestellt_nach_ms=${String(trace.deliveredAfterMs)}`);
  if (trace.ackedAfterMs !== null) felder.push(`quittiert_nach_ms=${String(trace.ackedAfterMs)}`);
  return felder.join(" ");
}

function traceConsultAbort({
  call,
  outcome,
  auditFor,
}: {
  call: Anruf;
  outcome: KonsultErgebnis;
  auditFor: AuditFuer;
}): void {
  if (!outcome.abortTrace) return;
  auditFor(call.tenantId)(
    CONSULT_TIMEOUT_AUDIT_ACTION,
    null,
    consultTimeoutDetail(call.id, outcome.reason, outcome.abortTrace),
  );
}

async function activeCallBoundTo(store: Speicher, conversationId: string): Promise<Anruf | null> {
  if (!conversationId) return null;
  const calls = await store.aktiveAnrufeAlle();
  return calls.find((call) => call.elevenlabsConversationId === conversationId) ?? null;
}

function toolDenied({ res, tag, status, logGrund, antwortGrund = logGrund, callId = null }: Abgelehnt): unknown {
  console.log(`[${tag}] abgelehnt grund=${logGrund}${callId ? ` call=${callId}` : ""}`);
  return antworteFehler(res, status, antwortGrund);
}

function denyBoundCall({
  res,
  tag,
  logGrund,
  callId = null,
}: {
  res: Response;
  tag: string;
  logGrund: string;
  callId?: string | null;
}): unknown {
  return toolDenied({
    res,
    tag,
    status: HTTP_NOT_FOUND,
    logGrund,
    antwortGrund: DENIAL_NO_ADDRESSABLE_CALL,
    callId,
  });
}

async function boundCallFor({
  store,
  config,
  koerper,
}: {
  store: Speicher;
  config: Konfiguration;
  koerper: Koerper;
}): Promise<Bindung> {
  const call = await activeCallBoundTo(store, koerper.conversation_id);
  if (!call) return { call: null, logGrund: "kein_laufender_anruf", callId: null };
  const urteil = tenantTokenVerdict({
    secret: config.voice.elevenLabsToolToken,
    tenantId: call.tenantId,
    presented: koerper.tenant_token,
  });
  const zugelassen =
    urteil === TENANT_TOKEN_VERDICT.PASSEND ||
    (urteil === TENANT_TOKEN_VERDICT.FEHLT && config.voice.elevenLabsTenantTokenRequired !== true);
  if (!zugelassen) return { call: null, logGrund: `mandant_${urteil}`, callId: call.id };
  const angehaengt = store.getCall(call.id) ?? (await store.attachActiveCall(call.id));
  if (!angehaengt) return { call: null, logGrund: "kein_laufender_anruf", callId: call.id };
  return { call: angehaengt, logGrund: null, callId: call.id };
}

function lookupAnswer(
  res: Response,
  { callId, status, answer }: { callId: string; status: string; answer: string },
): Response {
  console.log(`[${LOOKUP_LOG_TAG}] call=${callId} ergebnis=${status}`);
  return res.json({ status, answer });
}

function lookupPayloadQuery(koerper: Koerper): string | null {
  return koerper.query.trim() ? koerper.query : null;
}

function preflightLookup({
  call,
  query,
  control,
  res,
}: {
  call: Anruf;
  query: string;
  control: TurnControl;
  res: Response;
}): { done: Response; sanitized?: undefined } | { sanitized: string; done?: undefined } {
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

async function executeLookup({
  store,
  call,
  provider,
  query,
  control,
  res,
}: {
  store: Speicher;
  call: Anruf;
  provider: Suchanbieter;
  query: string;
  control: TurnControl;
  res: Response;
}): Promise<unknown> {
  const gezaehlt = await store.countCallLookup(call.id);
  if (gezaehlt > LOOKUP_MAX_PER_CALL) {
    console.log(`[${LOOKUP_LOG_TAG}] abgelehnt grund=kontingent call=${call.id}`);
    return lookupAnswer(res, { callId: call.id, status: "declined", answer: control.lookUpDeclinedSpoken });
  }
  const bereiche = speicherBereiche(store);
  const seq = store.recordCallLookup(call.id, query);
  bookLookupSearchFee({ tenantId: call.tenantId });
  const startedAt = Date.now();
  const result = await provider.searchFacts({ query, timeoutMs: EL_LOOKUP_TIMEOUT_MS });
  const facts = result.ok ? lookupFactsFrom(result.facts) : [];
  const dauerMs = Date.now() - startedAt;
  await bereiche.recherche.finishCallLookup(call.id, seq, {
    ok: result.ok === true,
    factCount: facts.length,
    dauerMs,
  });
  console.log(
    `[${LOOKUP_LOG_TAG}] fertig call=${call.id} ok=${String(result.ok === true)} dauer_ms=${String(dauerMs)} fakten=${String(facts.length)}`,
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

async function handleLookup(
  req: Request,
  res: Response,
  { store, config }: { store: Speicher; config: Konfiguration },
): Promise<unknown> {
  const secret = config.voice.elevenLabsToolToken;
  if (!secret || !safeEqual(req.get(TOOL_TOKEN_HEADER) ?? "", secret))
    return toolDenied({ res, tag: LOOKUP_LOG_TAG, status: HTTP_FORBIDDEN, logGrund: "token" });

  const koerper = TOOL_KOERPER.parse(pruefeKoerper(res, { schema: TOOL_KOERPER }, req.body));
  const bindung = await boundCallFor({ store, config, koerper });
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

  const budgetAxis = await blockingBudgetAxisFrisch({
    store,
    billing: config.billing,
    tenantId: call.tenantId,
  });
  if (budgetAxis)
    return toolDenied({
      res,
      tag: LOOKUP_LOG_TAG,
      status: HTTP_PAYMENT_REQUIRED,
      logGrund: budgetAxis,
    });

  const query = lookupPayloadQuery(koerper);
  if (!query)
    return toolDenied({
      res,
      tag: LOOKUP_LOG_TAG,
      status: HTTP_BAD_REQUEST,
      logGrund: "keine_anfrage",
    });

  const control = sprachtexteFuer(call.language).prompt.turnControl;
  const preflight = preflightLookup({ call, query, control, res });
  if (preflight.done) return preflight.done;

  return executeLookup({ store, call, provider, query: preflight.sanitized, control, res });
}

async function antworteSicher({
  tag,
  handler,
  req,
  res,
}: {
  tag: string;
  handler: Handler;
  req: Request;
  res: Response;
}): Promise<unknown> {
  try {
    return await handler(req, res);
  } catch (err) {
    console.error(`[${tag}] fehler: ${fehlerText(err)}`);
    if (res.headersSent) return res.end();
    return antworteFehler(res, HTTP_SERVER_ERROR, "intern");
  }
}

export function makeElevenLabsWebhookRoutes({
  store,
  config,
  onConsultRaised,
  consultSlots,
  auditFor,
}: {
  store: Speicher;
  config: Konfiguration;
  onConsultRaised: (anfrage: { callId: string; question: string }) => Promise<KonsultErgebnis>;
  consultSlots: KonsultPlaetze;
  auditFor: AuditFuer;
}): Router {
  const router = Router();

  function consultAllowed(call: Anruf): boolean {
    return (
      config.tenancy.inCallConsultEnabled === true &&
      consultAllowedForCall(call, store.resolveProfile(call.tenantId)) &&
      call.direction === "outbound" &&
      consultQuotaUsed(call) < MAX_IN_CALL_CONSULTS_PER_CALL
    );
  }

  function payloadQuestion(koerper: Koerper): string | null {
    return koerper.question.trim() ? koerper.question : null;
  }

  async function handleConsult(req: Request, res: Response): Promise<unknown> {
    const secret = config.voice.elevenLabsToolToken;
    if (!secret || !safeEqual(req.get(TOOL_TOKEN_HEADER) ?? "", secret))
      return toolDenied({ res, tag: CONSULT_LOG_TAG, status: HTTP_FORBIDDEN, logGrund: "token" });

    const koerper = TOOL_KOERPER.parse(pruefeKoerper(res, { schema: TOOL_KOERPER }, req.body));
    const bindung = await boundCallFor({ store, config, koerper });
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

    const budgetAxis = await blockingBudgetAxisFrisch({
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

    const question = payloadQuestion(koerper);
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
    return res.json(consultResponseBody(outcome, sprachtexteFuer(call.language)));
  }

  router.post(ELEVENLABS_CONSULT_PATH, (req: Request, res: Response, next: NextFunction): void => {
    antworteSicher({ tag: CONSULT_LOG_TAG, handler: handleConsult, req, res }).catch(next);
  });


  router.post(ELEVENLABS_LOOKUP_PATH, (req: Request, res: Response, next: NextFunction): void => {
    const handler = (rq: Request, rs: Response): Promise<unknown> => handleLookup(rq, rs, { store, config });
    antworteSicher({ tag: LOOKUP_LOG_TAG, handler, req, res }).catch(next);
  });

  return router;
}
