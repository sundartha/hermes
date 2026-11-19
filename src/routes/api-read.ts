import { Router } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { publicCall, activeNumberFor, numberStatusFor, upcomingCalendar } from "../store/views.ts";
import type { AnrufSicht, Zustand } from "../store/views.ts";
import { tenantQuotaView, planUsagePercent } from "../billing/meter.js";
import { internalOnly } from "../utils/vertrauter-aufruf.ts";
import { antworteFehler, HTTP_NOT_FOUND } from "../utils/http.ts";
import { monthStart } from "../utils/month.js";
import { speicherBereiche } from "../store.js";

interface Speicher {
  load: () => Zustand;
  getCalendar: (tenantId: string) => { end: string }[];
  usageOf: (tenantId: string) => { inputTokens: number; outputTokens: number; calls: number };
  getCall: (id: string | undefined) => unknown;
  leseCallUngebunden: (id: string) => Promise<AnrufSicht | null | undefined>;
  einstellungenNachladen?: (tenantId: string) => unknown;
  leitungsplaetze?: { belegteAnrufe: (callIds: string[]) => Promise<Set<string>> };
}

type AnrufAnsicht = AnrufSicht;

interface AnrufAuszug {
  calls: AnrufSicht[];
  actionItems: unknown[];
  notifications: unknown[];
}

interface Bereiche {
  mandant: {
    tenantContext: (tenantId: string) => Promise<{ settings: unknown; ownerName: unknown }>;
  };
  zustandAnrufe: {
    anrufeFuerZustand: (tenantId: string, limit: number) => Promise<AnrufSicht[]>;
    anzahlSeit: (tenantId: string, seitIso: string) => Promise<number>;
  };
  konto: {
    exportTenantData: (tenantId: string) => Promise<AnrufAuszug>;
    exportTenantDataGelesen: (tenantId: string) => Promise<AnrufAuszug>;
  };
}

interface Konfiguration {
  llm: { claudeModel: string };
  voice: { voiceEngine: string };
}

type Protokoll = (aktion: string, req: Request, detail: string) => unknown;

interface Mandant {
  requestTenant: (req: Request) => string;
  requireTenant: (req: Request, res: Response) => string | null | undefined;
  tenantOwnsCall: (call: unknown, tenantId: string) => boolean;
}

const aktiveNummerVon: (state: Zustand, tenantId: string) => string = activeNumberFor;
const kalenderAb: (store: Speicher, tenantId: string) => unknown[] = upcomingCalendar;

export const STATE_CALLS = 30,
  STATE_ACTION_ITEMS = 50,
  STATE_CALENDAR = 10,
  STATE_NOTIFICATIONS = 10;

function usageView({
  usage,
  quota,
  callsThisMonth,
}: {
  usage: { inputTokens: number; outputTokens: number; calls: number };
  quota: unknown;
  callsThisMonth: number;
}): object {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    calls: usage.calls,
    callsThisMonth,
    planUsagePercent: planUsagePercent(quota),
  };
}

const anrufKennung = (anruf: AnrufAnsicht): string => String(anruf["id"]);

const wartetMoeglich = (anruf: AnrufAnsicht): boolean =>
  anruf["direction"] === "outbound" && anruf["status"] === "active" && !anruf["answeredAt"] && !anruf["callControlId"];

async function markiereWartende<T extends AnrufAnsicht>(store: Speicher, anrufe: T[]): Promise<T[]> {
  const kandidaten = anrufe.filter(wartetMoeglich).map(anrufKennung);
  if (!store.leitungsplaetze || kandidaten.length === 0) return anrufe;
  try {
    const mitPlatz = await store.leitungsplaetze.belegteAnrufe(kandidaten);
    const wartend = new Set(kandidaten.filter((kennung) => !mitPlatz.has(kennung)));
    return anrufe.map((anruf) => (wartend.has(anrufKennung(anruf)) ? { ...anruf, queued: true } : anruf));
  } catch (fehler) {
    console.error("[api-read] Leitungsplaetze nicht lesbar, Anrufe ohne queued:", fehler instanceof Error ? fehler.message : fehler);
    return anrufe;
  }
}

