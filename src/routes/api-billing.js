// ---- makeBillingRoutes (Server-Slim P7) -----------------------------------------
// Extrahierte /api/billing/*-Route-Gruppe (flush-meters, setup-checkout,
// checkout-return) als Factory mit Dependency-Injection - gleiches Muster wie
// makeReadRoutes/makeProfileRoutes. Teil der server.js-Decomposition (PLAN-SERVER-SLIM
// P7): reine Verschiebung, Verhalten unveraendert.
//
// Hinter der bestehenden /api/*-Basic-Auth (server.js deckt /api/* ab). BEWUSST KEIN
// MCP-Tool (kein offener ungegateter Geld-Endpunkt, R4). Ohne PAYMENT_ENABLED -> 404
// (fail-closed, byte-identisch zum Bestand). billing = die EINE stripeBilling-Instanz
// (INV-7), requireTenant = die EINE Wurzel-Instanz (403 bei TENANT_REJECT). Die pure
// Helfer (flushMeters/bindCardFromSession/startCheckoutWithStaleCustomerHeal) kommen
// direkt aus billing/* (eine Quelle, G5 - wie publicCall in makeReadRoutes).
import { Router } from "express";
import { flushMeters } from "../billing/meter.js";
import { bindCardFromSession, startCheckoutWithStaleCustomerHeal } from "../billing/card-setup.js";
import { requirePaymentEnabled } from "../billing/payment-gate.js";
import { SWEEP_TRIGGER } from "../billing/cost-truing.js";

// Status-Marker der gebundenen Karte (kein Magic-String, G25). Nur checkout-return.
const CARD_ON_FILE_STATUS = "card_on_file";

// deps: { config, store, audit, billing, tenant, costTruing }. config ist das globale
// Config-Objekt (paymentEnabled/publicUrl/stripeCustomerRetryDelayMs). store traegt
// load/save. audit ist util.audit (loggt nur Keys, keine Werte/Secrets). billing ist
// die EINE stripeBilling-Instanz (Stripe-Port). tenant buendelt die request-tenant-
// Resolver: requireTenant (tenant-gescopt; REJECT -> 403). costTruing ist die EINE
// LCT-P3-Instanz (INV-7, in server.js konstruiert).
export function makeBillingRoutes({ config, store, audit, billing, tenant: { requireTenant }, costTruing }) {
  const router = Router();

  // ---- Stripe-Metering-Flush (P6b3): aggregiert den usage_event-Ledger je tenant+kind
  // und meldet je Aggregat EIN reportMeter (idempotent ueber stripe_meter_sent). Hinter
  // Basic-Auth (Bestand deckt /api/* ab; localhost = Owner) - KEIN MCP-Tool. NUR im
  // Metering-Pfad erreichbar: ohne PAYMENT_ENABLED -> 404 (fail-closed, byte-identisch
  // zum Bestand). "Periodisch" = extern cron-baar (echter Scheduler = P8); KEIN neuer
  // Scheduler-Dep. Antwort = nur Zaehler {sent, failed} (KEINE Event-Inhalte, kein Secret).
  router.post("/api/billing/flush-meters", async (req, res) => {
    if (!requirePaymentEnabled(res, config, "metering disabled (PAYMENT_ENABLED)")) return;
    const result = await flushMeters(store.load(), { billing });
    store.save();
    audit("meter_flush", req, `sent=${result.sent} failed=${result.failed}`);
    res.json(result);
  });

  // ---- Karten-Erfassung via Stripe Checkout (setup-Mode), Pay1 ----
  // Hinter Basic-Auth (Bestand deckt /api/* ab; localhost = Owner). KEIN MCP-Tool
  // (kein offener ungegateter Geld-Endpunkt, R4). tenant-scoped (requireTenant ->
  // fail-closed 403 bei TENANT_REJECT). Ohne PAYMENT_ENABLED -> 404 (byte-identisch
  // zum Bestand, Muster flush-meters). Die Karte wird OHNE Abbuchung am Customer
  // gespeichert; der spaetere Hold/Capture (Pay2) nutzt customer+payment_method.
  router.post("/api/billing/setup-checkout", async (req, res) => {
    if (!requirePaymentEnabled(res, config)) return;
    if (!config.server.publicUrl) return res.status(500).json({ error: "PUBLIC_URL fehlt" }); // kein Leak
    const tenant = requireTenant(req, res); // tenant-gescopt; REJECT -> 403
    if (!tenant) return;

    const successUrl = `${config.server.publicUrl}/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.server.publicUrl}/tenant.html?card=canceled`;
    // Fix B: derselbe Self-Heal wie der Pay3-Pfad (geteilte Logik, G5 - s. card-setup.js).
    const { session, healed } = await startCheckoutWithStaleCustomerHeal(
      { store, billing, tenant, retryDelayMs: config.billing.stripeCustomerRetryDelayMs },
      (customerId) =>
        billing.createSetupCheckoutSession({ tenantRef: tenant, customerId, successUrl, cancelUrl }),
    );
    if (healed) audit("stripe_customer_self_heal", req, `tenant=${tenant}`);
    audit("billing_setup_checkout", req, `tenant=${tenant}`);
    res.json({ url: session.url });
  });

  // ---- Kosten-Abgleich manuell anstossen (LCT P3) ----
  // Hinter der bestehenden /api/*-Basic-Auth (server.js deckt /api/* ab) - KEIN MCP-Tool
  // (Muster flush-meters, R4: kein offener ungegateter Geld-naher Endpunkt). BEWUSST
  // OHNE PAYMENT_ENABLED-Gate: der Abgleich ist Beobachtung der Kosten-Achse, die - wie
  // reconcileOutboundVoiceBudget - auch ohne Zahlungspfad laeuft; ein 404 hier machte den
  // Job im heutigen Live-Betrieb unausloesbar. NICHT tenant-gescopt: ein Plattform-Job
  // ueber alle Tenants (Muster flush-meters). Antwort = NUR Zaehler + Quote, keine
  // Call-IDs, keine Rufnummern, keine Tenant-Kennungen. Ausloeser Nummer zwei neben dem
  // Intervall - der Laufriegel im Modul faengt die Ueberlappung.
  router.post("/api/billing/cost-truing/sweep", async (req, res) => {
    const result = await costTruing.runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
    audit("cost_truing_sweep", req, `skipped=${result.skipped} deckung=${result.coveragePercent ?? "-"}%`);
    res.json(result);
  });

  router.get("/api/billing/checkout-return", async (req, res) => {
    if (!requirePaymentEnabled(res, config)) return;
    const tenant = requireTenant(req, res); // tenant-gescopt; REJECT -> 403
    if (!tenant) return;
    const sessionId = req.query.session_id;
    if (!sessionId || typeof sessionId !== "string")
      return res.status(400).json({ error: "session_id ist Pflicht" });

    // Karte fail-closed an den eigenen Customer binden (geteilte Customer-Match-
    // Invariante, G5: identisch zum Self-Service-Pfad). Mismatch -> 403, kein Store.
    const { ok } = await bindCardFromSession({ store, billing, tenant, sessionId });
    if (!ok) {
      audit("billing_card_mismatch", req, `tenant=${tenant}`);
      return res.status(403).json({ error: "Customer-Mismatch" });
    }
    audit("billing_card_saved", req, `tenant=${tenant}`);
    res.json({ status: CARD_ON_FILE_STATUS });
  });

  return router;
}
