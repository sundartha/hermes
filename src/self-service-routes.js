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
// STRENGER als store.updateSettings (Admin): Lesen ueber die tenant-gefilterte Quelle
// exportTenantData; Schreiben ueber die engere Whitelist selfServicePatch VOR
// store.updateSettings (greeting nur als Vorlage; Permission-Flags nur restriktiver;
// alles andere abgelehnt). updateSettings bleibt UNVERAENDERT.
import { Router } from "express";
import { createSameOriginGuard } from "./middleware.js";
import { promptLineRejection } from "./routes/_validation.js";
import { selfServicePatch, hasCardOnFile, lockedSelfServiceKeys } from "./self-service.js";
import { greetingTemplatesFor } from "./i18n/greeting-catalog.js";
import { PERSONA_STYLE_IDS, localeFor } from "./i18n/locales.js";
import { bindCardFromSession, startCheckoutWithStaleCustomerHeal } from "./billing/card-setup.js";
import { requirePaymentEnabled, requirePublicUrl } from "./billing/payment-gate.js";
import {
  createTenantSubscription,
  priceIdForPlan,
  activateSubscriptionFromCheckoutSession,
  hasActiveSubscription,
  checkoutSessionIdempotencyKey,
} from "./billing/subscribe.js";
import { activatePaidTenant, profileAuditDetail } from "./billing/activation.js";
import { attemptCancellationMailConfirm } from "./billing/cancellation-mail.js";
import { setSubscriptionCancellation } from "./billing/subscription-cancellation.js";
import { provisionAuditDetail } from "./billing/provision-outcome.js";
// GP-P5: resolveAutoProvisionRetry ist der REINE Kern desselben Moduls - dieselbe
// Beurteilung, die den automatischen Wiederanlauf steuert, hier nur lesend fuer die
// Anzeige (G5: keine zweite Meinung ueber denselben Zustand).
import {
  PROVISION_RETRY_OUTCOME,
  resolveAutoProvisionRetry,
  retriggerFailedProvisioning,
} from "./billing/provision-retry.js";
import {
  publicCall,
  activeNumberFor,
  numberStatusFor,
  upcomingCalendar,
  tenantLanguage,
  NUMBER_DISPLAY_STATUS,
} from "./store/views.js";
import { tenantGeo } from "./store/state-ops.js";
import { holdAmountForCountry } from "./telephony/provisioning-geo.js";
// Fix A1 (Runde 1, G5): dieselbe Kauf-Land-Override-Kombination wie requestNumberForPaid-
// Tenant (provision-trigger.js) - EIN Ort statt einer dritten, abweichenden Inline-Kopie.
import { resolveNumberCountry } from "./geo/resolve.js";
import { isKnownPlanSlug } from "./plans.js";
import { tenantQuotaView } from "./billing/meter.js";
// P14: die Rueckkehr-Ziele nach Stripe Checkout kommen aus der EINEN Quelle
// (src/portal-paths.js) - dieselbe Konstante nutzt src/routes/api-billing.js fuer
// seine cancelUrl (frueher ein zweites, driftfaehiges Inline-Literal, G5).
import { CHECKOUT_RETURN } from "./portal-paths.js";
// F2-Newsletter-Recipients (Double-Opt-in): Gate-Entscheidung, Token-Bausteine, Seiten-Render
// - EINE Quelle (G5), geteilt mit call-finish.js (newsletterUnsubscribeUrl).
import {
  planAddNewsletterRecipient,
  newNewsletterTokens,
  newsletterConfirmUrl,
  hashNewsletterToken,
  normalizeEmail,
  publicNewsletterRecipients,
  renderNewsletterPage,
} from "./newsletter-recipients.js";
// hashEmail: PII-freier Adress-Fingerprint fuers audit_log (Owner-Auftrag: "gehashter
// Adress-Fingerprint, NIE die Adresse selbst"). safeEqual wird hier NICHT direkt gebraucht -
// der Token-Vergleich liegt in state-ops.js (confirmNewsletterRecipientByToken/
// unsubscribeNewsletterRecipientByToken).
import { hashEmail } from "./util.js";

// AM4: maschinenlesbarer Funnel-Hinweis im no_card-Response. Der Client (lib/subscribe.js)
// springt bei next==="setup-checkout" deterministisch in die Karten-Erfassung, statt ein
// nacktes 409 als Sackgasse zu sehen. Kein Magic-String (G25); spiegelbildlich
// SETUP_CHECKOUT_NEXT im Frontend (Contract-String ueber die Origin-Grenze, wie die error-Codes).
const NEXT_SETUP_CHECKOUT = "setup-checkout";

// ---- GP-P5: WARUM die Nummern-Einrichtung haengt --------------------------------
// Das Dashboard zeigte bei 'failed' genau einen Satz: "Einrichtung der Nummer
// fehlgeschlagen". Kein Grund, kein naechster Schritt - obwohl der Server den Grund seit
// GP-P2/P3 KENNT. Fuer den Vorfall vom 11.09. war der Unterschied entscheidend: die
// Zahlungsmethode (Typ 'link') kann strukturell keinen Hold tragen, es half also kein
// Warten und kein erneutes Klicken, sondern ausschliesslich eine Karte. Genau das stand
// nirgends.
//
// EINE Quelle (G5): der Grund kommt aus DEMSELBEN Entscheidungskern, der ueber den
// automatischen Wiederanlauf entscheidet (resolveAutoProvisionRetry) - keine zweite,
// driftfaehige Beurteilung derselben Lage. Der Kern ist rein und liest nur den State;
// diese Lesekante bewegt kein Geld und stoesst nichts an.
//
// Die Kunden-Vokabel ist BEWUSST GROEBER als das interne Enum: sie unterscheidet nur,
// was der Kunde unterschiedlich behandeln muss - selbst handeln (Karte), warten (laeuft
// automatisch), oder Support. Interne Ausgaenge wie DISABLED (Not-Aus) oder ERROR nennen
// wir ihm nicht als solche; fuer ihn zaehlt, dass von allein nichts mehr passiert.
// Sprachneutrale Token wie ueberall in dieser Datei - die Texte liegen im Frontend
// (apps/web/src/lib/api.js).
const NUMBER_SETUP_REASON = Object.freeze({
  PAYMENT_METHOD: "payment_method_unsuitable", // Kunde kann handeln: Karte hinterlegen
  RETRY_PENDING: "retry_pending", // laeuft automatisch weiter, nichts zu tun
  MANUAL: "manual_review", // von allein passiert nichts mehr -> Support
});

