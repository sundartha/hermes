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
import { PERSONA_STYLE_IDS } from "./i18n/locales.js";
import { ensureCustomer, bindCardFromSession } from "./billing/card-setup.js";
import {
  createTenantSubscription,
  priceIdForPlan,
  activateSubscriptionFromCheckoutSession,
  hasActiveSubscription,
  checkoutSessionIdempotencyKey,
} from "./billing/subscribe.js";
import { activatePaidTenant, profileAuditDetail } from "./billing/activation.js";
import { publicCall, activeNumberFor, numberStatusFor, upcomingCalendar } from "./store/views.js";
import { tenantGeo } from "./store/state-ops.js";
import { holdAmountForCountry } from "./telephony/provisioning-geo.js";
import { CATALOG_SLUGS } from "./plans.js";
import { quotaView } from "./billing/meter.js";

// Pay3: Redirect-Ziele nach Rueckkehr von Stripe Checkout (kein Magic-String, G25).
// Die UI (tenant.html) liest den ?card-Parameter und zeigt eine kurze Rueckmeldung.
const CARD_RETURN_OK = "/tenant.html?card=ok";
const CARD_RETURN_CANCELED = "/tenant.html?card=canceled";
// Stripe-/Netzwerkfehler im Karten-Rueckkehr-Pfad: der Browser bekommt eine klare
// Rueckmeldung statt eines haengenden Requests (s. asyncBilling). UI zeigt einen Fehler.
const CARD_RETURN_ERROR = "/tenant.html?card=error";

// BK2: Rueckkehr-Ziele bei getragenem Plan (Kachel-Flow). sub=ok: gebucht+aktiviert.
// sub=failed: Karte gespeichert, Buchung scheiterte (z.B. already_subscribed) -> UI sagt
// das, Kunde kann erneut. Kein Magic-String (G25).
const SUB_RETURN_OK = "/tenant.html?sub=ok";
const SUB_RETURN_FAILED = "/tenant.html?sub=failed";

// AM4: maschinenlesbarer Funnel-Hinweis im no_card-Response. Der Client (lib/subscribe.js)
// springt bei next==="setup-checkout" deterministisch in die Karten-Erfassung, statt ein
// nacktes 409 als Sackgasse zu sehen. Kein Magic-String (G25); spiegelbildlich
// SETUP_CHECKOUT_NEXT im Frontend (Contract-String ueber die Origin-Grenze, wie die error-Codes).
const NEXT_SETUP_CHECKOUT = "setup-checkout";

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
// hasCard (abgeleiteter Karten-Status) + subscription (aktiver Plan/Periode) + quota
// (abgeleitetes Minuten-Kontingent). KEIN id-Leak: subscriptionId bleibt draussen (fuer
// die UI reichen planSlug + currentPeriodEnd; die opake sub_-Referenz gehoert nicht in
// die Browser-View). Reine Praesentation.
function paymentView(store, config, tenant) {
  if (!config.paymentEnabled) return {};
  const { planSlug, currentPeriodStart, currentPeriodEnd } = store.tenantSubscription(tenant);
  return {
    hasCard: hasCardOnFile(store.tenantStripe(tenant)),
    subscription: { planSlug, currentPeriodEnd },
    // BK4/B3: abgeleitetes Minuten-Kontingent des laufenden Zeitraums. DERSELBE
    // Periodenanker (currentPeriodStart bevorzugt) + dasselbe Erschoepfungs-Praedikat
    // wie das Outbound-Gate -> Anzeige == durchgesetztes Gate (kein "Rest X, trotzdem
    // geblockt"). Kein Abo -> null (UI: Leerzustand). store.load() = der Ledger-State.
    quota: quotaView(store.load(), { tenantId: tenant, planSlug, currentPeriodStart, currentPeriodEnd }),
  };
}

// Phase A (PLAN-VOUCHER-SETUP-FEE-GAP.md): der Land-abhaengige Setup-Tarif (P9-Hold,
// provisioning-geo.js) - GENAU dieselbe Formel, die runProvisioningDrain (server.js) beim
// ECHTEN Kauf anwendet (EINE Quelle, kein Drift zwischen Anzeige und tatsaechlichem Hold-
// Betrag). tenantGeo liest das Land, das /api/onboard bereits gesetzt hat; noch kein
// Onboard (kein country) -> holdAmountForCountry faellt auf den globalen Default. Nur bei
// PAYMENT_ENABLED relevant (sonst haelt provisionNumber gar keinen Hold) -> 0 sonst (kein
// irrefuehrender Betrag; die aufrufende UI blendet den Billing-Block dann ohnehin aus).
function numberSetupFeeCentsFor(s, config, tenant) {
  if (!config.paymentEnabled) return 0;
  const { country } = tenantGeo(s, tenant);
  return holdAmountForCountry(country, config.numberSetupFeeCents);
}

