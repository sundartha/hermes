import { isTrustedLocalCaller } from "../routes/_tenant.js";
import { auditAuthFailed, AUTH_FAILED_GRUND } from "../util.js";

export function internalOnly(req, res, next) {
  if (isTrustedLocalCaller(req)) return next();
  auditAuthFailed(req, AUTH_FAILED_GRUND.NOT_LOCAL);
  res.status(403).json({ error: "Forbidden" });
}