const REASON_JE_AUSGANG = Object.freeze({
  [PROVISION_RETRY_OUTCOME.PAYMENT_METHOD_UNSUITABLE]: NUMBER_SETUP_REASON.PAYMENT_METHOD,
  [PROVISION_RETRY_OUTCOME.RETRY]: NUMBER_SETUP_REASON.RETRY_PENDING,
  [PROVISION_RETRY_OUTCOME.THROTTLED]: NUMBER_SETUP_REASON.RETRY_PENDING,
});

// Der Grund NUR im 'failed'-Zustand. Die Gate-Reihenfolge des Kerns beantwortet den
// Not-Aus (DISABLED) VOR dem Zustands-Gate - ohne diese eigene Vorpruefung truege ein
// abgeschalteter Wiederanlauf jedem Mandanten einen Grund an, auch dem mit laufender
// Nummer. Unbekannter/kuenftiger Ausgang -> MANUAL (fail-closed: lieber "meld dich"
// als eine Zusage, dass es von allein weitergeht).
function numberSetupReason(state, { tenantId, numberStatus, maxAttempts }) {
  if (numberStatus !== NUMBER_DISPLAY_STATUS.FAILED) return "";
  const { outcome } = resolveAutoProvisionRetry(state, { tenantId, maxAttempts });
  return REASON_JE_AUSGANG[outcome] || NUMBER_SETUP_REASON.MANUAL;
}

// Die Agent-Sicht der /state-Antwort an EINER Stelle (Muster paymentView): Nummer,
// Besitzer, Anzeige-Status - und additiv der Grund. Ein aelterer Client ohne das Feld
// rendert unveraendert.
function agentView(state, { tenantId, ownerName, maxAttempts }) {
  const numberStatus = numberStatusFor(state, tenantId);
  return {
    number: activeNumberFor(state, tenantId),
    owner: ownerName,
    numberStatus,
    numberStatusReason: numberSetupReason(state, { tenantId, numberStatus, maxAttempts }),
  };
}

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
  if (!config.billing.paymentEnabled) return {};
  const { planSlug, currentPeriodEnd, cancelAtPeriodEnd } = store.tenantSubscription(tenant);
  return {
    hasCard: hasCardOnFile(store.tenantStripe(tenant)),
    // 312k-P1 Teil B: cancelAtPeriodEnd + currentPeriodEnd zusammen tragen genug, damit
    // die Oberflaeche spaeter "gekuendigt zum TT.MM." anzeigen kann (sprachneutraler
    // Feldname, kein UI/Route in dieser Phase).
    subscription: { planSlug, currentPeriodEnd, cancelAtPeriodEnd },
    // BK4/B3 (Kommentar-Bestand bleibt) ... KS-P8: die Zusammenstellung der quotaView-
    // Argumente liegt seit dieser Phase EINMAL in billing/meter.js (tenantQuotaView) -
    // /api/state braucht dieselbe Sicht, und zwei Kopien der Destrukturierung wuerden
    // driften (G5). Rueckgabewert byte-identisch zum Bestand.
    quota: tenantQuotaView(store, tenant),
  };
}

// Phase A (PLAN-VOUCHER-SETUP-FEE-GAP.md): der Land-abhaengige Setup-Tarif (P9-Hold,
// provisioning-geo.js) - GENAU dieselbe Formel, die runProvisioningDrain (server.js) beim
// ECHTEN Kauf anwendet (EINE Quelle, kein Drift zwischen Anzeige und tatsaechlichem Hold-
// Betrag). tenantGeo liest das HERKUNFTSland, das /api/onboard bereits gesetzt hat; das
// tatsaechliche KAUF-Land kann davon abweichen (config.provisioning.forceNumberCountry, z.B. US -
// dieselbe Override-Kombination wie requestNumberForPaidTenant in provision-trigger.js,
// via resolveNumberCountry, G5). Noch kein Onboard (kein country, kein Override) ->
// holdAmountForCountry faellt auf den globalen Default. Nur bei PAYMENT_ENABLED relevant
// (sonst haelt provisionNumber gar keinen Hold) -> 0 sonst (kein irrefuehrender Betrag;
// die aufrufende UI blendet den Billing-Block dann ohnehin aus).
function numberSetupFeeCentsFor(s, config, tenant) {
  if (!config.billing.paymentEnabled) return 0;
  const { country: homeCountry } = tenantGeo(s, tenant);
  const country = resolveNumberCountry(homeCountry, config.provisioning.forceNumberCountry);
  return holdAmountForCountry(country, config.billing.numberSetupFeeCents);
}

// BK2: Reiner Selektor (N7, kein Nebeneffekt): untrusted Input (Body ODER zurueckgetragene
// Query) -> bekannter Katalog-Slug oder null. SSoT = isKnownPlanSlug (G5, kein zweites Literal).
function knownPlanSlug(raw) {
  return typeof raw === "string" && isKnownPlanSlug(raw) ? raw : null;
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
  const successUrl = returnSuccessUrl(config.server.publicUrl, planSlug);
  const cancelUrl = `${config.server.publicUrl}${CHECKOUT_RETURN.CARD_CANCELED}`;
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
    idempotencyKey: checkoutSessionIdempotencyKey({ tenant, planSlug, priceId, customerId }),
  });
}

// BK2: Geteilte Buchungs-Sequenz hinter BEIDEN Eingaengen (G5/S2). Bucht fail-closed
// (createTenantSubscription) + aktiviert NUR bei Erfolg voll (activatePaidTenant:
// status=active + kyc=CARD + idempotentes Provisioning). KEIN HTTP/Audit hier (G34).
async function subscribeAndActivate({ store, billing, config, accounts, provision, tenant, planSlug }) {
  const result = await createTenantSubscription({ store, billing, config, tenant, planSlug });
  if (!result.ok) return result;
  const { profile, provisioned } = await activatePaidTenant({ store, accounts, provision, billing, tenant });
  return { ...result, profile, provisioned };
}

