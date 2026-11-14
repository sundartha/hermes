import { Router } from "express";
import { publicCall, activeNumberFor, numberStatusFor, upcomingCalendar } from "../store/views.js";
import { tenantQuotaView, planUsagePercent } from "../billing/meter.js";
import { internalOnly } from "../wiring/internal-only.js";
import { antworteFehler, HTTP_NOT_FOUND } from "../utils/http.ts";
import { speicherBereiche } from "../store.js";

export const STATE_CALLS = 30,
  STATE_ACTION_ITEMS = 50,
  STATE_CALENDAR = 10,
  STATE_NOTIFICATIONS = 10;

function usageView({ usage, quota }) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    calls: usage.calls,
    planUsagePercent: planUsagePercent(quota),
  };
}

async function zeigeZustand({ store, bereiche, config, tenantId, res }) {
  const ctx = await bereiche.mandant.tenantContext(tenantId);
  const scoped = await bereiche.konto.exportTenantData(tenantId);
  const s = store.load();
  res.json({
    settings: ctx.settings,
    calls: scoped.calls.slice(0, STATE_CALLS).map(publicCall),
    actionItems: scoped.actionItems.slice(0, STATE_ACTION_ITEMS),
    calendar: upcomingCalendar(store, tenantId).slice(0, STATE_CALENDAR),
    usage: usageView({
      usage: store.usageOf(tenantId),
      quota: tenantQuotaView(store, tenantId),
    }),
    notifications: scoped.notifications.slice(0, STATE_NOTIFICATIONS),
    agent: {
      number: activeNumberFor(s, tenantId),
      numberStatus: numberStatusFor(s, tenantId),
      owner: ctx.ownerName,
      model: config.llm.claudeModel,
      voiceEngine: config.voice.voiceEngine,
    },
  });
}

async function zeigeExport({ bereiche, audit, req, res, tenantId }) {
  const data = await bereiche.konto.exportTenantData(tenantId);
  audit(
    "data_export",
    req,
    `calls=${data.calls.length} actionItems=${data.actionItems.length} notifications=${data.notifications.length}`,
  );
  res.json({ ...data, calls: data.calls.map(publicCall) });
}

export function makeReadRoutes({ store, config, audit, tenant }) {
  const { requestTenant, requireTenant, tenantOwnsCall } = tenant;
  const router = Router();
  const bereiche = speicherBereiche(store);

  const einstellungenNachladen = (req, _res, next) =>
    Promise.resolve(store.einstellungenNachladen?.(requestTenant(req))).then(() => next(), next);

  router.get("/api/state", internalOnly, einstellungenNachladen, (req, res, next) => {
    zeigeZustand({ store, bereiche, config, tenantId: requestTenant(req), res }).catch(next);
  });

  router.get("/api/calls/:id", internalOnly, (req, res) => {
    const call = store.getCall(req.params.id);
    if (!call) return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    if (!tenantOwnsCall(call, requestTenant(req)))
      return antworteFehler(res, HTTP_NOT_FOUND, "not found");
    res.json(publicCall(call));
  });

  router.get("/api/tenant-data/export", internalOnly, (req, res, next) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    zeigeExport({ bereiche, audit, req, res, tenantId }).catch(next);
  });

  return router;
}
