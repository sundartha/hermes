import { Router } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { publicCall, activeNumberFor, numberStatusFor, upcomingCalendar } from "../store/views.js";
import { tenantQuotaView, planUsagePercent } from "../billing/meter.js";
import { internalOnly } from "../wiring/internal-only.js";
import { antworteFehler, HTTP_NOT_FOUND } from "../utils/http.ts";
import { speicherBereiche } from "../store.js";

interface Speicher {
  load: () => unknown;
  usageOf: (tenantId: string) => { inputTokens: number; outputTokens: number; calls: number };
  getCall: (id: string | undefined) => unknown;
  leseCallUngebunden: (id: string) => Promise<unknown>;
  einstellungenNachladen?: (tenantId: string) => unknown;
}

interface AnrufAuszug {
  calls: unknown[];
  actionItems: unknown[];
  notifications: unknown[];
}

interface Bereiche {
  mandant: { tenantContext: (tenantId: string) => Promise<{ settings: unknown; ownerName: unknown }> };
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

const aktiveNummerVon: (state: unknown, tenantId: string) => string = activeNumberFor;
const kalenderAb: (store: unknown, tenantId: string) => unknown[] = upcomingCalendar;

export const STATE_CALLS = 30,
  STATE_ACTION_ITEMS = 50,
  STATE_CALENDAR = 10,
  STATE_NOTIFICATIONS = 10;

function usageView({
  usage,
  quota,
}: {
  usage: { inputTokens: number; outputTokens: number; calls: number };
  quota: unknown;
}): object {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    calls: usage.calls,
    planUsagePercent: planUsagePercent(quota),
  };
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
  const s = store.load();
  res.json({
    settings: ctx.settings,
    calls: scoped.calls.slice(0, STATE_CALLS).map(publicCall),
    actionItems: scoped.actionItems.slice(0, STATE_ACTION_ITEMS),
    calendar: kalenderAb(store, tenantId).slice(0, STATE_CALENDAR),
    usage: usageView({
      usage: store.usageOf(tenantId),
      quota: tenantQuotaView(store, tenantId),
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
  res.json(publicCall(call));
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
