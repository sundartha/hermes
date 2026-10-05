import { AUTH_FAILED_GRUND, auditAuthFailed, safeEqual } from "../util.js";

export const ANRUFE_LAUFEND_PATH = "/intern/anrufe-laufend";
export const DEPLOY_TOKEN_MIN_LENGTH = 32;

const AKTIVER_STATUS = "active";
const HTTP_UNAUTHORIZED = 401;
const BEARER_PRAEFIX = "Bearer ";
const KEIN_ZWISCHENSPEICHER = "no-store";
const ABGELEHNT = Object.freeze({ error: "unauthorized" });

function deployTokenGueltig(config, authorization) {
  const erwartet = config.auth.deployToken;
  if (typeof erwartet !== "string" || erwartet.length < DEPLOY_TOKEN_MIN_LENGTH) return false;
  return safeEqual(authorization || "", `${BEARER_PRAEFIX}${erwartet}`);
}

function laeuft(call, nowMs, store) {
  if (call.status !== AKTIVER_STATUS) return false;
  return !store.classifyCallTime(call, nowMs, store.MAX_CALL_DURATION_CAP_S).expired;
}

export function laufendeAnrufe(store, nowMs) {
  const { calls } = store.load();
  return calls.filter((call) => laeuft(call, nowMs, store)).length;
}

export function anrufeLaufendHandler({ config, store }) {
  return function anrufeLaufend(req, res) {
    res.set("Cache-Control", KEIN_ZWISCHENSPEICHER);
    if (!deployTokenGueltig(config, req.headers.authorization)) {
      auditAuthFailed(req, AUTH_FAILED_GRUND.DEPLOY_TOKEN);
      return res.status(HTTP_UNAUTHORIZED).json(ABGELEHNT);
    }
    return res.json({ laufend: laufendeAnrufe(store, Date.now()) });
  };
}