// Express 4 leitet abgelehnte Promises aus async-Handlern NICHT an die Fehler-Kette ->
// ein geworfener Stripe-/Netzwerkfehler liesse die Anfrage HAENGEN (nie ein Response,
// haengende Verbindung = Verfuegbarkeitsrisiko bei Skala). Dieser Wrapper faengt den
// Fehler, loggt err.message und ruft einen Responder (JSON 502 bzw. Redirect), sodass
// IMMER geantwortet wird. Erwartete fachliche Ablehnungen (no_card etc.) laufen NICHT
// hierueber - die behandelt der Handler selbst.
//
// WAS IN DIESER ZEILE LANDET, GENAU (GP-P1 - der alte Kommentar behauptete pauschal
// "op+Status, kein Secret" und war fuer die Stufe-3-Aufrufer falsch): Secrets nie, die
// liegen nur im Request-Header (Regel 4). Der Abo-Aufbau (subscribe -> createSubscription)
// liefert seit GP-P1 op + HTTP-Status + das Enum-Trio code/decline_code/type - genau die
// Zeile, die am 11.09.2026 fehlte, ohne die Kundendaten, die damals stattdessen drin
// standen. VERBLIEBEN: die beiden Checkout-SESSION-Aufbauten (setup-checkout) haengen
// weiterhin den Provider-Rohtext an - dort ist noch keine Zahlungsmethode am Vorgang,
// der Koerper traegt also keine Kundendaten. Das ist eine benannte Reichweite, keine
// Zusage fuer jeden kuenftigen Aufrufer.
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
// 312k-P3: auditStore ist OPTIONAL injiziert (Default {} -> record() bleibt unaufgerufen,
// wenn ein Aufrufer/Test es weglaesst - Muster accounts/provision in
// self-service-error-codes.test.js, die dort ebenfalls fehlen, weil die dort gepruefte
// Route sie nie beruehrt). NUR die Kuendigungs-/Ruecknahme-Route greift darauf zu.
// 312k-Phase 5: mailer ist OPTIONAL injiziert (Default null -> attemptCancellationMailConfirm
// erkennt "kein Mailer konstruiert" fail-soft, Muster workos in contract-end-cleanup.js).
// NUR die cancel-Route greift darauf zu (resume bekommt bewusst KEINE Mail, s. Auftrag).
// GP-P3: Nachlauf der reinen Karten-Rueckkehr, nachdem die Karte gebunden ist. Zwei
// Schritte auf EINER Abstraktionsebene: das gescheiterte Nummern-Provisioning wieder
// anstossen und den Ausgang dieser Entscheidung auditieren (ohne ihn waere im Betrieb
// nicht unterscheidbar, ob angestossen oder stillschweigend nichts getan wurde).
//
// Mit dem Anstoss wird aus der reinen Karten-Speicher-Route eine GELDBEWEGENDE - sie
// traegt das Abo-/KYC-Gate deshalb selbst. Es sitzt im Entscheidungskern
// (billing/provision-retry.js), zusammen mit dem Versuchsdeckel und der Eignung der
// frisch gebundenen Zahlungsmethode. Steht der Mandant nicht auf 'failed', ist der
// ganze Nachlauf ein No-op und die Antwort byte-identisch zum Bestand.
//
// Fail-soft: die Karte IST an dieser Stelle gebunden - ein Fehlschlag des Wiederanlaufs
// darf daraus nie "Karte fehlgeschlagen" machen (retriggerFailedProvisioning
// wirft nie). Deshalb steht er NACH der Bindung und nicht in ihr.
async function finishCardOnlyReturn({ store, provision, config, audit, req, tenant }) {
  const { outcome } = await retriggerFailedProvisioning({
    store,
    provision,
    tenantId: tenant,
    maxAttempts: config.provisioning.provisioningRetryMaxAttempts,
  });
  audit("self_service_card_saved", req, `tenant=${tenant} wiederanlauf=${outcome}`);
}

