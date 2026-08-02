// ---- makeOnboardRoutes (Server-Slim P10, AUTH-P6) --------------------------------
// Extrahierte Onboarding-Route-Gruppe (POST /api/onboard, POST /api/onboard/retry)
// als Factory mit Dependency-Injection - gleiches Muster wie makeBillingRoutes/
// makeCallRoutes.
//
// AUTH-P6: beide Routen sind Betreiber-Routen und haengen zusaetzlich zur Basic-Auth
// hinter einer echten Admin-Sitzung (webAuthMw+adminMw, operatorRoutes/operatorAuth) -
// und NUR DANN gemountet, wenn diese Sicherung existiert (fail-closed, s.
// wiring/operator-routes.js). BEWUSST KEIN MCP-Tool (kein Self-Service ueber MCP,
// kein offener ungegateter Geld-Endpunkt, R4). Die Kosten-Notbremse ist zusaetzlich
// die Nummern-Cap (maxNumbers/maxNumbersPerTenant) - sie ERSETZT das uebersprungene
// Stripe-Schloss. Echter Provider-Kauf NUR bei PROVISIONING_ENABLED=true; sonst
// Dry-Run (fail-closed). provisioning = die EINE P6-Orchestrator-Instanz (INV-7,
// geteilt mit Webhook + Self-Service). Die pure Helfer (validIdentity/
// registerTenant/... + PROVIDER/KYC_OUTBOUND_MIN) kommen direkt aus ihrer Heimat
// (eine Quelle, G5 - wie normNum in makeCallRoutes); nur die Laufzeit-Instanzen
// werden injiziert.
import { Router } from "express";
import { validIdentity, IDENTITY_MAX_LEN } from "./_validation.js";
import { checkSubAlreadyMerged } from "../onboard-guard.js";
import { geoLookupAdapter } from "../geo/registry.js";
import { resolveOnboardCountry, tenantGeoForCountry } from "../geo/resolve.js";
import {
  PROVIDER,
  KYC_OUTBOUND_MIN,
  tenantIdForSubject,
  shouldPersistProvisionResult,
} from "../store/defaults.js";
import {
  registerTenant,
  setTenantGeo,
  normalizePrivateNumber,
  requestNumber,
} from "../store/state-ops.js";
import { operatorRoutes } from "../wiring/operator-routes.js";

// Reason -> HTTP-Status-Mapping fuer requestNumber()-Ablehnungen (Nummern-Anfrage,
// Regel 1: Nummern-Caps ersetzen das uebersprungene Stripe-Schloss).
const ONBOARD_REASON_STATUS = { tenant_inactive: 403, tenant_cap: 409, global_cap: 429 };

// Reason -> HTTP-Status-Mapping fuer triggerTenantProvisioning()-Ablehnungen beim
// Operator-Re-Trigger (Regel 1: Geld-Safety-Gates unveraendert).
const RETRY_REASON_STATUS = {
  already_provisioned: 409,
  tenant_cap: 409,
  global_cap: 429,
  needs_manual_reconcile: 409,
  persist_error: 503,
};
// Runbook-Hinweis fuer needs_manual_reconcile (PROV-01/F7): ein zu alter / alters-unbekannter
// stuck-Job liegt evtl. AUSSERHALB des Anbieter-Idempotenz-Fensters (Doppelkauf-Gefahr) -> KEIN
// Auto-Retry. Der Owner muss den Provider-/Stripe-Zustand manuell abgleichen. Andere Gruende
// nutzen den generischen Template-Text (EINE Quelle, Fallback unten).
const RETRY_REASON_MESSAGE = {
  needs_manual_reconcile:
    "Haengender Nummernkauf ausserhalb des sicheren Nachfuehr-Fensters - " +
    "bitte Provider-/Stripe-Zustand manuell abgleichen (Runbook PROV-01), kein Auto-Retry.",
};

// EINE Quelle (G5) fuer den an POST /api/onboard und /api/onboard/retry identischen
// tenantId-400-Guard (validIdentity + identischer Fehlertext). true = gueltig (Aufrufer
// faehrt fort); false = Guard hat bereits geantwortet (Aufrufer bricht mit return ab).
function requireValidTenantId(res, tenantId) {
  if (validIdentity(tenantId)) return true;
  res
    .status(400)
    .json({ error: `tenantId ist Pflicht (nicht leer, ohne Whitespace, <=${IDENTITY_MAX_LEN} Zeichen)` });
  return false;
}

