import { Router } from "express";
import { publicCall, activeNumberFor, numberStatusFor, upcomingCalendar } from "../store/views.js";
import { tenantQuotaView, planUsagePercent } from "../billing/meter.js";
import { internalOnly } from "../wiring/internal-only.js";

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

export function makeReadRoutes({ store, config, audit, tenant }) {
  const { requestTenant, requireTenant, tenantOwnsCall } = tenant;
  const router = Router();

  router.get("/api/state", internalOnly, (req, res) => {
    const s = store.load();
    const tenantId = requestTenant(req);
    const ctx = store.tenantContext(tenantId);

    const scoped = store.exportTenantData(tenantId);

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
  });

  router.get("/api/calls/:id", internalOnly, (req, res) => {
    const call = store.getCall(req.params.id);
    if (!call) return res.status(404).json({ error: "not found" });
    if (!tenantOwnsCall(call, requestTenant(req)))
      return res.status(404).json({ error: "not found" });
    res.json(publicCall(call));
  });

  router.get("/api/tenant-data/export", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const data = store.exportTenantData(tenantId);
    audit(
      "data_export",
      req,
      `calls=${data.calls.length} actionItems=${data.actionItems.length} notifications=${data.notifications.length}`,
    );
    res.json({ ...data, calls: data.calls.map(publicCall) });
  });

  return router;
}
