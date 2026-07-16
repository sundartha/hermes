// ---- makeOnboardRoutes (Server-Slim P10) -----------------------------------------
// Extrahierte Onboarding-Route-Gruppe (POST /api/onboard, POST /api/onboard/retry)
// als Factory mit Dependency-Injection - gleiches Muster wie makeBillingRoutes/
// makeCallRoutes. Teil der server.js-Decomposition (PLAN-SERVER-SLIM P10): REINE
// Verschiebung, Verhalten unveraendert (byte-identische Pfade/Status/Bodies/Audit).
//
// Hinter der bestehenden /api/*-Basic-Auth (server.js deckt /api/* ab; localhost =
// Owner). BEWUSST KEIN MCP-Tool (kein Self-Service ueber MCP, kein offener ungegateter
// Geld-Endpunkt, R4). Die Kosten-Notbremse ist die Nummern-Cap (maxNumbers/
// maxNumbersPerTenant) - sie ERSETZT das uebersprungene Stripe-Schloss. Echter
// Provider-Kauf NUR bei PROVISIONING_ENABLED=true; sonst Dry-Run (fail-closed).
// provisioning = die EINE P6-Orchestrator-Instanz (INV-7, geteilt mit Webhook +
// Self-Service). Die pure Helfer (validIdentity/registerTenant/... + PROVIDER/
// KYC_OUTBOUND_MIN) kommen direkt aus ihrer Heimat (eine Quelle, G5 - wie normNum in
// makeCallRoutes); nur die Laufzeit-Instanzen werden injiziert.
import { Router } from "express";
import { validIdentity } from "./api-profiles.js";
import { checkSubAlreadyMerged } from "../onboard-guard.js";
import { geoLookupAdapter } from "../geo/registry.js";
import { resolveOnboardCountry } from "../geo/resolve.js";
import { languageForCountry } from "../i18n/locales.js";
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

