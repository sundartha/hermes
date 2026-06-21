// ---- makeReadRoutes (Phase 3) ---------------------------------------------------
// Extrahierte Read-/Export-Route-Gruppe (GET /api/state, GET /api/calls/:id,
// GET /api/tenant-data/export) als Factory mit Dependency-Injection - gleiches
// Muster wie makeProfileRoutes/makeWebAuthRoutes/makeSelfServiceRoutes (web-auth.js
// ist die bewaehrte Vorlage). Teil der laufenden server.js-Decomposition
// (t4-server-decomposition.md, Phase 3): EINE kohaerente Route-Gruppe,
// behavior-preserving (reine Verschiebung, keine Logik-Aenderung).
//
// Hinter der bestehenden /api/*-Basic-Auth (server.js deckt /api/* ab). Die View-
// Helfer (publicCall/upcomingCalendar/activeNumberFor) kommen direkt aus store/views
// (eine Quelle, G5 - kein Mismatch zwischen Server- und Self-Service-Antworten).
// OWNER_TENANT_ID ist eine Konstante aus store/defaults (direkt importiert wie die
// Views, nicht injiziert).
import { Router } from "express";
import { OWNER_TENANT_ID } from "../store/defaults.js";
import { publicCall, activeNumberFor, upcomingCalendar } from "../store/views.js";

// Anzeige-Slices fuer /api/state (Bestand): neueste N Calls/ActionItems/Termine/
// Notifications. Benannte Konstanten statt nackter Zahlen im Slice (G25).
export const STATE_CALLS = 30, STATE_ACTION_ITEMS = 50, STATE_CALENDAR = 10, STATE_NOTIFICATIONS = 10;

// deps: { store, config, audit, tenant }. store traegt load/tenantContext/
// exportTenantData/getCall/usageOf (+ getCalendar via upcomingCalendar). config ist
// das globale Config-Objekt. audit ist util.audit (loggt nur Keys/Counts, keine
// PII/Werte). tenant buendelt die request-tenant-Resolver: requestTenant (Flag aus
// -> OWNER_TENANT_ID), requireTenant (tenant-gescopt; REJECT -> 403) und
// tenantOwnsCall (Ownership-Praedikat, eine Quelle wie POST /api/calls/:id/cancel).
export function makeReadRoutes({ store, config, audit, tenant }) {
  const { requestTenant, requireTenant, tenantOwnsCall } = tenant;
  const router = Router();

  // Gesamter Zustand fuers Dashboard (Polling) + MCP-Tools. Tenant-gescoped hinter
  // MULTI_TENANT (Flag aus -> requestTenant === OWNER_TENANT_ID + ungefilterte Listen
  // wie im Bestand, inkl. Legacy-Calls ohne tenantId -> byte-identisch). Die lesenden
  // MCP-Tools (list_calls/list_action_items/get_my_number/get_agent_status) erben das
  // Scoping AUTOMATISCH ueber diese Route (mcp-tools.js unveraendert).
  router.get("/api/state", (req, res) => {
    const s = store.load();
    const tenantId = requestTenant(req);
    const ctx = store.tenantContext(tenantId);

    // Listen-Scope ueber die EINE Quelle (tenantCallScope via exportTenantData):
    // calls/actionItems/notifications EINES Tenants. Flag aus -> ungefiltert
    // (Bestand). Danach die Bestands-Slices.
    const scoped = config.multiTenant ? store.exportTenantData(tenantId) : s;
    // Owner-Privatnummer ist Owner-PII -> nur in der Owner-Sicht, sonst leer.
    const isOwnerView = !config.multiTenant || tenantId === OWNER_TENANT_ID;

    res.json({
      // settings/calendar/usage sind seit I2/P4 Maps tenantId -> Bucket; tenantContext
      // /usageOf liefern den Bucket des Request-Tenants (Owner-Bucket bei Flag aus).
      settings: ctx.settings,
      calls: scoped.calls.slice(0, STATE_CALLS).map(publicCall),
      actionItems: scoped.actionItems.slice(0, STATE_ACTION_ITEMS),
      calendar: upcomingCalendar(store, tenantId).slice(0, STATE_CALENDAR),
      usage: { ...store.usageOf(tenantId), maxBudgetEur: config.maxBudgetEur },
      notifications: scoped.notifications.slice(0, STATE_NOTIFICATIONS),
      agent: {
        // Flag aus -> config.twilioNumber (Bestand). Flag an -> aktive Tenant-Nummer
        // (fail-closed leer, NIE Owner-Nummer fuer einen fremden Tenant).
        number: config.multiTenant ? activeNumberFor(s, tenantId) : config.twilioNumber,
        owner: ctx.ownerName,
        ownerNumber: isOwnerView ? config.ownerNumber : "",
        model: config.claudeModel,
        voiceEngine: config.voiceEngine,
        allowedNumbers: config.allowedNumbers, // globales Safety-Gate, bleibt global
      },
    });
  });

  router.get("/api/calls/:id", (req, res) => {
    const call = store.getCall(req.params.id);
    if (!call) return res.status(404).json({ error: "not found" });
    // Tenant-Scope (I5): fremder Call -> 404 (kein Existenz-Leck, NICHT 403). Flag
    // aus -> requestTenant === OWNER_TENANT_ID; trotzdem ueber config.multiTenant
    // gaten, damit Legacy-Calls ohne tenantId bei Flag aus byte-identisch (200)
    // bleiben. getCall matcht auch twilioSid -> der Guard deckt beide id-Achsen.
    if (config.multiTenant && !tenantOwnsCall(call, requestTenant(req)))
      return res.status(404).json({ error: "not found" });
    res.json(publicCall(call));
  });

  // Auskunft/Export (Art. 15/20): nicht-destruktiver Owner-Tenant-Export, read-only,
  // hinter der bestehenden /api/*-Basic-Auth. Calls durch publicCall (KEIN
  // streamToken-Leak, dieselbe Invariante wie /api/state). BEWUSST KEIN MCP-Tool
  // (kein Bulk-Export ueber MCP, Regel 5). Die Loeschung (Art. 17) hat KEINEN
  // Endpunkt - nur Script (kleinste Angriffsflaeche, Safety vor Features).
  router.get("/api/tenant-data/export", (req, res) => {
    const tenantId = requireTenant(req, res); // L6: tenant-gescopt statt OWNER-gepinnt; REJECT -> 403
    if (!tenantId) return;
    const data = store.exportTenantData(tenantId);
    audit("data_export", req,
      `calls=${data.calls.length} actionItems=${data.actionItems.length} notifications=${data.notifications.length}`);
    res.json({ ...data, calls: data.calls.map(publicCall) });
  });

  return router;
}
