// ---- makeTenantWriteRoutes (Server-Slim P8) -------------------------------------
// Extrahierte tenant-scoped Schreib-Route-Gruppe (POST /api/settings,
// POST /api/action-items/:id/toggle, POST /api/calendar) als Factory mit
// Dependency-Injection - gleiches Muster wie makeReadRoutes/makeBillingRoutes.
// Teil der server.js-Decomposition (PLAN-SERVER-SLIM P8): reine Verschiebung,
// Verhalten unveraendert (byte-identische Pfade/Status/Bodies/Audit-Events).
//
// Hinter der bestehenden /api/*-Basic-Auth (server.js deckt /api/* ab). Die
// Reihenfolge im /api/calendar-Handler (requireTenant -> allowBooking-Recht ->
// Text-/Datums-Validierung) bleibt EXAKT erhalten (Safety: 403 vor 400). invalidText
// kommt direkt aus _validation.js (eine Quelle, G5 - wie in /api/calls). requireTenant
// = die EINE Wurzel-Instanz (403 bei TENANT_REJECT). internalIdentity/OWNER_ID werden
// injiziert (EINE Quelle aus request-tenant.js, gleiche Konvention wie makeOutboundGates
// - kein zweiter Resolver, G5/DIP).
import { Router } from "express";
import { invalidText } from "./_validation.js";

// deps: { store, audit, tenant, internalIdentity, OWNER_ID }. store traegt
// updateSettings/toggleActionItem/resolveProfile/addCalendarEvent. audit ist
// util.audit (loggt nur Keys, keine Werte/Freitext). tenant buendelt requireTenant
// (tenant-gescopt; REJECT -> 403). internalIdentity liest die Trusted-Local-Identitaet
// (nur fuers Audit, nie aus dem Body); OWNER_ID = Audit-Fallback.
export function makeTenantWriteRoutes({
  store,
  audit,
  tenant: { requireTenant },
  internalIdentity,
  OWNER_ID,
}) {
  const router = Router();

  router.post("/api/settings", (req, res) => {
    const tenant = requireTenant(req, res); // L2: tenant-gescopt; REJECT -> 403
    if (!tenant) return;
    const { settings, changed } = store.updateSettings(tenant, req.body || {});
    // Nur die Keys loggen - Werte (z.B. greeting-Freitext) gehoeren nicht ins Log
    audit("settings_update", req, `keys=${changed.join(",") || "-"}`);
    res.json(settings);
  });

  router.post("/api/action-items/:id/toggle", (req, res) => {
    const item = store.toggleActionItem(req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    res.json(item);
  });

  router.post("/api/calendar", (req, res) => {
    const tenant = requireTenant(req, res); // tenant-gescopt; REJECT -> 403 (vor dem Booking-Recht)
    if (!tenant) return;
    // Booking-Recht (Phase 2, Phase S tenant-gekeyt): BOOTSTRAP/Owner erlaubt, restriktives
    // Profil (allowBooking false) wird abgewiesen. Das Recht keyt auf den schon aufgeloesten
    // tenant; identity bleibt nur fuer das Audit (requestedBy), nie aus dem Body.
    const identity = internalIdentity(req);
    if (!store.resolveProfile(tenant).allowBooking) {
      audit("booking_denied", req, `requestedBy=${identity || OWNER_ID}`);
      return res.status(403).json({ error: "Kein Recht, Termine zu buchen (allowBooking=false)." });
    }
    const { title, start, end } = req.body || {};
    if (!title || !start || !end)
      return res.status(400).json({ error: "title, start, end sind Pflicht" });
    const titleErr = invalidText("title", title);
    if (titleErr) return res.status(400).json({ error: titleErr });
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate) || isNaN(endDate))
      return res
        .status(400)
        .json({ error: "start und end muessen gueltige Datumswerte sein (ISO 8601)" });
    if (endDate <= startDate) return res.status(400).json({ error: "end muss nach start liegen" });
    // Normalisiert speichern: findConflict() vergleicht ISO-Strings lexikographisch
    res.json(store.addCalendarEvent(tenant, title, startDate.toISOString(), endDate.toISOString()));
  });

  return router;
}