// deps: { store, config, audit, provisioning }. store traegt load/save/withStoreLock/
// resolveTenant/tenantActiveSubscriber. config ist das globale Config-Objekt
// (defaultTenantBudgetCents/geoEnabled/provisioningCountry/forceNumberCountry/
// provisioningEnabled). audit ist util.audit (loggt nur Keys, keine Werte/Secrets).
// provisioning ist die EINE P6-Orchestrator-Instanz (queueProvisioning/
// runProvisioningDrainExclusive/triggerTenantProvisioning, INV-7).
export function makeOnboardRoutes({ store, config, audit, provisioning }) {
  const router = Router();

  // Aktiver Geo-Lookup (F1 Phase 6, config-getrieben). Bei GEO_ENABLED aus = Null-
  // Adapter (loest IP nie auf -> DE-Fallback, netzfrei). EINMAL beim Routen-Setup
  // gebaut (ein Mount = ein Singleton, INV-7).
  const geoLookup = geoLookupAdapter();

  // ---- Onboarding (zahlungsfrei): Tenant registrieren -> Nummer anfragen ->
  // (optional) echter Provider-Kauf -> aktivieren.
  router.post("/api/onboard", async (req, res) => {
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
        .json({ error: "idpSubject ungueltig (nicht leer, ohne Whitespace, <=254 Zeichen)" });
    const sub = idpSubject ?? null;
    const tenantId = sub ? tenantIdForSubject(sub) : bodyTenantId;
    if (!validIdentity(tenantId))
      return res
        .status(400)
        .json({ error: "tenantId ist Pflicht (nicht leer, ohne Whitespace, <=254 Zeichen)" });

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

    // F2: private Summary-Nummer ist OPTIONAL. VOR dem Store-Lock gegen DIESELBE Quelle
    // pruefen (normalizePrivateNumber, G5), damit ungueltige Eingaben als 400 statt 503
    // (Throw im Lock -> persist_error) zurueckkommen. Fehlt sie -> null, Onboarding wie
    // bisher. PII: nie ins Audit/Log (nur ein generischer Fehlertext, kein Wert, H4).
    try {
      normalizePrivateNumber(privateNumber);
    } catch {
      return res
        .status(400)
        .json({ error: "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)" });
    }

    // F1 Phase 6 - Land/Sprache bei der Registrierung. Praezedenz (fail-safe):
    // User-Wahl (body.country, EXPLIZIT, autoritativ R4) > IP-Geo-VORSCHLAG (lokaler
    // Lookup, nur bei GEO_ENABLED) > config.provisioningCountry > DEFAULT_COUNTRY. Die IP
    // (req.ip, proxy-aware via 'trust proxy') verlaesst den Prozess NIE - der Lookup ist
    // streng lokal. Eine gespoofte IP aendert nichts Autoritatives: ohne User-Wahl ist sie
    // nur ein Vorschlag, mit User-Wahl wird sie ueberstimmt. language wird aus dem Land
    // abgeleitet (eine Quelle: languageForCountry). country (Herkunftsland) + language
    // landen auf Tenant-Geo; das Number-Request traegt das KAUF-Land (numberCountry, s.u.).
    // KEIN body.country + leeres forceNumberCountry -> Verhalten byte-identisch (DE/de).
    const proposedCountry = config.geoEnabled ? geoLookup(req.ip)?.country : null;
    const country = resolveOnboardCountry({
      userCountry: req.body?.country,
      proposedCountry,
      fallbackCountry: config.provisioningCountry,
    });
    const language = languageForCountry(country);
    // Kauf-Land (number.country) ENTKOPPELT vom Herkunftsland: config.forceNumberCountry
    // (z.B. "US") ueberschreibt NUR, wo die Nummer gekauft wird - die Sprache bleibt am
    // erkannten Herkunftsland (language oben). Leer -> Kauf-Land = Herkunftsland (byte-
    // identisch). tenant.country bleibt das Herkunftsland (Quelle fuer Sprache/Analytics).
    const numberCountry = config.forceNumberCountry || country;

    // Store-Mutation + Persistenz im prozess-lokalen kritischen Abschnitt (OT-3 AC2):
    // load -> registerTenant -> setTenantGeo -> requestNumber -> save, kein fremdes await
    // dazwischen. Ein Save-I/O-Fehler wird als behandelter 503 beantwortet (AC4), NIE als
    // unhandled async rejection (die den Request haengen liesse / den Prozess via P0-Netz killte).
    const reqRes = await store
      .withStoreLock(() => {
        const s = store.load();
        registerTenant(s, tenantId, {
          firstName,
          lastName,
          privateNumber,
          idpSubject: sub,
          defaultBudgetCents: config.defaultTenantBudgetCents,
        });
        setTenantGeo(s, tenantId, { country, defaultLanguage: language });
        const r = requestNumber(s, {
          tenantId,
          provider: PROVIDER.TELNYX,
          country: numberCountry,
          language,
          maxNumbers: config.maxNumbers,
          maxNumbersPerTenant: config.maxNumbersPerTenant,
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
    if (!reqRes.ok && reqRes.reason === "persist_error")
      return res.status(503).json({ error: "Persistenz fehlgeschlagen" });
    if (!reqRes.ok) {
      audit("onboard_denied", req, `tenant=${tenantId} grund=${reqRes.reason}`);
      return res
        .status(ONBOARD_REASON_STATUS[reqRes.reason] || 400)
        .json({ error: `Nummer-Anfrage abgelehnt (${reqRes.reason})` });
    }
    const numberId = reqRes.number.id;
    audit("onboard_request", req, `tenant=${tenantId} number=${numberId}`);

    // Dry-Run (Default, fail-closed): kein echter Kauf, Nummer bleibt 'requested'.
    if (!config.provisioningEnabled)
      return res.json({
        tenantId,
        numberId,
        status: reqRes.number.status,
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
      status: reqRes.number.status,
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
  // -> Worker kauft). Hinter der globalen Basic-Auth (Owner) ODER trusted-localhost wie alle
  // /api/* (Regel 3). Geld-Safety (Regel 1): NUR fuer einen active + KYC>=CARD Subscriber
  // (das Abo IST die Freigabe, dieselbe Semantik wie das Outbound-Allowlist-Gate) - kein
  // Nummernkauf fuer Nicht-Zahler/suspendierte/fremde Tenants. Reuse triggerTenantProvisioning
  // (alle Gates: PROVISIONING_ENABLED, Caps, tenantHasLiveNumber, Hold/Capture) - keine zweite
  // Kauflogik (G5). 'already_provisioned' = Tenant hat schon eine lebende Nummer (idempotent).
  router.post("/api/onboard/retry", async (req, res) => {
    const { tenantId } = req.body || {};
    if (!validIdentity(tenantId))
      return res
        .status(400)
        .json({ error: "tenantId ist Pflicht (nicht leer, ohne Whitespace, <=254 Zeichen)" });
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
