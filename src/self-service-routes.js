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
import { selfServicePatch, GREETING_TEMPLATES, hasCardOnFile } from "./self-service.js";
import { ensureCustomer, bindCardFromSession } from "./billing/card-setup.js";
import { publicCall, activeNumberFor, upcomingCalendar } from "./store/views.js";

// Pay3: Redirect-Ziele nach Rueckkehr von Stripe Checkout (kein Magic-String, G25).
// Die UI (tenant.html) liest den ?card-Parameter und zeigt eine kurze Rueckmeldung.
const CARD_RETURN_OK = "/tenant.html?card=ok";
const CARD_RETURN_CANCELED = "/tenant.html?card=canceled";

// config (paymentEnabled/publicUrl) + billing (BillingPort) werden injiziert (P4/DIP):
// derselbe Handler in Produktion (server.js) UND im in-process pglite-Test mit Fake-
// Billing, ohne echten Stripe-Call. Bleibt EIN Objekt-Argument (kein F1-Verstoss).
export function makeSelfServiceRoutes({ store, webAuthMw, audit, config, billing }) {
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
      // Pay3: abgeleiteter boolescher Karten-Status. KEIN id-Leak (cus_/pm_ sind keine
      // Secrets, gehoeren aber nicht in die UI-View) - nur "Karte liegt vor ja/nein".
      // Bei PAYMENT_ENABLED aus: Feld fehlt (keine Karten-Erfassung) -> UI versteckt
      // den Block, Lese-View byte-identisch zum Bestand.
      ...(config.paymentEnabled ? { hasCard: hasCardOnFile(store.tenantStripe(tenant)) } : {}),
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

  // ---- F2 P5: Self-Service Write der privaten Summary-Nummer ----------------------
  // DEDIZIERTE Route (NICHT die settings-Whitelist selfServicePatch/updateSettings,
  // AK #3): privateNumber ist Identitaets-/Kontakt-PII und lebt am Tenant-Record ueber
  // den dedizierten Setter (normNum->E164->Land-Gate, DIESELBE Quelle wie Onboarding/P4
  // - kein Drift, G5), NIE in settings (settings leakt komplett ueber /api/state + MCP,
  // H4). Leer/""/null -> Feld loeschen (impliziter Opt-Out: kein Ziel -> finishCall
  // ueberspringt die SMS still). Ungueltig/gesperrtes Land -> 400 (fail-closed, kein
  // Muell at rest; der Setter wirft VOR jeder Mutation -> alter Wert bleibt). Identitaet
  // = Web-Session (req.tenant.tenantId), NIE ein fremder Tenant. Audit UND Response
  // tragen NIE die Nummer - nur den Outcome-Schluessel (set|cleared|rejected, H4).
  router.post("/api/self-service/private-number", webAuthMw, (req, res) => {
    const tenant = req.tenant.tenantId;
    const { privateNumber } = req.body || {};
    try {
      store.setPrivateNumber(tenant, privateNumber);
    } catch {
      audit("self_service_private_number", req, "outcome=rejected");
      return res.status(400).json({ error: "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)" });
    }
    const stored = store.tenantPrivateNumber(tenant) != null;
    audit("self_service_private_number", req, `outcome=${stored ? "set" : "cleared"}`);
    res.json({ ok: true, hasPrivateNumber: stored });
  });

  // ---- Pay3: Karten-Erfassung aus dem Self-Service-Dashboard ---------------------
  // Identitaet = Web-Session (req.tenant.tenantId), NICHT der Admin-/requireTenant-
  // Pfad der Pay1-Routen - so bindet ein remote-Tenant seine Karte fail-closed an
  // SEINEN Customer (nie an den Owner-Fallback, R4). Stripe-Logik aus dem geteilten
  // card-setup-Helfer (G5: Customer-Idempotenz + Customer-Match leben einmal).
  // Ohne PAYMENT_ENABLED -> 404 (Muster flush-meters/Pay1, byte-identisch zum Bestand).
  router.post("/api/self-service/billing/setup-checkout", webAuthMw, async (req, res) => {
    if (!config.paymentEnabled) return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
    if (!config.publicUrl) return res.status(500).json({ error: "PUBLIC_URL fehlt" }); // kein Leak
    const tenant = req.tenant.tenantId;
    const customerId = await ensureCustomer({ store, billing, tenant });
    const successUrl = `${config.publicUrl}/api/self-service/billing/return?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.publicUrl}${CARD_RETURN_CANCELED}`;
    const { url } = await billing.createSetupCheckoutSession({ tenantRef: tenant, customerId, successUrl, cancelUrl });
    audit("self_service_setup_checkout", req, `tenant=${tenant}`);
    res.json({ url });
  });

  // Stripe-Browser-Redirect-Ziel: GET (same-origin -> webAuthMw sieht das Session-
  // Cookie). Bindet das payment_method fail-closed an den eigenen Customer (Customer-
  // Match im Helfer). Antwortet mit 302 in die UI (Pay3), NICHT JSON.
  router.get("/api/self-service/billing/return", webAuthMw, async (req, res) => {
    if (!config.paymentEnabled) return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
    const tenant = req.tenant.tenantId;
    const sessionId = req.query.session_id;
    if (!sessionId || typeof sessionId !== "string")
      return res.status(400).json({ error: "session_id ist Pflicht" });

    const { ok } = await bindCardFromSession({ store, billing, tenant, sessionId });
    if (!ok) {
      audit("self_service_card_mismatch", req, `tenant=${tenant}`);
      return res.status(403).json({ error: "Customer-Mismatch" });
    }
    audit("self_service_card_saved", req, `tenant=${tenant}`);
    res.redirect(CARD_RETURN_OK); // 302 -> UI zeigt "Karte hinterlegt"
  });

  return router;
}