// BK2: Reiner Selektor (N7, kein Nebeneffekt): untrusted Input (Body ODER zurueckgetragene
// Query) -> bekannter Katalog-Slug oder null. SSoT = CATALOG_SLUGS (G5, kein zweites Literal).
function knownPlanSlug(raw) {
  return typeof raw === "string" && CATALOG_SLUGS.includes(raw) ? raw : null;
}

// BK2: Baut die Stripe-successUrl. {CHECKOUT_SESSION_ID} = Stripe-Platzhalter. Optionaler,
// bereits katalog-validierter (-> URL-sicher) Plan als Query -> return kann ihn buchen.
// Slug = oeffentliche Katalog-Daten, KEIN Id-Leak.
function returnSuccessUrl(publicUrl, planSlug) {
  const base = `${publicUrl}/api/self-service/billing/return?session_id={CHECKOUT_SESSION_ID}`;
  return planSlug ? `${base}&plan=${planSlug}` : base;
}

// BK-Discount: erzeugt die zur Plan-Lage passende Stripe-Checkout-Session (G30, eine
// Aufgabe). Mit Plan -> subscription-Mode: Karte + Abo in EINEM gehosteten Schritt,
// Stripe zeigt das native Rabattcode-Feld (allow_promotion_codes). Ohne Plan ->
// setup-Mode (nur Karte speichern, byte-identisch zum Bestand). priceId ist bei
// planSlug != null vom Aufrufer bereits aufgeloest (plan_unconfigured-Gate davor).
function createCheckoutSession({ billing, config, tenant, customerId, planSlug, priceId }) {
  const successUrl = returnSuccessUrl(config.publicUrl, planSlug);
  const cancelUrl = `${config.publicUrl}${CARD_RETURN_CANCELED}`;
  if (!planSlug)
    return billing.createSetupCheckoutSession({ tenantRef: tenant, customerId, successUrl, cancelUrl });
  return billing.createSubscriptionCheckoutSession({
    tenantRef: tenant,
    customerId,
    priceId,
    planSlug,
    successUrl,
    cancelUrl,
    // TOCTOU-Fix1: derselbe Key fuer zwei nahezu gleichzeitige Aufrufe (Doppelklick/zwei
    // Tabs) desselben Tenant+Plan+Price -> Stripe liefert dieselbe Session zurueck statt
    // einer zweiten. Ein geaenderter Stripe-Price erzeugt einen NEUEN Key (kein
    // idempotency_error nach Preis-Update, s. subscribe.js checkoutSessionIdempotencyKey).
    idempotencyKey: checkoutSessionIdempotencyKey(tenant, planSlug, priceId),
  });
}

// BK2: Geteilte Buchungs-Sequenz hinter BEIDEN Eingaengen (G5/S2). Bucht fail-closed
// (createTenantSubscription) + aktiviert NUR bei Erfolg voll (activatePaidTenant:
// status=active + kyc=CARD + idempotentes Provisioning). KEIN HTTP/Audit hier (G34).
async function subscribeAndActivate({ store, billing, config, accounts, provision, tenant, planSlug }) {
  const result = await createTenantSubscription({ store, billing, config, tenant, planSlug });
  if (!result.ok) return result;
  const { profile } = await activatePaidTenant({ store, accounts, provision, tenant });
  return { ...result, profile };
}

// Express 4 leitet abgelehnte Promises aus async-Handlern NICHT an die Fehler-Kette ->
// ein geworfener Stripe-/Netzwerkfehler liesse die Anfrage HAENGEN (nie ein Response,
// haengende Verbindung = Verfuegbarkeitsrisiko bei Skala). Dieser Wrapper faengt den
// Fehler, loggt NUR die Fehlermeldung (op+Status, kein Secret - Regel 4) und ruft einen
// Responder (JSON 502 bzw. Redirect), sodass IMMER geantwortet wird. Erwartete fachliche
// Ablehnungen (no_card etc.) laufen NICHT hierueber - die behandelt der Handler selbst.
function asyncBilling(fn, onError) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`self-service billing route failed: ${err.message}`);
      if (!res.headersSent) onError(res);
    }
  };
}