export function makeSelfServiceRoutes({
  store,
  webAuthMw,
  webAuthPendingMw,
  audit,
  config,
  billing,
  accounts,
  provision,
  auditStore = { record: async () => {} },
  mailer = null,
}) {
  const router = Router();

  // Tenant-Lese-Sicht: dieselbe tenant-gefilterte Quelle wie /api/state, aber NUR
  // ueber die Web-Session-Identitaet. + die kuratierten greeting-Vorlagen, damit die
  // UI ein Dropdown statt Freitext zeigt (Decision #7).
  router.get("/api/self-service/state", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    const data = store.exportTenantData(tenant);
    const ctx = store.tenantContext(tenant);
    // s einmal laden fuer agent.number + numberStatus (selbe Quelle wie /api/state, G5;
    // eine Last statt zweier store.load()-Aufrufe).
    const agentState = store.load();
    // P9 (WEB-01/WEB-04): EINE Sprachaufloesung fuer diese Antwort (G5) - sie speist die
    // Vorlagenmenge UND das Sprach-Feld, aus dem das Dashboard sein lang-Attribut setzt.
    const language = tenantLanguage(agentState, tenant);
    // F2-Mail: Konto-E-Mail als additives Feld (Dashboard-Prefill fuer das Newsletter-
    // Feld, kein Schreibpfad). Dedizierter Lookup, Schluessel req.tenant.tenantId (nie
    // fremd, H3). Fail-closed: kein accounts-Adapter (pg-Web-Login-Block nicht gemountet,
    // Muster f2-self-service-state-private-number.test.js) ODER kein/mehrdeutiger Account
    // ODER ein IO-Fehler beim Lookup -> null. Ein flackernder Adress-Lookup darf die
    // gesamte Dashboard-Ansicht nicht reissen - die eigentliche Autoritaet fuer die
    // Empfaengeradresse bleibt accounts.accountByTenant selbst (Muster
    // billing/cancellation-mail.js), hier ist es nur eine Anzeige.
    let accountEmail = null;
    if (accounts) {
      try {
        const account = await accounts.accountByTenant(tenant);
        accountEmail = account?.email ?? null;
      } catch (e) {
        console.error("[self-service] accountEmail lookup:", e.message);
      }
    }
    res.json({
      settings: ctx.settings,
      // WEB-01: die aufgeloeste Sprache dieses Tenants als eigenes, additives Feld.
      // settings.language taugt dafuer NICHT - es ist per Default null; die Praezedenz
      // (settings -> number -> tenant) gehoert in den Server, nicht in den Client.
      language,
      // P15b/C2: die EINE BCP-47-Formatlocale dieses Dashboards - sie regiert Datum/Zeit
      // UND Zahl/Waehrung, deshalb heisst das Feld formatLocale und nicht mehr dateLocale.
      // Sie folgt DERSELBEN Aufloesung wie das lang-Attribut (WEB-01); die Abbildung
      // Sprache -> Locale lebt an genau EINER Stelle (i18n/locales.js, dieselbe Quelle wie
      // mcp-tools.js makeDateFormatter). Der Client bekommt sie fertig und leitet NICHTS ab
      // (kein navigator.language, keine zweite Praezedenz).
      // GELD-ACHSE: hier reist NUR die Darstellung. Der Waehrungscode kommt aus den Daten
      // (Feld currency unten bzw. plan.currency aus dem Katalog) und wird NIE aus einer
      // Locale abgeleitet - Anzeige-Waehrung == Belastungs-Waehrung (Entscheidung 7.1/O12).
      // Der Buendel-Schluessel heisst weiterhin dateLocale: er speist ausser dieser Route
      // auch claude.js und mcp-tools.js; eine Umbenennung dort gehoert in eine Runde, die
      // alle drei Konsumenten zusammen betrachtet.
      formatLocale: localeFor(language).dateLocale,
      // WEB-04: Vorlagen in der Sprache, in der dieser Tenant auch telefoniert
      // (gleiche Praezedenz wie im Anruf, G5) - agentState ist oben bereits geladen.
      greetingTemplates: greetingTemplatesFor(language),
      // P4: kuratierte Stil-IDs fuers Dropdown (EINE Quelle = das P2-Enum; das Client-
      // Dropdown haelt KEIN eigenes ID-Set, G5/S2). Fehlt das Feld -> UI versteckt die
      // Karte (Flag-aus / alter Server) - I9-Muster wie hasCard beim billingCard.
      personaStyleIds: PERSONA_STYLE_IDS,
      // F2 P6: die EIGENE private Summary-Nummer (maskiert, s. maskPrivateNumber).
      // Dedizierter Record-Reader, Schluessel req.tenant.tenantId (nie fremd, H3) - NIE
      // ueber settings/tenantContext, die ueber /api/state + MCP komplett leaken (H4).
      privateNumber: maskPrivateNumber(store.tenantPrivateNumber(tenant)),
      // Newsletter-Einwilligung (Opt-in, DSGVO Art. 7 Abs. 1): dedizierter Record-Reader
      // (Muster privateNumber oben), NIE ueber settings/tenantContext (H4). consent ist
      // NIE vorangekreuzt (Default false, s. schema.sql); consentAt ist der Zeitstempel
      // des letzten Wechsels (Opt-in ODER Widerruf) oder null, wenn nie gesetzt. Die UI
      // haengt hier spaeter nur noch eine Checkbox an - dieses Feld traegt ihren Zustand.
      newsletter: store.tenantNewsletterConsent(tenant),
      // F2-Mail: Konto-E-Mail (s. Lookup oben) - reine Anzeige fuers Newsletter-Feld
      // (readonly Prefill), NIE ein Schreibziel; fail-closed null (s. oben).
      accountEmail,
      // F2-Newsletter-Recipients (Double-Opt-in): additive Liste der Zusatzempfaenger.
      // publicNewsletterRecipients strippt Tokens/Hashes (Owner-Auftrag: "KEINE Tokens/
      // Hashes in der Antwort") - nur email/status/createdAt verlassen den Server.
      newsletterRecipients: publicNewsletterRecipients(store.tenantNewsletterRecipients(tenant)),
      // Pay3/W4: Karten- + Abo-Status. KEIN id-Leak (cus_/pm_/sub_ sind keine Secrets,
      // gehoeren aber nicht in die UI-View) - nur "Karte liegt vor ja/nein" + der aktive
      // Plan/Periode. Bei PAYMENT_ENABLED aus: Felder fehlen -> UI versteckt den Block,
      // Lese-View byte-identisch zum Bestand. (s. paymentView, eine Quelle).
      ...paymentView(store, config, tenant),
      // Phase A (PLAN-VOUCHER-SETUP-FEE-GAP.md): der Land-abhaengige Setup-Tarif, VOR dem
      // Subscribe-Klick sichtbar (die Plan-Kacheln lesen genau dieses Feld). currency
      // ungegated (nicht geheim, wie PLAN_CATALOG.currency immer gesetzt).
      numberSetupFeeCents: numberSetupFeeCentsFor(agentState, config, tenant),
      currency: config.billing.paymentCurrency,
      calls: data.calls.map(publicCall),
      actionItems: data.actionItems,
      // P2a: der Meldungs-Feed - dieselbe tenant-gescopte Quelle wie calls/actionItems
      // (exportTenantData filtert auf die callIds DIESES Tenants, kein Fremd-Leak, H3).
      // Additiv: ein alter Client ohne das Feld rendert wie bisher. Keine Slice - die
      // Menge ist bereits durch MAX_NOTIFICATIONS im Store begrenzt (wie actionItems).
      notifications: data.notifications,
      calendar: upcomingCalendar(store, tenant),
      agent: agentView(agentState, {
        tenantId: tenant,
        ownerName: ctx.ownerName,
        maxAttempts: config.provisioning.provisioningRetryMaxAttempts,
      }),
    });
  });

  // Self-Service-Settings-Schreiben: ENGERE Whitelist (selfServicePatch) DAVOR, dann
  // die bestehende strenge updateSettings (Key/Typ). Nur Keys auditieren (greeting-
  // Wert/PII gehoeren nicht ins Log, wie bei store.updateSettings).
  router.post("/api/self-service/settings", webAuthMw, (req, res) => {
    const tenant = req.tenant.tenantId;
    // O9/E2E-01: Landwechsel ist vorerst NICHT self-service-faehig - stabiler 409 statt
    // des stillen 200-OK-No-Op. 409 (Conflict), weil das Land bereits gebunden ist (DID,
    // Tarif, Sprache); "remedy" ist ein sprachneutraler Token (WEB-09-Vokabelform wie
    // invalid_private_number/no_card) und verweist auf den manuellen Support-Pfad -
    // KEIN Freitext, keine Sprachannahme. Vor jedem Store-Zugriff: der Patch wirkt
    // NICHT, auch nicht teilweise.
    const locked = lockedSelfServiceKeys(req.body);
    if (locked.length) {
      audit("self_service_settings_denied", req, `locked=${locked.join(",")}`);
      return res.status(409).json({ error: "country_change_unsupported", remedy: "contact_support" });
    }
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
      // P9 (WEB-09): stabiler, sprachneutraler Code statt deutschem Klartext - gleiche
      // Vokabelform wie no_card/already_subscribed/plan_unconfigured in dieser Datei.
      return res.status(400).json({ error: "invalid_private_number" });
    }
    const stored = store.tenantPrivateNumber(tenant) != null;
    audit("self_service_private_number", req, `outcome=${stored ? "set" : "cleared"}`);
    res.json({ ok: true, hasPrivateNumber: stored });
  });

  // ---- Newsletter-Einwilligung (Opt-in, DSGVO Art. 7 Abs. 1) ----------------------
  // DEDIZIERTE Route (NICHT die settings-Whitelist selfServicePatch/updateSettings,
  // Muster private-number oben): die Einwilligung ist eine Erklaerung der Person/des
  // Accounts, keine Agent-Verhaltens-Einstellung, und lebt am Tenant-RECORD (NICHT in
  // settings - settings leakt komplett ueber /api/state + MCP, H4). NUR strikt boolean:
  // der Setter wirft fail-closed VOR jeder Mutation bei jedem anderen Wert (kein
  // Freitext/Zahl/undefined als "eingewilligt" fehlinterpretierbar) -> 400, alter Wert
  // bleibt (H2, Muster private-number). Identitaet = Web-Session (req.tenant.tenantId),
  // NIE ein fremder Tenant. Zusaetzlich zum schnellen Lese-Feld am Tenant-Record wird
  // JEDER tatsaechliche Zustandswechsel als unveraenderlicher Nachweis in audit_log
  // geschrieben (auditStore.record, Muster 312k-P3 Kuendigungs-Nachweis) - Art. 7 Abs. 1
  // verlangt mehr Nachweisbarkeit, als ein blankes Boolean liefern kann. Ein Fehlschlag
  // des Audit-Schreibens blockt die Antwort NICHT (die Einwilligung selbst ist bereits
  // persistiert; der Fehler wird geloggt, kein haengender Request).
  router.post("/api/self-service/newsletter-consent", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    const { consent } = req.body || {};
    try {
      store.setNewsletterConsent(tenant, consent);
    } catch {
      audit("self_service_newsletter_consent", req, "outcome=rejected");
      // Stabiler, sprachneutraler Code statt deutschem Klartext - gleiche Vokabelform
      // wie invalid_private_number/no_card/already_subscribed in dieser Datei.
      return res.status(400).json({ error: "invalid_newsletter_consent" });
    }
    try {
      await auditStore.record({
        actorSub: req.tenant.sub,
        tenantId: tenant,
        action: consent
          ? "self_service_newsletter_consent_granted"
          : "self_service_newsletter_consent_revoked",
      });
    } catch (err) {
      console.error(`self-service newsletter-consent audit write failed: ${err.message}`);
    }
    audit("self_service_newsletter_consent", req, `outcome=${consent ? "granted" : "revoked"}`);
    res.json({ ok: true, newsletterConsent: consent });
  });

  // ---- F2-Newsletter-Recipients: Zusatzempfaenger (Double-Opt-in) ------------------
  // DEDIZIERTE Routen (Muster private-number/newsletter-consent oben), NICHT die settings-
  // Whitelist: Zusatzempfaenger sind PII eines DRITTEN (nicht des Accounts) und leben am
  // Tenant-RECORD, NIE in settings (H4). Gates in planAddNewsletterRecipient (newsletter-
  // recipients.js): Format -> Duplikat (auch gegen die Konto-Adresse) -> Cap (5) ->
  // Tageslimit Bestaetigungs-Mails (Missbrauchsschutz). Antwort ohne Token (Owner-Auftrag).
  router.post("/api/self-service/newsletter-recipients", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    const rawEmail = (req.body || {}).email;
    // Konto-E-Mail fuer die Duplikat-Pruefung - derselbe fail-closed Lookup wie oben
    // (accountEmail-Prefill): ein flackernder Lookup darf den Add-Versuch nicht reissen,
    // im Zweifel wird ohne Konto-Abgleich geprueft (die Listen-Duplikat-Pruefung bleibt
    // unberuehrt).
    let accountEmail = null;
    if (accounts) {
      try {
        const account = await accounts.accountByTenant(tenant);
        accountEmail = account?.email ?? null;
      } catch (e) {
        console.error("[self-service] newsletter-recipients accountEmail lookup:", e.message);
      }
    }
    const plan = planAddNewsletterRecipient({ store, tenantId: tenant, rawEmail, accountEmail });
    if (!plan.ok) {
      audit("self_service_newsletter_recipient_add", req, `outcome=rejected reason=${plan.reason}`);
      return res.status(400).json({ error: plan.reason });
    }
    const tokens = newNewsletterTokens();
    store.addNewsletterRecipient(tenant, {
      email: plan.email,
      tokenHash: tokens.tokenHash,
      tokenExpiresAt: tokens.tokenExpiresAt,
      unsubToken: tokens.unsubToken,
    });
    // Bestaetigungs-Mail auf bestem Bemuehen (fail-soft, Muster attemptCancellationMailConfirm):
    // der pending-Eintrag ist bereits persistiert, ein Mailer-Fehler darf die Antwort NICHT
    // blockieren - kein Retry-Sweep in dieser Etappe (Auftrag nennt keinen; das Tageslimit
    // oben deckt den Missbrauchsfall, ein erneuter Versuch nach Entfernen ist der
    // Recovery-Pfad des Nutzers). Ohne Mailer (nicht konfiguriert) bleibt der Eintrag
    // pending, aber ohne Aussicht auf Bestaetigung - dokumentierte, bewusste Grenze.
    if (mailer) {
      try {
        const language = tenantLanguage(store.load(), tenant);
        const ownerName = store.tenantContext(tenant).ownerName;
        const t = localeFor(language).newsletter;
        const confirmUrl = newsletterConfirmUrl(config.server.publicUrl, tokens.confirmToken);
        await mailer.sendMail({
          to: plan.email,
          subject: t.confirmMailSubject,
          text: t.confirmMailText(ownerName, confirmUrl),
        });
      } catch (e) {
        console.error("[newsletter-confirm-mail]", e.message);
      }
    }
    try {
      await auditStore.record({
        actorSub: req.tenant.sub,
        tenantId: tenant,
        action: "self_service_newsletter_recipient_added",
        detail: `email_fp=${hashEmail(plan.email)}`,
      });
    } catch (err) {
      console.error(`self-service newsletter-recipients audit write failed: ${err.message}`);
    }
    audit("self_service_newsletter_recipient_add", req, "outcome=pending");
    res.json({ ok: true, status: "pending" });
  });

  // Entfernen (pending ODER confirmed) - idempotent, kein Fehler bei unbekannter Adresse
  // (Muster resume/unschedule: derselbe Endzustand ist kein Fehlschlag).
  router.delete("/api/self-service/newsletter-recipients", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    const email = normalizeEmail((req.body || {}).email);
    const changed = store.removeNewsletterRecipient(tenant, email);
    try {
      await auditStore.record({
        actorSub: req.tenant.sub,
        tenantId: tenant,
        action: "self_service_newsletter_recipient_removed",
        detail: `email_fp=${hashEmail(email)} changed=${changed}`,
      });
    } catch (err) {
      console.error(`self-service newsletter-recipients audit write failed: ${err.message}`);
    }
    audit("self_service_newsletter_recipient_remove", req, `outcome=${changed ? "removed" : "not_found"}`);
    res.json({ ok: true, removed: changed });
  });

  // ---- F2-Newsletter-Recipients: oeffentliche Bestaetigung/Abmeldung --------------
  // AUTH-AUSNAHME (Regel 3, begruendet): der Empfaenger hat KEIN Dashboard/keine Session -
  // die einzige Absicherung ist der kryptografisch unratbare Token (32 Byte, s. newsletter-
  // recipients.js), timing-sicher verglichen (safeEqual in state-ops.js). Idempotente GETs
  // ohne Zustandsaenderung am AUFRUFER (nur am ZIEL-Tenant) -> kein CSRF-Risiko (Muster
  // /voice/tts/:token). route-policy.js traegt den PUBLIC_ROUTES-Eintrag. Beide Routen
  // liefern IMMER dieselbe neutrale HTML-Form (Owner-Auftrag: "OHNE Aufschluss, ob die
  // Adresse existiert"), niemals JSON - kein Dashboard-Client konsumiert sie.
  router.get("/newsletter/confirm", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const result = token
      ? store.confirmNewsletterRecipientByToken(hashNewsletterToken(token), new Date().toISOString())
      : null;
    const language = result ? tenantLanguage(store.load(), result.tenantId) : null;
    const t = localeFor(language).newsletter;
    if (!result) {
      audit("newsletter_recipient_confirm_failed", req, "reason=invalid_or_expired");
      return res
        .status(400)
        .type("html")
        .send(renderNewsletterPage({ title: t.invalidPageTitle, body: t.invalidPageBody, lang: language || "de" }));
    }
    auditStore
      .record({
        tenantId: result.tenantId,
        action: "newsletter_recipient_confirmed",
        detail: `email_fp=${hashEmail(result.email)}`,
      })
      .catch((err) => console.error(`newsletter confirm audit write failed: ${err.message}`));
    audit("newsletter_recipient_confirmed", req, `tenant=${result.tenantId}`);
    res
      .type("html")
      .send(renderNewsletterPage({ title: t.confirmedPageTitle, body: t.confirmedPageBody, lang: language }));
  });

  router.get("/newsletter/unsubscribe", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const result = token ? store.unsubscribeNewsletterRecipientByToken(token) : null;
    const language = result ? tenantLanguage(store.load(), result.tenantId) : null;
    const t = localeFor(language).newsletter;
    if (!result) {
      audit("newsletter_recipient_unsubscribe_failed", req, "reason=invalid_or_already_removed");
      return res
        .status(400)
        .type("html")
        .send(renderNewsletterPage({ title: t.invalidPageTitle, body: t.invalidPageBody, lang: language || "de" }));
    }
    auditStore
      .record({
        tenantId: result.tenantId,
        action: "newsletter_recipient_unsubscribed",
        detail: `email_fp=${hashEmail(result.email)}`,
      })
      .catch((err) => console.error(`newsletter unsubscribe audit write failed: ${err.message}`));
    audit("newsletter_recipient_unsubscribed", req, `tenant=${result.tenantId}`);
    res
      .type("html")
      .send(
        renderNewsletterPage({ title: t.unsubscribedPageTitle, body: t.unsubscribedPageBody, lang: language }),
      );
  });

  // ---- P5: schlanker Billing-Status fuer die gefuehrte Aktivierung -----------------
  // Hinter webAuthPendingMw (suspended erreichbar): liefert NUR die Flags, die die
  // Aktivierungs-Ansicht (403-Zweig der App-Shell) braucht - paymentEnabled (gibt es etwas
  // zu tun?), hasCard (zuerst Karte?), planSlug (schon abonniert?), status (schon aktiv?).
  // OEFFNET NICHT die active-only /state-View: kein calls/settings/Nummer-Leak (H4). Reine
  // Lifecycle-Flags, keine Secrets/PII (kein cus_/sub_/pm_). Read-only -> kein Audit (wie /state).
  router.get("/api/self-service/billing/status", webAuthPendingMw, (req, res) => {
    const tenant = req.tenant.tenantId;
    const s = store.load();
    res.json({
      paymentEnabled: !!config.billing.paymentEnabled,
      hasCard: hasCardOnFile(store.tenantStripe(tenant)),
      planSlug: store.tenantSubscription(tenant).planSlug,
      status: req.tenant.status,
      // Phase A: identisch zur /state-Route (numberSetupFeeCentsFor, EINE Quelle) - dieser
      // Endpunkt ist der einzige, den ein SUSPENDIERTER Tenant vor dem Checkout sieht.
      numberSetupFeeCents: numberSetupFeeCentsFor(s, config, tenant),
      currency: config.billing.paymentCurrency,
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
        if (!requirePaymentEnabled(res, config)) return;
        // WEB-10: stabiler, sprachneutraler Code statt deutschem Klartext mit Env-Namen -
        // gleiche Vokabelform wie plan_unconfigured/already_subscribed weiter unten.
        if (!requirePublicUrl(res, config)) return;
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
        // Fix B (PLAN-CHECKOUT-STALE-STRIPE-CUSTOMER.md): Customer-Ermittlung + Checkout-
        // Start ueber den Self-Heal-Wrapper - eine tote customerId (Stripe resource_missing)
        // fuehrt zu EINEM automatischen Neuanlauf mit frischem Customer statt zu 502.
        const { session, healed } = await startCheckoutWithStaleCustomerHeal(
          { store, billing, tenant, retryDelayMs: config.billing.stripeCustomerRetryDelayMs },
          (customerId) =>
            createCheckoutSession({ billing, config, tenant, customerId, planSlug, priceId }),
        );
        // Eigener, alarmierbarer Event-Typ (Muster self_service_subscription_conflict):
        // gehaeufte Heals = Stripe-Account-Problem, darf nie stumm bleiben.
        if (healed) audit("stripe_customer_self_heal", req, `tenant=${tenant}`);
        audit(
          "self_service_setup_checkout",
          req,
          `tenant=${tenant}${planSlug ? ` plan=${planSlug} mode=subscription` : ""}`,
        );
        res.json({ url: session.url });
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
        if (!requirePaymentEnabled(res, config)) return;
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
          // GP-P3: Nachlauf der reinen Karten-Rueckkehr (Wiederanlauf + Audit) - er lebt
          // als eigene Funktion ausserhalb dieser Router-Fabrik (G30).
          await finishCardOnlyReturn({ store, provision, config, audit, req, tenant });
          return res.redirect(CHECKOUT_RETURN.CARD_OK); // 302 -> "Karte hinterlegt"
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
          return res.redirect(CHECKOUT_RETURN.SUB_FAILED);
        }
        audit(
          "self_service_subscribe",
          req,
          `tenant=${tenant} plan=${carriedPlan} outcome=${result.ok ? "ok" : result.reason} ` +
            `${profileAuditDetail(result.profile)} ${provisionAuditDetail(result.provisioned)}`,
        );
        // already_subscribed = idempotent-erfolgreich (Doppel-Redirect/Reload derselben
        // Session, Abo ist aktiv) -> sub=ok. Jeder andere/kuenftige reason -> sub=failed.
        const succeeded = result.ok || result.reason === "already_subscribed";
        res.redirect(succeeded ? CHECKOUT_RETURN.SUB_OK : CHECKOUT_RETURN.SUB_FAILED);
      },
      (res) => res.redirect(CHECKOUT_RETURN.CARD_ERROR),
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
        if (!requirePaymentEnabled(res, config)) return;
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
        audit(
          "self_service_subscribe",
          req,
          `tenant=${tenant} plan=${planSlug} ${profileAuditDetail(result.profile)} ${provisionAuditDetail(result.provisioned)}`,
        );
        res.json({ plan: result.planSlug, currentPeriodEnd: result.currentPeriodEnd });
      },
      billingUnavailable,
    ),
  );

  // ---- 312k-P3: Kuendigung zum Periodenende (§ 312k BGB) --------------------------
  // webAuthMw (NICHT webAuthPendingMw wie subscribe/setup-checkout): nur ein AKTIVER
  // Tenant hat ueberhaupt etwas zu kuendigen - suspended (Zahlung ausstehend) und closed
  // (Abo bereits vollstaendig beendet, webhook.js SUSPEND) kommen fail-closed gar nicht
  // erst durch die Middleware (403), bevor der Handler ueberhaupt laeuft. Gate VOR jedem
  // Stripe-Call: kein Abo -> 409 no_subscription (sprachneutraler Token, Muster
  // no_card/already_subscribed). Bereits vorgemerkt -> idempotent (setSubscriptionCancellation
  // liest den Zustand VOR dem Stripe-Call): derselbe Endzustand, derselbe Antwortkoerper,
  // kein zweiter Stripe-Call, kein zweiter Audit-Nachweis - ein Doppelklick erzeugt keinen
  // zweiten Vorgang. Nachweis auf dauerhaftem Datentraeger (§ 312k): auditStore.record
  // (Postgres audit_log), NICHT util.audit (reiner console.log, s. Auftragsbeschreibung) -
  // NUR bei einer tatsaechlich NEUEN Vormerkung (alreadyApplied:false), sonst traegen zwei
  // Nachweise fuer EINEN einzigen Kuendigungsvorgang.
  router.post(
    "/api/self-service/billing/cancel",
    webAuthMw,
    asyncBilling(
      async (req, res) => {
        if (!requirePaymentEnabled(res, config)) return;
        const tenant = req.tenant.tenantId;
        const result = await setSubscriptionCancellation({ store, billing, tenant, cancel: true });
        if (!result.ok) {
          audit("self_service_cancel_rejected", req, `tenant=${tenant} reason=${result.reason}`);
          return res.status(409).json({ error: result.reason });
        }
        if (!result.alreadyApplied) {
          await auditStore.record({
            actorSub: req.tenant.sub,
            tenantId: tenant,
            action: "self_service_cancel_scheduled",
            detail: `current_period_end=${result.currentPeriodEnd ?? "unknown"}`,
          });
          // 312k-Phase 5 (§ 312k BGB): Kuendigungsbestaetigung UNVERZUEGLICH ausloesen -
          // NUR bei einer tatsaechlich NEUEN Vormerkung (Muster des Nachweises oben, sonst
          // liefe ein Doppelklick in eine zweite Mail). receivedAt EINMAL hier gesetzt
          // (Eingangszeitpunkt, den § 312k in der Bestaetigung verlangt) - der Sweep liest
          // spaeter denselben Wert, nie ein neues "jetzt". Die Kuendigung ist an dieser
          // Stelle bereits VOLLZOGEN (Stripe-Call + durabler Nachweis oben sind
          // durchgelaufen) - das Ausloesen der Mail laeuft danach, best-effort, und darf
          // die Antwort NIE blockieren (try/catch: attemptCancellationMailConfirm ist
          // selbst schon fail-soft, dies ist ein zusaetzlicher Riegel gegen einen
          // unerwarteten Fehler in der Verdrahtung, Muster billing/webhook.js SUSPEND-
          // Zweig). Was nicht klappt, bleibt am Tenant offen vermerkt und wird vom
          // periodischen Sweep erneut versucht.
          try {
            store.setCancellationMailPending(tenant, {
              pending: true,
              receivedAt: new Date().toISOString(),
            });
            await attemptCancellationMailConfirm({
              store,
              mailer,
              accounts,
              config,
              auditStore,
              tenantId: tenant,
            });
          } catch (e) {
            console.error(`[cancellation-mail] Ausloesen fehlgeschlagen tenant=${tenant}: ${e.message}`);
          }
        }
        audit(
          "self_service_cancel",
          req,
          `tenant=${tenant} already_applied=${result.alreadyApplied}`,
        );
        res.json({ cancelAtPeriodEnd: true, currentPeriodEnd: result.currentPeriodEnd });
      },
      billingUnavailable,
    ),
  );

  // ---- 312k-P3: Ruecknahme einer vorgemerkten Kuendigung --------------------------
  // Spiegelbild der cancel-Route (dieselben Gates/dieselbe Idempotenz, s. dort): kein
  // Abo -> 409 no_subscription; nicht (mehr) vorgemerkt -> idempotenter Erfolg ohne
  // zweiten Stripe-Call/Nachweis. webAuthMw: derselbe aktiv-only-Gate wie cancel.
  router.post(
    "/api/self-service/billing/resume",
    webAuthMw,
    asyncBilling(
      async (req, res) => {
        if (!requirePaymentEnabled(res, config)) return;
        const tenant = req.tenant.tenantId;
        const result = await setSubscriptionCancellation({ store, billing, tenant, cancel: false });
        if (!result.ok) {
          audit("self_service_resume_rejected", req, `tenant=${tenant} reason=${result.reason}`);
          return res.status(409).json({ error: result.reason });
        }
        if (!result.alreadyApplied) {
          await auditStore.record({
            actorSub: req.tenant.sub,
            tenantId: tenant,
            action: "self_service_cancel_resumed",
            detail: `current_period_end=${result.currentPeriodEnd ?? "unknown"}`,
          });
        }
        audit(
          "self_service_resume",
          req,
          `tenant=${tenant} already_applied=${result.alreadyApplied}`,
        );
        res.json({ cancelAtPeriodEnd: false, currentPeriodEnd: result.currentPeriodEnd });
      },
      billingUnavailable,
    ),
  );

  return router;
}

