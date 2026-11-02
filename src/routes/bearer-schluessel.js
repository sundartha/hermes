import { auditAuthFailed, safeEqual } from "../util.js";
import { HTTP_UNAUTHORIZED, antworteFehler } from "../utils/http.js";

const BEARER_PRAEFIX = "Bearer ";
const KEIN_ZWISCHENSPEICHER = "no-store";
const ABGELEHNT = "unauthorized";

function bearerGueltig({ erwartet, mindestLaenge }, authorization) {
  if (typeof erwartet !== "string" || erwartet.length < mindestLaenge) return false;
  return safeEqual(authorization, `${BEARER_PRAEFIX}${erwartet}`);
}

export function bearerAbgewiesen(schluessel, req, res) {
  res.set("Cache-Control", KEIN_ZWISCHENSPEICHER);
  if (bearerGueltig(schluessel, req.headers.authorization)) return false;
  auditAuthFailed(req, schluessel.grund);
  antworteFehler(res, HTTP_UNAUTHORIZED, ABGELEHNT);
  return true;
}