async function zeigeZustand({
  store,
  bereiche,
  config,
  tenantId,
  res,
}: {
  store: Speicher;
  bereiche: Bereiche;
  config: Konfiguration;
  tenantId: string;
  res: Response;
}): Promise<void> {
  const ctx = await bereiche.mandant.tenantContext(tenantId);
  const scoped = await bereiche.konto.exportTenantData(tenantId);
  const anrufe = await bereiche.zustandAnrufe.anrufeFuerZustand(tenantId, STATE_CALLS);
  const jetzt = new Date();
  const monatsanfang = monthStart(jetzt);
  const callsThisMonth = await bereiche.zustandAnrufe.anzahlSeit(tenantId, monatsanfang.toISOString());
  const s = store.load();
  res.json({
    settings: ctx.settings,
    calls: await markiereWartende(store, anrufe.map(publicCall)),
    actionItems: scoped.actionItems.slice(0, STATE_ACTION_ITEMS),
    calendar: kalenderAb(store, tenantId).slice(0, STATE_CALENDAR),
    usage: usageView({
      usage: store.usageOf(tenantId),
      quota: tenantQuotaView(store, tenantId),
      callsThisMonth,
    }),
    notifications: scoped.notifications.slice(0, STATE_NOTIFICATIONS),
    agent: {
      number: aktiveNummerVon(s, tenantId),
      numberStatus: numberStatusFor(s, tenantId),
      owner: ctx.ownerName,
      model: config.llm.claudeModel,
      voiceEngine: config.voice.voiceEngine,
    },
  });
}

async function zeigeAnruf({
  store,
  tenant,
  callId,
  tenantId,
  res,
}: {
  store: Speicher;
  tenant: Mandant;
  callId: string;
  tenantId: string;
  res: Response;
}): Promise<void> {
  const call = await store.leseCallUngebunden(callId);
  if (!call || !tenant.tenantOwnsCall(call, tenantId)) {
    antworteFehler(res, HTTP_NOT_FOUND, "not found");
    return;
  }
  res.json((await markiereWartende(store, [publicCall(call)]))[0]);
}

async function zeigeExport({
  bereiche,
  audit,
  req,
  res,
  tenantId,
}: {
  bereiche: Bereiche;
  audit: Protokoll;
  req: Request;
  res: Response;
  tenantId: string;
}): Promise<void> {
  const data = await bereiche.konto.exportTenantDataGelesen(tenantId);
  audit(
    "data_export",
    req,
    `calls=${String(data.calls.length)} actionItems=${String(data.actionItems.length)} notifications=${String(data.notifications.length)}`,
  );
  res.json({ ...data, calls: data.calls.map(publicCall) });
}

export function makeReadRoutes({
  store,
  config,
  audit,
  tenant,
  neuerBegrenzer = (): RequestHandler =>
    (_req: Request, _res: Response, next: NextFunction) => {
      next();
    },
}: {
  store: Speicher;
  config: Konfiguration;
  audit: Protokoll;
  tenant: Mandant;
  neuerBegrenzer?: () => RequestHandler;
}): Router {
  const { requestTenant, requireTenant } = tenant;
  const router = Router();
  const bereiche = speicherBereiche(store);

  const einstellungenNachladen = (req: Request, _res: Response, next: NextFunction): void => {
    Promise.resolve(store.einstellungenNachladen?.(requestTenant(req))).then(() => {
      next();
    }, next);
  };

  router.get(
    "/api/state",
    internalOnly,
    neuerBegrenzer(),
    einstellungenNachladen,
    (req, res, next) => {
      zeigeZustand({ store, bereiche, config, tenantId: requestTenant(req), res }).catch(next);
    },
  );

  router.get("/api/calls/:id", internalOnly, (req, res, next) => {
    zeigeAnruf({ store, tenant, callId: req.params.id, tenantId: requestTenant(req), res }).catch(next);
  });

  router.get("/api/tenant-data/export", internalOnly, neuerBegrenzer(), (req, res, next) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    zeigeExport({ bereiche, audit, req, res, tenantId }).catch(next);
  });

  return router;
}