// Fehler-Responder der JSON-Billing-Routen (setup-checkout/subscribe): 502 Bad Gateway
// = Upstream Stripe fehlgeschlagen; generische Meldung (kein Secret/Interner, Regel 4).
const billingUnavailable = (res) => res.status(502).json({ error: "billing_unavailable" });

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
    // s einmal laden fuer agent.number + numberStatus (selbe Quelle wie /api/state, G5;
    // eine Last statt zweier store.load()-Aufrufe).
    const agentState = store.load();
    res.json({
      settings: ctx.settings,
      greetingTemplates: GREETING_TEMPLATES,
      // P4: kuratierte Stil-IDs fuers Dropdown (EINE Quelle = das P2-Enum; das Client-
      // Dropdown haelt KEIN eigenes ID-Set, G5/S2). Fehlt das Feld -> UI versteckt die
      // Karte (Flag-aus / alter Server) - I9-Muster wie hasCard beim billingCard.
      personaStyleIds: PERSONA_STYLE_IDS,
      // F2 P6: die EIGENE private Summary-Nummer (maskiert, s. maskPrivateNumber).
      // Dedizierter Record-Reader, Schluessel req.tenant.tenantId (nie fremd, H3) - NIE
      // ueber settings/tenantContext, die ueber /api/state + MCP komplett leaken (H4).
      privateNumber: maskPrivateNumber(store.tenantPrivateNumber(tenant)),
      // Pay3/W4: Karten- + Abo-Status. KEIN id-Leak (cus_/pm_/sub_ sind keine Secrets,
      // gehoeren aber nicht in die UI-View) - nur "Karte liegt vor ja/nein" + der aktive
      // Plan/Periode. Bei PAYMENT_ENABLED aus: Felder fehlen -> UI versteckt den Block,
      // Lese-View byte-identisch zum Bestand. (s. paymentView, eine Quelle).
      ...paymentView(store, config, tenant),
      // Phase A (PLAN-VOUCHER-SETUP-FEE-GAP.md): der Land-abhaengige Setup-Tarif, VOR dem
      // Subscribe-Klick sichtbar (die Plan-Kacheln lesen genau dieses Feld). currency
      // ungegated (nicht geheim, wie PLAN_CATALOG.currency immer gesetzt).
      numberSetupFeeCents: numberSetupFeeCentsFor(agentState, config, tenant),
      currency: config.paymentCurrency,
      calls: data.calls.map(publicCall),
      actionItems: data.actionItems,
      calendar: upcomingCalendar(store, tenant),
      agent: {
        number: activeNumberFor(agentState, tenant),
        owner: ctx.ownerName,
        numberStatus: numberStatusFor(agentState, tenant),
      },
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
    const s = store.load();
    res.json({
      paymentEnabled: !!config.paymentEnabled,
      hasCard: hasCardOnFile(store.tenantStripe(tenant)),
      planSlug: store.tenantSubscription(tenant).planSlug,
      status: req.tenant.status,
      // Phase A: identisch zur /state-Route (numberSetupFeeCentsFor, EINE Quelle) - dieser
      // Endpunkt ist der einzige, den ein SUSPENDIERTER Tenant vor dem Checkout sieht.
      numberSetupFeeCents: numberSetupFeeCentsFor(s, config, tenant),
      currency: config.paymentCurrency,
    });
  });

  // ---- Pay3: Karten-Erfassung aus dem Self-Service-Dashboard ---------------------
  // Identitaet = Web-Session (req.tenant.tenantId), NICHT der Admin-/requireTenant-
  // Pfad der Pay1-Routen - so bindet ein remote-Tenant seine Karte fail-closed an
  // SEINEN Customer (nie an den Owner-Fallback, R4). Stripe-Logik aus dem geteilten
  // card-setup-Helfer (G5: Customer-Idempotenz + Customer-Match leben einmal).
  // Ohne PAYMENT_ENABLED -> 404 (Muster flush-meters/Pay1, byte-identisch zum Bestand).
  // webAuthPendingMw (P5): suspended muss die Karte hinterlegen koennen (Aktivierungs-Schritt).
  router.post(
    "/api/self-service/billing/setup-checkout",
    webAuthPendingMw,
    asyncBilling(
      async (req, res) => {
        if (!config.paymentEnabled)
          return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
        if (!config.publicUrl) return res.status(500).json({ error: "PUBLIC_URL fehlt" }); // kein Leak
        const tenant = req.tenant.tenantId;
        // BK2: optionaler Plan aus dem Kachel-Flow. Bare "Karte hinzufuegen" (kein Plan)
        // -> setup-Mode-successUrl ohne &plan= (byte-identisch zum Bestand).
        const planSlug = knownPlanSlug((req.body || {}).plan);
        // BK-Discount-Gates VOR jedem Stripe-Call (fail-closed, keine Session mit Muell):
        // fehlender Price = Server-Fehlkonfig (500, wie subscribeReject); bestehendes Abo
        // = 409 (schnelle Client-Rueckmeldung fuer den Normalfall). Dieser Vor-Check ist
        // ein TOCTOU (zwei nahezu gleichzeitige Aufrufe bestehen BEIDE ihn) - der eigentliche
        // Schutz gegen ein zweites echtes Stripe-Abo ist der Idempotency-Key in
        // createCheckoutSession (s. dort): beide Aufrufe landen auf DERSELBEN Session.
        const priceId = planSlug ? priceIdForPlan(planSlug, config) : null;
        if (planSlug && !priceId) return res.status(500).json({ error: "plan_unconfigured" });
        if (planSlug && hasActiveSubscription(store, tenant))
          return res.status(409).json({ error: "already_subscribed" });
        const customerId = await ensureCustomer({ store, billing, tenant });
        const { url } = await createCheckoutSession({
          billing,
          config,
          tenant,
          customerId,
          planSlug,
          priceId,
        });
        audit(
          "self_service_setup_checkout",
          req,
          `tenant=${tenant}${planSlug ? ` plan=${planSlug} mode=subscription` : ""}`,
        );
        res.json({ url });
      },
      billingUnavailable,
    ),
  );

  // Stripe-Browser-Redirect-Ziel: GET (same-origin -> webAuthMw sieht das Session-
  // Cookie). Bindet das payment_method fail-closed an den eigenen Customer (Customer-
  // Match im Helfer). Antwortet mit 302 in die UI (Pay3), NICHT JSON.
  router.get(
    "/api/self-service/billing/return",
    webAuthPendingMw,
    asyncBilling(
      async (req, res) => {
        if (!config.paymentEnabled)
          return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
        const tenant = req.tenant.tenantId;
        const sessionId = req.query.session_id;
        if (!sessionId || typeof sessionId !== "string")
          return res.status(400).json({ error: "session_id ist Pflicht" });

        // BK2/BK-Discount: getragener Plan (Query) -> die Session lief im subscription-
        // Mode (Stripe hat Karte + Abo schon angelegt) -> verifizieren + persistieren +
        // aktivieren. Fehlt/unbekannt -> reiner Karten-Flow (setup-Mode, byte-identisch).
        const carriedPlan = knownPlanSlug(req.query.plan);
        if (!carriedPlan) {
          const { ok } = await bindCardFromSession({ store, billing, tenant, sessionId });
          if (!ok) {
            audit("self_service_card_mismatch", req, `tenant=${tenant}`);
            return res.status(403).json({ error: "Customer-Mismatch" });
          }
          audit("self_service_card_saved", req, `tenant=${tenant}`);
          return res.redirect(CARD_RETURN_OK); // 302 -> "Karte hinterlegt"
        }

        const result = await activateSubscriptionFromCheckoutSession({
          store, billing, accounts, provision, tenant, sessionId, expectedPlanSlug: carriedPlan,
        });
        if (result.reason === "customer_mismatch" || result.reason === "plan_mismatch") {
          // Dieselbe R4-fail-closed-Antwort wie der Karten-Flow (403, kein Redirect):
          // eine fremde ODER verfaelschte session_id bindet NIE Karte oder Abo.
          audit("self_service_card_mismatch", req, `tenant=${tenant} reason=${result.reason}`);
          return res.status(403).json({ error: "Customer-Mismatch" });
        }
        if (result.reason === "subscription_conflict") {
          // Review-Blocker Runde 2 (Cross-Plan-Race): eine ECHTE, bei Stripe bereits
          // abgerechnete Zweit-Subscription (anderer Plan, zweite Session) bliebe bei
          // already_subscribed/sub=ok stumm unverwaltet. Eigener, lauter Audit-Event-
          // Typ (durchsuchbar/alarmierbar fuer Ops, NICHT im Rauschen von
          // self_service_subscribe) traegt die verwaiste subscriptionId, damit sie
          // manuell bei Stripe storniert werden kann. Ehrlicher Fehlerzustand
          // (sub=failed) statt einer falschen Erfolgsmeldung.
          audit(
            "self_service_subscription_conflict",
            req,
            `tenant=${tenant} plan=${carriedPlan} orphanedSubscriptionId=${result.subscriptionId}`,
          );
          return res.redirect(SUB_RETURN_FAILED);
        }
        audit(
          "self_service_subscribe",
          req,
          `tenant=${tenant} plan=${carriedPlan} outcome=${result.ok ? "ok" : result.reason} ${profileAuditDetail(result.profile)}`,
        );
        // already_subscribed = idempotent-erfolgreich (Doppel-Redirect/Reload derselben
        // Session, Abo ist aktiv) -> sub=ok. Jeder andere/kuenftige reason -> sub=failed.
        const succeeded = result.ok || result.reason === "already_subscribed";
        res.redirect(succeeded ? SUB_RETURN_OK : SUB_RETURN_FAILED);
      },
      (res) => res.redirect(CARD_RETURN_ERROR),
    ),
  );

  // ---- W4: Abo buchen aus dem Self-Service-Dashboard -----------------------------
  // Identitaet = Web-Session (req.tenant.tenantId). Ohne PAYMENT_ENABLED -> 404 (byte-
  // identisch, Muster setup-checkout). createTenantSubscription gated fail-closed
  // (unbekannter Plan/unkonfigurierter Price/bereits abonniert/keine Karte) und loest
  // ECHTES Geld aus (Recurring) -> der reason mappt auf den HTTP-Code (SUBSCRIBE_REJECT_*).
  // Bei Erfolg Tenant AKTIV ueber accounts.setStatus (DERSELBE pg-Status-Seam wie der
  // Admin-approve, den webAuthMw liest - kein Drift zur Store-Fassade). Die Safety-Gates
  // (Allowlist/Budget/KYC/Disclosure) bleiben unberuehrt: active != outbound-faehig.
  router.post(
    "/api/self-service/billing/subscribe",
    webAuthPendingMw,
    asyncBilling(
      async (req, res) => {
        if (!config.paymentEnabled)
          return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
        const tenant = req.tenant.tenantId;
        const planSlug = (req.body || {}).plan;
        // BK2: bucht + aktiviert ueber die geteilte Sequenz (subscribeAndActivate) - DIESELBE
        // Quelle wie der Karten-Checkout-Rueckkehr-Pfad (G5/S2). Verhalten unveraendert.
        const result = await subscribeAndActivate({
          store, billing, config, accounts, provision, tenant, planSlug,
        });
        if (!result.ok) {
          audit("self_service_subscribe_rejected", req, `tenant=${tenant} reason=${result.reason}`);
          const { status, body } = subscribeReject(result.reason, planSlug);
          return res.status(status).json(body);
        }
        audit("self_service_subscribe", req, `tenant=${tenant} plan=${planSlug} ${profileAuditDetail(result.profile)}`);
        res.json({ plan: result.planSlug, currentPeriodEnd: result.currentPeriodEnd });
      },
      billingUnavailable,
    ),
  );

  return router;
}

// W4/AM4: reason -> { HTTP-Status, JSON-Body } in EINEM Switch (kein Magic-String/Number,
// G25; keine zwei parallelen reason-Switches, G5/G23). no_card ist KEINE Sackgasse, sondern
// ein Funnel: der Body traegt next:"setup-checkout" + den (durch die vorgelagerten Gates in
// createTenantSubscription bereits katalog-validierten) Plan, sodass der Client deterministisch
// in die Karten-Erfassung springt. already_subscribed = Client-Vorbedingung (409, aktives Abo);
// plan_unconfigured = Server-Fehlkonfig (500, Price-Id fehlt); unknown_plan/Default = Client-
// Eingabe (400). Fail-closed: jeder unbekannte reason -> 400.
function subscribeReject(reason, planSlug) {
  if (reason === "no_card")
    return { status: 409, body: { error: reason, next: NEXT_SETUP_CHECKOUT, plan: planSlug } };
  if (reason === "already_subscribed") return { status: 409, body: { error: reason } };
  if (reason === "plan_unconfigured") return { status: 500, body: { error: reason } };
  return { status: 400, body: { error: reason } };
}
