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
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_TOO_MANY_REQUESTS,
  antworteFehler,
} from "../utils/http.js";

const ONBOARD_REASON_STATUS = {
  tenant_inactive: HTTP_FORBIDDEN,
  tenant_cap: HTTP_CONFLICT,
  global_cap: HTTP_TOO_MANY_REQUESTS,
};

const RETRY_REASON_STATUS = {
  already_provisioned: HTTP_CONFLICT,
  tenant_cap: HTTP_CONFLICT,
  global_cap: HTTP_TOO_MANY_REQUESTS,
  needs_manual_reconcile: HTTP_CONFLICT,
  persist_error: HTTP_SERVICE_UNAVAILABLE,
};
const RETRY_REASON_MESSAGE = {
  needs_manual_reconcile:
    "Haengender Nummernkauf ausserhalb des sicheren Nachfuehr-Fensters - " +
    "bitte Provider-/Stripe-Zustand manuell abgleichen (Runbook PROV-01), kein Auto-Retry.",
};

function requireValidTenantId(res, tenantId) {
  if (validIdentity(tenantId)) return true;
  antworteFehler(
    res,
    HTTP_BAD_REQUEST,
    `tenantId ist Pflicht (nicht leer, ohne Whitespace, <=${IDENTITY_MAX_LEN} Zeichen)`,
  );
  return false;
}

function onboardIdentitaet(req, res) {
  const { tenantId: bodyTenantId, idpSubject } = req.body || {};
  if (idpSubject !== undefined && !validIdentity(idpSubject)) {
    antworteFehler(
      res,
      HTTP_BAD_REQUEST,
      `idpSubject ungueltig (nicht leer, ohne Whitespace, <=${IDENTITY_MAX_LEN} Zeichen)`,
    );
    return null;
  }
  const sub = idpSubject ?? null;
  const tenantId = sub ? tenantIdForSubject(sub) : bodyTenantId;
  if (!requireValidTenantId(res, tenantId)) return null;
  return { sub, tenantId };
}

function onboardStandort(config, geoLookup, req) {
  const proposedCountry = config.provisioning.geoEnabled ? geoLookup(req.ip)?.country : null;
  const country = resolveOnboardCountry({
    userCountry: req.body?.country,
    proposedCountry,
    fallbackCountry: config.provisioning.provisioningCountry,
  });
  const geo = tenantGeoForCountry(country);
  const language = geo.defaultLanguage;
  const numberCountry = config.provisioning.forceNumberCountry || country;
  return { country, geo, language, numberCountry };
}

async function nummerBereitstellen({ config, audit, provisioning }, { req, res }, angebot) {
  const { tenantId, number, country, language } = angebot;
  const numberId = number.id;
  audit("onboard_request", req, `tenant=${tenantId} number=${numberId}`);

  if (!config.provisioning.provisioningEnabled)
    return res.json({
      tenantId,
      numberId,
      status: number.status,
      country,
      language,
      provisioning: "disabled",
    });

  const jobRes = await provisioning.queueProvisioning(numberId, tenantId);
  if (!jobRes.ok) return antworteFehler(res, HTTP_SERVICE_UNAVAILABLE, "Persistenz fehlgeschlagen");
  audit("onboard_queued", req, `tenant=${tenantId} number=${numberId} job=${jobRes.jobId}`);
  res.json({
    tenantId,
    numberId,
    status: number.status,
    country,
    language,
    provisioning: "queued",
    jobId: jobRes.jobId,
  });

  void provisioning.runProvisioningDrainExclusive();
}

export function makeOnboardRoutes({ store, config, audit, provisioning, operatorAuth }) {
  const router = Router();
  const operator = operatorRoutes({ router, operatorAuth });

  const geoLookup = geoLookupAdapter();

  operator.post("/api/onboard", async (req, res) => {
    const identitaet = onboardIdentitaet(req, res);
    if (!identitaet) return;
    const { sub, tenantId } = identitaet;
    const { firstName, lastName, privateNumber } = req.body || {};

    const onboardGuardHit = checkSubAlreadyMerged({
      sub,
      tenantId,
      resolveTenant: store.resolveTenant,
    });
    if (onboardGuardHit) {
      audit("onboard_denied", req, `tenant=${tenantId} grund=sub_already_merged`);
      return res.status(onboardGuardHit.status).json({ error: onboardGuardHit.error });
    }

    const { country, geo, language, numberCountry } = onboardStandort(config, geoLookup, req);

    try {
      normalizePrivateNumber(privateNumber, country);
    } catch {
      return antworteFehler(
        res,
        HTTP_BAD_REQUEST,
        "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)",
      );
    }

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
        if (shouldPersistProvisionResult(r)) store.save();
        return r;
      })
      .catch((e) => {
        console.error("[onboard] Persistenz fehlgeschlagen:", e.message);
        return { ok: false, reason: "persist_error" };
      });
    if (!numberResult.ok && numberResult.reason === "persist_error")
      return antworteFehler(res, HTTP_SERVICE_UNAVAILABLE, "Persistenz fehlgeschlagen");
    if (!numberResult.ok) {
      audit("onboard_denied", req, `tenant=${tenantId} grund=${numberResult.reason}`);
      return res
        .status(ONBOARD_REASON_STATUS[numberResult.reason] || HTTP_BAD_REQUEST)
        .json({ error: `Nummer-Anfrage abgelehnt (${numberResult.reason})` });
    }
    const angebot = { tenantId, number: numberResult.number, country, language };
    return nummerBereitstellen({ config, audit, provisioning }, { req, res }, angebot);
  });

  operator.post("/api/onboard/retry", async (req, res) => {
    const { tenantId } = req.body || {};
    if (!requireValidTenantId(res, tenantId)) return;
    if (!store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) {
      audit("onboard_retry_denied", req, `tenant=${tenantId} grund=kein_aktiver_subscriber`);
      return antworteFehler(
        res,
        HTTP_FORBIDDEN,
        "Kein aktiver, verifizierter Subscriber - kein Nummernkauf.",
      );
    }
    const result = await provisioning.triggerTenantProvisioning(tenantId);
    audit("onboard_retry", req, `tenant=${tenantId} ok=${result.ok} grund=${result.reason}`);
    if (!result.ok)
      return res
        .status(RETRY_REASON_STATUS[result.reason] || HTTP_BAD_REQUEST)
        .json({
          error: RETRY_REASON_MESSAGE[result.reason] || `Re-Provisioning abgelehnt (${result.reason})`,
        });
    res.json({ tenantId, numberId: result.numberId, reason: result.reason, jobId: result.jobId });
  });

  return router;
}
