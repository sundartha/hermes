// Self-Service-Routen (I9 + #3 Konvergenz): web-session-only. Der Kunde kommt
// ueber den OIDC-Browser-Login (Feature B) -> webAuthMw setzt req.tenant (fail-
// closed: kein/ungueltiges Cookie 401, suspendierter Tenant 403). KEIN
// X-Internal-Identity / requireTenant mehr. tenant = req.tenant.tenantId
// (= account.tenant_id = t_<sub>, gleiche Identitaetsquelle wie der Mirror-Bucket).
//
// Als Factory (wie makeWebAuthRoutes/makeAdminRoutes in web-auth.js): store, webAuthMw
// und audit injiziert (DIP) -> derselbe Handler in Produktion (server.js) UND im
// in-process pglite-Test, ohne Replik (G5) und ohne TDZ auf server.js-Modul-Helfer.
//
// STRENGER als POST /api/settings (Admin): Lesen ueber die tenant-gefilterte Quelle
// exportTenantData; Schreiben ueber die engere Whitelist selfServicePatch VOR
// store.updateSettings (greeting nur als Vorlage; Permission-Flags nur restriktiver;
// alles andere abgelehnt). updateSettings bleibt UNVERAENDERT.
import { Router } from "express";
import { selfServicePatch, GREETING_TEMPLATES } from "./self-service.js";
import { publicCall, activeNumberFor, upcomingCalendar } from "./store/views.js";

export function makeSelfServiceRoutes({ store, webAuthMw, audit }) {
  const router = Router();

  // Tenant-Lese-Sicht: dieselbe tenant-gefilterte Quelle wie /api/state, aber NUR
  // ueber die Web-Session-Identitaet. + die kuratierten greeting-Vorlagen, damit die
  // UI ein Dropdown statt Freitext zeigt (Decision #7).
  router.get("/api/self-service/state", webAuthMw, (req, res) => {
    const tenant = req.tenant.tenantId;
    const data = store.exportTenantData(tenant);
    const ctx = store.tenantContext(tenant);
    res.json({
      settings: ctx.settings,
      greetingTemplates: GREETING_TEMPLATES,
      calls: data.calls.map(publicCall),
      actionItems: data.actionItems,
      calendar: upcomingCalendar(store, tenant),
      agent: { number: activeNumberFor(store.load(), tenant), owner: ctx.ownerName },
    });
  });

  // Self-Service-Settings-Schreiben: ENGERE Whitelist (selfServicePatch) DAVOR, dann
  // die bestehende strenge updateSettings (Key/Typ). Nur Keys auditieren (greeting-
  // Wert/PII gehoeren nicht ins Log, wie /api/settings).
  router.post("/api/self-service/settings", webAuthMw, (req, res) => {
    const tenant = req.tenant.tenantId;
    const current = store.tenantContext(tenant).settings;
    const { clean, rejected } = selfServicePatch(req.body || {}, current);
    const { settings, changed } = store.updateSettings(tenant, clean);
    audit("self_service_settings", req, `keys=${changed.join(",") || "-"} rejected=${rejected.join(",") || "-"}`);
    res.json(settings);
  });

  return router;
}