// SEC-P3: Herkunftspruefung (CSRF) + Eingabegrenze fuer agentName - als eigener,
// kleiner Router VOR makeSelfServiceRoutes montiert, statt in der Router-Fabrik
// selbst (G30/G34: eine Aufgabe pro Funktion, makeSelfServiceRoutes bleibt
// unveraendert). Praefix-Montage, KEIN nacktes router.use(mw) und KEINE Liste
// einzelner Routen:
//   * nackt waere ein Fehler - dieser Router wird in wiring/web-login.js VOR /voice,
//     express.static und registerApiRoutes gemountet; die Schicht liefe damit an
//     JEDEM spaeteren Request entlang, /voice/incoming eingeschlossen.
//   * eine Routen-Liste driftet - eine kuenftige Self-Service-Route waere still
//     ungeschuetzt. Der Praefix nimmt sie automatisch mit.
// Sichere Methoden bleiben unberuehrt (s. createSameOriginGuard), damit der
// Stripe-Redirect GET /api/self-service/billing/return unveraendert durchlaeuft; die
// beiden oeffentlichen GET /newsletter/* liegen ausserhalb des Praefixes.
export function mountSelfServiceRoutes(deps) {
  const guarded = Router();
  guarded.use(
    "/api/self-service",
    createSameOriginGuard({ enforce: deps.config.safety.csrfEnforce }),
  );
  guarded.use("/api/self-service/settings", rejectInvalidAgentName(deps.audit));
  guarded.use(makeSelfServiceRoutes(deps));
  return guarded;
}

// Antwortcode der agentName-Eingabegrenze. Benannt wie im Bestand
// (routes/webhooks-elevenlabs.js) statt als nackte Zahl im Handler.
const HTTP_BAD_REQUEST = 400;

// Laenge + Steuerzeichen VOR jedem Schreibzugriff - der Befund war 200 mit 20.000
// gespeicherten Zeichen. Geprueft wird req.body.agentName DIREKT (nicht der von
// selfServicePatch gefilterte Patch): fuer dieses eine Feld aequivalent, weil
// selfServicePatch es ungeprueft durchreicht (agentName in SELF_SERVICE_FREE_FIELDS,
// Typ-Check macht ausschliesslich updateSettings - s. self-service.js). Die Antwort
// nennt den Grund und NICHT den abgelehnten Wert.
function rejectInvalidAgentName(audit) {
  return function agentNameLimitMiddleware(req, res, next) {
    const rejection = promptLineRejection("agentName", req.body?.agentName);
    if (!rejection) return next();
    audit("self_service_settings_denied", req, `field=agentName reason=${rejection}`);
    res.status(HTTP_BAD_REQUEST).json({ error: "invalid_agent_name", reason: rejection });
  };
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
