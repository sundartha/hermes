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
import { createTenantSubscription } from "./billing/subscribe.js";
import { activatePaidTenant } from "./billing/activation.js";
import { publicCall, activeNumberFor, upcomingCalendar } from "./store/views.js";

// Pay3: Redirect-Ziele nach Rueckkehr von Stripe Checkout (kein Magic-String, G25).
// Die UI (tenant.html) liest den ?card-Parameter und zeigt eine kurze Rueckmeldung.
const CARD_RETURN_OK = "/tenant.html?card=ok";
const CARD_RETURN_CANCELED = "/tenant.html?card=canceled";

// F2 P6: maskiert die EIGENE private Summary-Nummer fuer die Self-Service-Read-View
// (Decision #5, H4). Zeigt NUR den Laendercode (erste 3 Zeichen) + die letzten 4 Ziffern,
// der Rest wird zu "…" - genug, dass der Eingeloggte SEINE Nummer wiedererkennt, ohne die
// volle PII in Browser-History/Logs/Schulter-Sicht zu spiegeln. Reine Praesentation; der
// einzige Aufrufer ist die eigene-Nummer-View (nie eine fremde - Schluessel ist die Web-
// Session). null/leer -> null (Feld signalisiert "keine Nummer hinterlegt"). Gespeicherte
// Werte sind immer valide E.164 (>=8 Zeichen via setPrivateNumber-Gate) -> die ersten 3
// und letzten 4 Zeichen ueberlappen nie.
function maskPrivateNumber(e164) {
  if (!e164) return null;
  return `${e164.slice(0, 3)}…${e164.slice(-4)}`;
}

// Pay3/W4: der payment-bezogene Anteil der Self-Service-Lese-View. Bei PAYMENT_ENABLED
// aus -> {} (Felder fehlen, UI versteckt den Block, byte-identisch zum Bestand). An ->
// hasCard (abgeleiteter Karten-Status) + subscription (aktiver Plan/Periode). KEIN
// id-Leak: subscriptionId bleibt draussen (fuer die UI reichen planSlug + currentPeriodEnd;
// die opake sub_-Referenz gehoert nicht in die Browser-View). Reine Praesentation.
function paymentView(store, config, tenant) {
  if (!config.paymentEnabled) return {};
  const { planSlug, currentPeriodEnd } = store.tenantSubscription(tenant);
  return {
    hasCard: hasCardOnFile(store.tenantStripe(tenant)),
    subscription: { planSlug, currentPeriodEnd },
  };
}

