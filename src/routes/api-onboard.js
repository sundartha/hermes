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

const ONBOARD_REASON_STATUS = { tenant_inactive: 403, tenant_cap: 409, global_cap: 429 };

const RETRY_REASON_STATUS = {
  already_provisioned: 409,
  tenant_cap: 409,
  global_cap: 429,
  needs_manual_reconcile: 409,
  persist_error: 503,
};
const RETRY_REASON_MESSAGE = {
  needs_manual_reconcile:
    "Haengender Nummernkauf ausserhalb des sicheren Nachfuehr-Fensters - " +
    "bitte Provider-/Stripe-Zustand manuell abgleichen (Runbook PROV-01), kein Auto-Retry.",
};

function requireValidTenantId(res, tenantId) {
  if (validIdentity(tenantId)) return true;
  res
    .status(400)
    .json({ error: `tenantId ist Pflicht (nicht leer, ohne Whitespace, <=${IDENTITY_MAX_LEN} Zeichen)` });
  return false;
}

export function makeOnboardRoutes({ store, config, audit, provisioning, operatorAuth }) {
  const router = Router();
  const operator = operatorRoutes({ router, operatorAuth });

  const geoLookup = geoLookupAdapter();

  operator.post("/api/onboard", async (req, res) => {
    const { tenantId: bodyTenantId, firstName, lastName, privateNumber, idpSubject } = req.body || {};
    if (idpSubject !== undefined && !validIdentity(idpSubject))
      return res
        .status(400)
        .json({ error: `idpSubject ungueltig (nicht leer, ohne Whitespace, <=${IDENTITY_MAX_LEN} Zeichen)` });
    const sub = idpSubject ?? null;
    const tenantId = sub ? tenantIdForSubject(sub) : bodyTenantId;
    if (!requireValidTenantId(res, tenantId)) return;

    const onboardGuardHit = checkSubAlreadyMerged({
      sub,
      tenantId,
      resolveTenant: store.resolveTenant,
    });
    if (onboardGuardHit) {
      audit("onboard_denied", req, `tenant=${tenantId} grund=sub_already_merged`);
      return res.status(onboardGuardHit.status).json({ error: onboardGuardHit.error });
    }

    const proposedCountry = config.provisioning.geoEnabled ? geoLookup(req.ip)?.country : null;
    const country = resolveOnboardCountry({
      userCountry: req.body?.country,
      proposedCountry,
      fallbackCountry: config.provisioning.provisioningCountry,
    });
    const geo = tenantGeoForCountry(country);
    const language = geo.defaultLanguage;
    const numberCountry = config.provisioning.forceNumberCountry || country;

    try {
      normalizePrivateNumber(privateNumber, country);
    } catch {
      return res
        .status(400)
        .json({ error: "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)" });
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
      return res.status(503).json({ error: "Persistenz fehlgeschlagen" });
    if (!numberResult.ok) {
      audit("onboard_denied", req, `tenant=${tenantId} grund=${numberResult.reason}`);
      return res
        .status(ONBOARD_REASON_STATUS[numberResult.reason] || 400)
        .json({ error: `Nummer-Anfrage abgelehnt (${numberResult.reason})` });
    }
    const numberId = numberResult.number.id;
    audit("onboard_request", req, `tenant=${tenantId} number=${numberId}`);

    if (!config.provisioning.provisioningEnabled)
      return res.json({
        tenantId,
        numberId,
        status: numberResult.number.status,
        country,
        language,
        provisioning: "disabled",
      });

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

    void provisioning.runProvisioningDrainExclusive();
  });

  operator.post("/api/onboard/retry", async (req, res) => {
    const { tenantId } = req.body || {};
    if (!requireValidTenantId(res, tenantId)) return;
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
