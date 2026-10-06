import { makeFixedWindowCounter, RATE_WINDOW_MS, RATE_SWEEP_INTERVAL_MS } from "./middleware.js";
import { isTrustedLocalCaller } from "./routes/_tenant.js";
import { TENANT_REJECT } from "./request-tenant.js";

export function ablehnungsSchluessel(req, verifizierteSub) {
  if (typeof verifizierteSub === "string" && verifizierteSub) return `sub:${verifizierteSub}`;
  return `ip:${req.ip}`;
}

export function mandantSchluessel(req, scopedTenant) {
  if (!req.auth) return `ip:${req.ip}`;
  if (scopedTenant === TENANT_REJECT) return req.auth.sub ? `sub:${req.auth.sub}` : `ip:${req.ip}`;
  return `tenant:${scopedTenant}`;
}

const TRUSTED_LOCAL_RESULT = Object.freeze({ allowed: true, retryAfterS: 0 });

export function makeMcpDrosseln({ limitPerMin }) {
  const ablehnungHit = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: limitPerMin,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });
  const mandantHit = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: limitPerMin,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });

  function ablehnung(req, { verifizierteSub = null } = {}) {
    if (isTrustedLocalCaller(req)) return TRUSTED_LOCAL_RESULT;
    return ablehnungHit(ablehnungsSchluessel(req, verifizierteSub));
  }

  function mandant(req, { scopedTenant } = {}) {
    if (isTrustedLocalCaller(req)) return TRUSTED_LOCAL_RESULT;
    return mandantHit(mandantSchluessel(req, scopedTenant));
  }

  function ipSperre(req) {
    if (isTrustedLocalCaller(req)) return TRUSTED_LOCAL_RESULT;
    return ablehnungHit.peek(ablehnungsSchluessel(req, null));
  }

  return { ablehnung, mandant, ipSperre };
}