// config (paymentEnabled/publicUrl) + billing (BillingPort) + accounts (pg-Status-Seam
// fuer die W4-Aktivierung) werden injiziert (P4/DIP): derselbe Handler in Produktion
// (server.js) UND im in-process pglite-Test mit Fake-Billing, ohne echten Stripe-Call.
// Bleibt EIN Objekt-Argument (kein F1-Verstoss).
export function makeSelfServiceRoutes({
  store,
  webAuthMw,
  webAuthPendingMw,
  audit,
  config,
  billing,
  accounts,
  provision,
}) {
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
      // F2 P6: die EIGENE private Summary-Nummer (maskiert, s. maskPrivateNumber).
      // Dedizierter Record-Reader, Schluessel req.tenant.tenantId (nie fremd, H3) - NIE
      // ueber settings/tenantContext, die ueber /api/state + MCP komplett leaken (H4).
      privateNumber: maskPrivateNumber(store.tenantPrivateNumber(tenant)),
      // Pay3/W4: Karten- + Abo-Status. KEIN id-Leak (cus_/pm_/sub_ sind keine Secrets,
      // gehoeren aber nicht in die UI-View) - nur "Karte liegt vor ja/nein" + der aktive
      // Plan/Periode. Bei PAYMENT_ENABLED aus: Felder fehlen -> UI versteckt den Block,
      // Lese-View byte-identisch zum Bestand. (s. paymentView, eine Quelle).
      ...paymentView(store, config, tenant),
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
    audit(
      "self_service_settings",
      req,
      `keys=${changed.join(",") || "-"} rejected=${rejected.join(",") || "-"}`,
    );
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
      return res
        .status(400)
        .json({ error: "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)" });
    }
    const stored = store.tenantPrivateNumber(tenant) != null;
    audit("self_service_private_number", req, `outcome=${stored ? "set" : "cleared"}`);
    res.json({ ok: true, hasPrivateNumber: stored });
  });

  // ---- P5: schlanker Billing-Status fuer die gefuehrte Aktivierung -----------------
  // Hinter webAuthPendingMw (suspended erreichbar): liefert NUR die Flags, die die
  // Aktivierungs-Ansicht (tenant.html 403-Zweig) braucht - paymentEnabled (gibt es etwas
  // zu tun?), hasCard (zuerst Karte?), planSlug (schon abonniert?), status (schon aktiv?).
  // OEFFNET NICHT die active-only /state-View: kein calls/settings/Nummer-Leak (H4). Reine
  // Lifecycle-Flags, keine Secrets/PII (kein cus_/sub_/pm_). Read-only -> kein Audit (wie /state).
  router.get("/api/self-service/billing/status", webAuthPendingMw, (req, res) => {
    const tenant = req.tenant.tenantId;
    res.json({
      paymentEnabled: !!config.paymentEnabled,
      hasCard: hasCardOnFile(store.tenantStripe(tenant)),
      planSlug: store.tenantSubscription(tenant).planSlug,
      status: req.tenant.status,
    });
  });

  // ---- Pay3: Karten-Erfassung aus dem Self-Service-Dashboard ---------------------
  // Identitaet = Web-Session (req.tenant.tenantId), NICHT der Admin-/requireTenant-
  // Pfad der Pay1-Routen - so bindet ein remote-Tenant seine Karte fail-closed an
  // SEINEN Customer (nie an den Owner-Fallback, R4). Stripe-Logik aus dem geteilten
  // card-setup-Helfer (G5: Customer-Idempotenz + Customer-Match leben einmal).
  // Ohne PAYMENT_ENABLED -> 404 (Muster flush-meters/Pay1, byte-identisch zum Bestand).
  // webAuthPendingMw (P5): suspended muss die Karte hinterlegen koennen (Aktivierungs-Schritt).
  router.post("/api/self-service/billing/setup-checkout", webAuthPendingMw, async (req, res) => {
    if (!config.paymentEnabled)
      return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
    if (!config.publicUrl) return res.status(500).json({ error: "PUBLIC_URL fehlt" }); // kein Leak
    const tenant = req.tenant.tenantId;
    const customerId = await ensureCustomer({ store, billing, tenant });
    const successUrl = `${config.publicUrl}/api/self-service/billing/return?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.publicUrl}${CARD_RETURN_CANCELED}`;
    const { url } = await billing.createSetupCheckoutSession({
      tenantRef: tenant,
      customerId,
      successUrl,
      cancelUrl,
    });
    audit("self_service_setup_checkout", req, `tenant=${tenant}`);
    res.json({ url });
  });

  // Stripe-Browser-Redirect-Ziel: GET (same-origin -> webAuthMw sieht das Session-
  // Cookie). Bindet das payment_method fail-closed an den eigenen Customer (Customer-
  // Match im Helfer). Antwortet mit 302 in die UI (Pay3), NICHT JSON.
  router.get("/api/self-service/billing/return", webAuthPendingMw, async (req, res) => {
    if (!config.paymentEnabled)
      return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
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

  // ---- W4: Abo buchen aus dem Self-Service-Dashboard -----------------------------
  // Identitaet = Web-Session (req.tenant.tenantId). Ohne PAYMENT_ENABLED -> 404 (byte-
  // identisch, Muster setup-checkout). createTenantSubscription gated fail-closed
  // (unbekannter Plan/unkonfigurierter Price/bereits abonniert/keine Karte) und loest
  // ECHTES Geld aus (Recurring) -> der reason mappt auf den HTTP-Code (SUBSCRIBE_REJECT_*).
  // Bei Erfolg Tenant AKTIV ueber accounts.setStatus (DERSELBE pg-Status-Seam wie der
  // Admin-approve, den webAuthMw liest - kein Drift zur Store-Fassade). Die Safety-Gates
  // (Allowlist/Budget/KYC/Disclosure) bleiben unberuehrt: active != outbound-faehig.
  router.post("/api/self-service/billing/subscribe", webAuthPendingMw, async (req, res) => {
    if (!config.paymentEnabled)
      return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
    const tenant = req.tenant.tenantId;
    const planSlug = (req.body || {}).plan;
    const result = await createTenantSubscription({ store, billing, config, tenant, planSlug });
    if (!result.ok) {
      audit("self_service_subscribe_rejected", req, `tenant=${tenant} reason=${result.reason}`);
      return res.status(subscribeRejectStatus(result.reason)).json({ error: result.reason });
    }
    // P5: volle Aktivierung (status=active + kyc=CARD + payment-gegatetes Provisioning) -
    // EINE Quelle (activation.js), identisch zum Webhook-Backup. Unabhaengig von der Stripe-
    // Event-Subscription; idempotent ueber den geteilten tenantHasLiveNumber-Guard. Der
    // Status-Flip bleibt am pg-Status-Seam (webAuthMw-Quelle), kein Drift zur Store-Fassade.
    await activatePaidTenant({ store, accounts, provision, tenant });
    audit("self_service_subscribe", req, `tenant=${tenant} plan=${planSlug}`);
    res.json({ plan: result.planSlug, currentPeriodEnd: result.currentPeriodEnd });
  });

  return router;
}

// W4: reason -> HTTP-Code (kein Magic-String/Number, G25). no_card/already_subscribed =
// Client-Vorbedingung (409, UI leitet auf setup-checkout bzw. zeigt das aktive Abo);
// plan_unconfigured = Server-Fehlkonfiguration (500, Price-Id fehlt); unknown_plan =
// Client-Eingabe (400). Default fail-closed 400.
function subscribeRejectStatus(reason) {
  if (reason === "no_card" || reason === "already_subscribed") return 409;
  if (reason === "plan_unconfigured") return 500;
  return 400;
}
