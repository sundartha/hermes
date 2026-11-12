import { isTrustedLocalCaller } from "../routes/_tenant.js";
import { auditAuthFailed, AUTH_FAILED_GRUND } from "../util.ts";
import { HTTP_FORBIDDEN } from "../utils/http.ts";

export function internalOnly(req, res, next) {
  if (isTrustedLocalCaller(req)) return next();
  auditAuthFailed(req, AUTH_FAILED_GRUND.NOT_LOCAL);
  res.status(HTTP_FORBIDDEN).json({ error: "Forbidden" });
}