// deps: { store, config, audit, provisioning, operatorAuth }. store traegt load/save/
// withStoreLock/resolveTenant/tenantActiveSubscriber. config ist das globale
// Config-Objekt (defaultTenantBudgetCents/geoEnabled/provisioningCountry/
// forceNumberCountry/provisioningEnabled). audit ist util.audit (loggt nur Keys,
// keine Werte/Secrets). provisioning ist die EINE P6-Orchestrator-Instanz
// (queueProvisioning/runProvisioningDrainExclusive/triggerTenantProvisioning, INV-7).
// operatorAuth traegt { webAuthMw, adminMw } fuer beide Routen (AUTH-P6) - null, wenn
// die Admin-Sitzungs-Infra nicht verfuegbar ist (dann werden sie NICHT gemountet).
export function makeOnboardRoutes({ store, config, audit, provisioning, operatorAuth }) {
  const router = Router();
  const operator = operatorRoutes({ router, operatorAuth });

  // Aktiver Geo-Lookup (F1 Phase 6, config-getrieben). Bei GEO_ENABLED aus = Null-
  // Adapter (loest IP nie auf -> DE-Fallback, netzfrei). EINMAL beim Routen-Setup
  // gebaut (ein Mount = ein Singleton, INV-7).
  const geoLookup = geoLookupAdapter();

  // ---- Onboarding (zahlungsfrei): Tenant registrieren -> Nummer anfragen ->
  // (optional) echter Provider-Kauf -> aktivieren. Hinter Basic-Auth UND einer
  // Admin-Sitzung (webAuthMw+adminMw, AUTH-P6); ohne diese Sicherung gar nicht
  // gemountet.
  operator.post("/api/onboard", async (req, res) => {
    // G1: zwei Eingaben (firstName + lastName) statt eines ownerName (Owner-Entscheidung
    // #1). Beide optional + Freitext (duerfen Leerzeichen, NICHT durch validIdentity, das
    // nur den Routing-Schluessel tenantId prueft); registerTenant trimmt + komponiert
    // ownerName (Owner-Fallback bei leer).
    const { tenantId: bodyTenantId, firstName, lastName, privateNumber, idpSubject } = req.body || {};
    // P0: kanonische Identitaet. Ist idpSubject (WorkOS sub) gesetzt, ist DAS die Identitaet
    // -> kanonische tenantId deterministisch daraus (tenantIdForSubject, gleiche Quelle wie
    // der Web-Login) und der Record wird idp-gebunden (resolveTenant findet ihn -> MCP/REST
    // + Web-Login loesen denselben Tenant auf, Invarianten 1+2). Ohne idpSubject bleibt der
    // Owner-/Operator-Pfad byte-identisch (tenantId aus dem Body). Ein gesetztes, aber
    // ungueltiges idpSubject -> 400 (fail-closed, kein stiller Fallback auf den Owner-Pfad).
    if (idpSubject !== undefined && !validIdentity(idpSubject))
      return res
        .status(400)
        .json({ error: `idpSubject ungueltig (nicht leer, ohne Whitespace, <=${IDENTITY_MAX_LEN} Zeichen)` });
    const sub = idpSubject ?? null;
    const tenantId = sub ? tenantIdForSubject(sub) : bodyTenantId;
    if (!requireValidTenantId(res, tenantId)) return;

    // Onboard-Guard (tenant-prolif-b): reine Bedingungspruefung in onboard-guard.js
    // (isoliert unit-testbar), hier nur die IO-Verdrahtung (audit + Response). Fail-closed:
    // 409, kein zweiter Tenant, kein Nummer-Request. PII-frei (kein sub im Body/Log).
    // resolveTenant ist ein reiner Lese-Check (kein Store-Lock noetig; Operator-only,
    // geringe Nebenlaeufigkeit).
    const onboardGuardHit = checkSubAlreadyMerged({
      sub,
      tenantId,
      resolveTenant: store.resolveTenant,
    });
    if (onboardGuardHit) {
      audit("onboard_denied", req, `tenant=${tenantId} grund=sub_already_merged`);
      return res.status(onboardGuardHit.status).json({ error: onboardGuardHit.error });
    }

    // F1 Phase 6 - Land/Sprache bei der Registrierung. Praezedenz (fail-safe):
    // User-Wahl (body.country, EXPLIZIT, autoritativ R4) > IP-Geo-VORSCHLAG (lokaler
    // Lookup, nur bei GEO_ENABLED) > config.provisioning.provisioningCountry > DEFAULT_COUNTRY. Die IP
    // (req.ip, proxy-aware via 'trust proxy') verlaesst den Prozess NIE - der Lookup ist
    // streng lokal. Eine gespoofte IP aendert nichts Autoritatives: ohne User-Wahl ist sie
    // nur ein Vorschlag, mit User-Wahl wird sie ueberstimmt.
    // P8/FMT-11: die Land-Aufloesung steht jetzt VOR der privateNumber-Vorpruefung, weil
    // das Laendergate der privaten Nummer aus DIESEM Land hergeleitet wird. Beide Schritte
    // sind rein (kein IO) - die Umstellung aendert fuer den DE-Pfad nichts.
    const proposedCountry = config.provisioning.geoEnabled ? geoLookup(req.ip)?.country : null;
    const country = resolveOnboardCountry({
      userCountry: req.body?.country,
      proposedCountry,
      fallbackCountry: config.provisioning.provisioningCountry,
    });
    // P8/LANG-02: das vollstaendige Geo-Tripel aus EINER Quelle - derselbe Helfer, den der
    // Web-Login-Pfad benutzt (kein zweiter, abweichender Ableitungsweg, G5).
    const geo = tenantGeoForCountry(country);
    const language = geo.defaultLanguage;
    // Kauf-Land (number.country) ENTKOPPELT vom Herkunftsland: config.provisioning.forceNumberCountry
    // (z.B. "US") ueberschreibt NUR, wo die Nummer gekauft wird - die Sprache bleibt am
    // erkannten Herkunftsland (language oben). Leer -> Kauf-Land = Herkunftsland (byte-
    // identisch). tenant.country bleibt das Herkunftsland (Quelle fuer Sprache/Analytics).
    const numberCountry = config.provisioning.forceNumberCountry || country;

    // F2: private Summary-Nummer ist OPTIONAL. VOR dem Store-Lock gegen DIESELBE Quelle
    // pruefen (normalizePrivateNumber, G5), damit ungueltige Eingaben als 400 statt 503
    // (Throw im Lock -> persist_error) zurueckkommen. Fehlt sie -> null, Onboarding wie
    // bisher. PII: nie ins Audit/Log (nur ein generischer Fehlertext, kein Wert, H4).
    try {
      normalizePrivateNumber(privateNumber, country);
    } catch {
      return res
        .status(400)
        .json({ error: "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)" });
    }

    // Store-Mutation + Persistenz im prozess-lokalen kritischen Abschnitt (OT-3 AC2):
    // load -> registerTenant -> setTenantGeo -> requestNumber -> save, kein fremdes await
    // dazwischen. Ein Save-I/O-Fehler wird als behandelter 503 beantwortet (AC4), NIE als
    // unhandled async rejection (die den Request haengen liesse / den Prozess via P0-Netz killte).
    const numberResult = await store
      .withStoreLock(() => {
        const s = store.load();
        registerTenant(s, tenantId, {
          firstName,
          lastName,
          privateNumber,
          idpSubject: sub,
          defaultBudgetCents: config.billing.defaultTenantBudgetCents,
          country,
        });
        setTenantGeo(s, tenantId, geo);
        const r = requestNumber(s, {
          tenantId,
          provider: PROVIDER.TELNYX,
          country: numberCountry,
          language,
          maxNumbers: config.provisioning.maxNumbers,
          maxNumbersPerTenant: config.provisioning.maxNumbersPerTenant,
        });
        // Fix B (G5/S2): Persistenz-Entscheidung geteilt mit triggerTenantProvisioning
        // (shouldPersistProvisionResult, EINE Quelle statt woertlicher Duplizierung).
        if (shouldPersistProvisionResult(r)) store.save(); // 'requested' persistieren (auch im Dry-Run)
        return r;
      })
      .catch((e) => {
        // mem/disk-Divergenz moeglich (In-Memory mutiert, Platte nicht) - sichtbar geloggt.
        console.error("[onboard] Persistenz fehlgeschlagen:", e.message);
        return { ok: false, reason: "persist_error" };
      });
    if (!numberResult.ok && numberResult.reason === "persist_error")
      return res.status(503).json({ error: "Persistenz fehlgeschlagen" });
    if (!numberResult.ok) {
      audit("onboard_denied", req, `tenant=${tenantId} grund=${numberResult.reason}`);
      return res
        .status(ONBOARD_REASON_STATUS[numberResult.reason] || 400)
        .json({ error: `Nummer-Anfrage abgelehnt (${numberResult.reason})` });
    }
    const numberId = numberResult.number.id;
    audit("onboard_request", req, `tenant=${tenantId} number=${numberId}`);

    // Dry-Run (Default, fail-closed): kein echter Kauf, Nummer bleibt 'requested'.
    if (!config.provisioning.provisioningEnabled)
      return res.json({
        tenantId,
        numberId,
        status: numberResult.number.status,
        country,
        language,
        provisioning: "disabled",
      });

    // BEWUSSTE VERHALTENS-AENDERUNG (P6b2): das Provisioning ist aus dem HTTP-Request
    // geloest. Wir enqueuen einen Job, persistieren die Job-Spur ('requested' + queued)
    // und antworten SOFORT mit 'queued'; ein deterministischer Drain (In-Memory-Queue)
    // fuehrt provisionNumber asynchron aus. Die Geld-Sicherheits-Invarianten (Hold-vor-
    // Order, kein active ohne Capture, Rollback) bleiben in provisionNumber - jetzt im Worker.
    // Enqueue + Job-Spur teilen sich jetzt mit dem Webhook-Trigger (queueProvisioning, G5).
    const jobRes = await provisioning.queueProvisioning(numberId, tenantId);
    if (!jobRes.ok) return res.status(503).json({ error: "Persistenz fehlgeschlagen" });
    audit("onboard_queued", req, `tenant=${tenantId} number=${numberId} job=${jobRes.jobId}`);
    res.json({
      tenantId,
      numberId,
      status: numberResult.number.status,
      country,
      language,
      provisioning: "queued",
      jobId: jobRes.jobId,
    });

    // Drain NACH der Response (fire-and-forget): kein echtes Hintergrund-Subsystem
    // (pg-boss ist deferred nach P8), aber HTTP endet vor dem Provider-Kauf. Tests
    // rufen den Drain deterministisch ueber die Queue-Instanz; hier wird er nur angestossen.
    void provisioning.runProvisioningDrainExclusive();
  });

  // Operator-Re-Trigger (P2): provisioniert eine NEUE Nummer fuer einen aktiven, bezahlten
  // Subscriber, dessen vorheriger Nummernkauf scheiterte (provisionNumber faellt bei Order-/
  // Hold-Fehler auf 'failed' -> tenantHasLiveNumber wird wieder offen -> frische 'requested'
  // -> Worker kauft). Hinter Basic-Auth UND einer Admin-Sitzung (webAuthMw+adminMw,
  // AUTH-P6); ohne diese Sicherung gar nicht gemountet - trusted-localhost traegt diese
  // Route bewusst NICHT mehr (anders als die sieben P5-Routen). Geld-Safety (Regel 1):
  // NUR fuer einen active + KYC>=CARD Subscriber (das Abo IST die Freigabe, dieselbe
  // Semantik wie das Outbound-Allowlist-Gate) - kein Nummernkauf fuer Nicht-Zahler/
  // suspendierte/fremde Tenants. Reuse triggerTenantProvisioning (alle Gates:
  // PROVISIONING_ENABLED, Caps, tenantHasLiveNumber, Hold/Capture) - keine zweite
  // Kauflogik (G5). 'already_provisioned' = Tenant hat schon eine lebende Nummer (idempotent).
  operator.post("/api/onboard/retry", async (req, res) => {
    const { tenantId } = req.body || {};
    if (!requireValidTenantId(res, tenantId)) return;
    // Geld-Safety (Regel 1): nur ein aktiver, KYC-verifizierter Subscriber - verhindert, dass
    // der Owner versehentlich Geld fuer einen Fremd-/suspendierten/Nicht-Zahler-Tenant ausgibt.
    if (!store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) {
      audit("onboard_retry_denied", req, `tenant=${tenantId} grund=kein_aktiver_subscriber`);
      return res
        .status(403)
        .json({ error: "Kein aktiver, verifizierter Subscriber - kein Nummernkauf." });
    }
    const result = await provisioning.triggerTenantProvisioning(tenantId);
    audit("onboard_retry", req, `tenant=${tenantId} ok=${result.ok} grund=${result.reason}`);
    if (!result.ok)
      return res
        .status(RETRY_REASON_STATUS[result.reason] || 400)
        .json({
          error: RETRY_REASON_MESSAGE[result.reason] || `Re-Provisioning abgelehnt (${result.reason})`,
        });
    res.json({ tenantId, numberId: result.numberId, reason: result.reason, jobId: result.jobId });
  });

  return router;
}
