// ---- makeReadRoutes (Phase 3) ---------------------------------------------------
// Extrahierte Read-/Export-Route-Gruppe (GET /api/state, GET /api/calls/:id,
// GET /api/tenant-data/export) als Factory mit Dependency-Injection - gleiches
// Muster wie makeCallRoutes/makeWebAuthRoutes/makeSelfServiceRoutes (web-auth.js
// ist die bewaehrte Vorlage). Teil der laufenden server.js-Decomposition
// (t4-server-decomposition.md, Phase 3): EINE kohaerente Route-Gruppe,
// behavior-preserving (reine Verschiebung, keine Logik-Aenderung).
//
// Hinter `internalOnly` (Loopback ohne X-Forwarded-For, seit AUTH-P5; seit AUTH-P7
// die einzige Sicherung dieser drei Routen). Die View-
// Helfer (publicCall/upcomingCalendar/activeNumberFor) kommen direkt aus store/views
// (eine Quelle, G5 - kein Mismatch zwischen Server- und Self-Service-Antworten).
import { Router } from "express";
import { publicCall, activeNumberFor, numberStatusFor, upcomingCalendar } from "../store/views.js";
import { tenantQuotaView, planUsagePercent } from "../billing/meter.js";
import { internalOnly } from "../wiring/internal-only.js";

// Anzeige-Slices fuer /api/state (Bestand): neueste N Calls/ActionItems/Termine/
// Notifications. Benannte Konstanten statt nackter Zahlen im Slice (G25).
export const STATE_CALLS = 30,
  STATE_ACTION_ITEMS = 50,
  STATE_CALENDAR = 10,
  STATE_NOTIFICATIONS = 10;

// KS-P8 (Owner-Entscheidung E4): diese Projektion traegt KEINEN Kostenbetrag mehr.
// Der Kunde kauft Minuten, keine Euro - eine EUR-Zahl ist fuer ihn weder handlungs-
// leitend noch verstaendlich und legt unsere Kostenstruktur offen. Ersatzlos entfallen
// sind alle fuenf frueheren Geld-Felder dieser Projektion (Lebenszeit-Kosten,
// Tenant-Decke, Spend-Monat-Kosten, Spend-Monat-Schluessel, In-Flight-Reserve; kein
// Schluessel-behalten-Bedeutung-wechseln - dieselbe harte Migration wie der Wegfall des
// globalen Cap-Feldes in P5a). An ihrer Stelle steht EIN Wert: der Anteil der
// verbrauchten Plan-Minuten in Prozent, abgeleitet in billing/meter.js
// (planUsagePercent, EINE Quelle mit dem Minuten-Gate). null = kein Kontingent
// hinterlegt (fail-closed, NIE 0 %).
// Die Geld-Achse bleibt sichtbar, wo sie hingehoert: im Ablehnungstext des Budget-
// Gates (store-Fassade -> outbound-gates.js, KS-P4) und in der Betreiber-Sicht
// GET /api/billing/platform-costs.
function usageView({ usage, quota }) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    calls: usage.calls,
    planUsagePercent: planUsagePercent(quota),
  };
}

// deps: { store, config, audit, tenant }. store traegt load/tenantContext/
// exportTenantData/getCall/usageOf (+ getCalendar via upcomingCalendar). config ist
// das globale Config-Objekt. audit ist util.audit (loggt nur Keys/Counts, keine
// PII/Werte). tenant buendelt die request-tenant-Resolver: requestTenant (Betreiber-
// Kanal -> BOOTSTRAP_TENANT_ID), requireTenant (tenant-gescopt; REJECT -> 403) und
// tenantOwnsCall (Ownership-Praedikat, eine Quelle wie POST /api/calls/:id/cancel).
export function makeReadRoutes({ store, config, audit, tenant }) {
  const { requestTenant, requireTenant, tenantOwnsCall } = tenant;
  const router = Router();

  // Gesamter Zustand fuers Dashboard (Polling) + MCP-Tools. Tenant-gescoped UNBEDINGT
  // (E4): kein Env-Schalter hebt den Scope mehr auf. Ein Legacy-Call ohne tenantId
  // gehoert damit niemandem und ist fuer niemanden sichtbar - gewollt, denn "sichtbar
  // fuer alle" ist die Alternative. Die lesenden MCP-Tools (list_calls/
  // list_action_items/get_agent_number/get_agent_status) erben das Scoping AUTOMATISCH
  // ueber diese Route (mcp-tools.js unveraendert).
  router.get("/api/state", internalOnly, (req, res) => {
    const s = store.load();
    const tenantId = requestTenant(req);
    const ctx = store.tenantContext(tenantId);

    // Listen-Scope ueber die EINE Quelle (tenantCallScope via exportTenantData):
    // calls/actionItems/notifications EINES Tenants. Danach die Bestands-Slices.
    const scoped = store.exportTenantData(tenantId);

    res.json({
      // settings/calendar/usage sind seit I2/P4 Maps tenantId -> Bucket; tenantContext
      // /usageOf liefern den Bucket des Request-Tenants (Owner-Bucket bei Flag aus).
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
        // Anzeige-Nummer = aktive Store-Nummer des Request-Tenants (auch der Owner ist
        // Tenant Null; keine config-Nummer mehr). Fail-closed leer, NIE die Nummer eines
        // fremden Tenants. numberStatus = Anzeige-Lifecycle (provisioning/none) fuer den
        // Dashboard-Chip "wird eingerichtet..." (eine Quelle wie number, tenant-gescoped).
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
    // Tenant-Scope (I5, seit E4 unbedingt): fremder Call -> 404 (kein Existenz-Leck,
    // NICHT 403). Ein Legacy-Call ohne tenantId gehoert niemandem und faellt damit
    // ebenfalls auf 404 - dieselbe Linie wie /api/state oben. getCall matcht auch
    // twilioSid -> der Guard deckt beide id-Achsen.
    if (!tenantOwnsCall(call, requestTenant(req)))
      return res.status(404).json({ error: "not found" });
    res.json(publicCall(call));
  });

  // Auskunft/Export (Art. 15/20): nicht-destruktiver Owner-Tenant-Export, read-only,
  // hinter `internalOnly` (Loopback ohne X-Forwarded-For, seit AUTH-P5; seit AUTH-P7
  // die einzige Sicherung) - NICHT webAuthMw (Owner-
  // Entscheidung 1, PLAN-AUTH-GATE): der Kanal bleibt der In-Process-MCP-Pfad, keine
  // Browser-Session. Calls durch publicCall (KEIN streamToken-Leak, dieselbe
  // Invariante wie /api/state). BEWUSST KEIN MCP-Tool (kein Bulk-Export ueber MCP,
  // Regel 5) und KEIN Ersatz fuer den DSGVO-Auskunftsweg (PLAN-TENANT-EXPORT.md). Die
  // Loeschung (Art. 17) hat KEINEN Endpunkt - nur Script (kleinste Angriffsflaeche,
  // Safety vor Features).
  router.get("/api/tenant-data/export", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res); // L6: tenant-gescopt statt OWNER-gepinnt; REJECT -> 403
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
