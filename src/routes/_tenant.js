import { BOOTSTRAP_TENANT_ID } from "../store/defaults.js";

const HTTP_FORBIDDEN = 403;

export const isLocalSocket = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

const isProxyForwarded = (req) => Boolean(req.headers["x-forwarded-for"]);

export const isTrustedLocalCaller = (req) => isLocalSocket(req) && !isProxyForwarded(req);

const trustedLocalHeader = (req, name) => {
  if (!isTrustedLocalCaller(req)) return null;
  const value = req.headers[name];
  return typeof value === "string" && value ? value : null;
};

export const internalIdentity = (req) => trustedLocalHeader(req, "x-internal-identity");

export const internalTenant = (req) => trustedLocalHeader(req, "x-internal-tenant");

export const OWNER_ID = "owner";
export const ANON_IDENTITY = "anon";

export const TENANT_REJECT = "reject";

export const operatorChannelTenant = (req) =>
  isTrustedLocalCaller(req) ? BOOTSTRAP_TENANT_ID : TENANT_REJECT;

export const tenantOwnsCall = (call, tenant) => call.tenantId === tenant;

export function makeTenantResolver({ store }) {
  function requestTenant(req) {
    if (req.tenant) return req.tenant.tenantId || TENANT_REJECT;
    const forwarded = internalTenant(req);
    if (forwarded) return forwarded;
    const sub = req.auth ? req.auth.sub : null;
    const internal = req.auth ? null : internalIdentity(req);
    if (!req.auth && !internal) return operatorChannelTenant(req);
    const tenantId = store.resolveTenant(sub || internal);
    return tenantId || TENANT_REJECT;
  }

  function requireTenant(req, res) {
    const tenant = requestTenant(req);
    if (tenant === TENANT_REJECT) {
      res.status(HTTP_FORBIDDEN).json({ error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
      return null;
    }
    return tenant;
  }

  return {
    isLocalSocket,
    internalIdentity,
    internalTenant,
    requestTenant,
    requireTenant,
    tenantOwnsCall,
    OWNER_ID,
    ANON_IDENTITY,
    TENANT_REJECT,
  };
}

export const createTenantResolver = makeTenantResolver;

export function makeRequestTenant(store) {
  const { requestTenant, requireTenant } = makeTenantResolver({ store });
  return { requestTenant, requireTenant };
}
