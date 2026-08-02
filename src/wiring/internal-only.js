// ---- internalOnly (PLAN-AUTH-GATE AUTH-P5) --------------------------------------
// Seit AUTH-P7 ist dies die einzige Sicherung (kein Basic-Auth-Gate mehr davor): die
// neun MCP-/Legacy-Routen (POST /api/calls, .../cancel, .../consult,
// .../consult/answer, GET /api/state, GET /api/calls/:id, GET /api/tenant-data/export,
// POST /api/billing/setup-checkout, GET /api/billing/checkout-return) haben genau
// EINEN echten Aufrufer - den In-Process-MCP-Pfad ueber Loopback (src/mcp-tools.js,
// api() -> resolveGatewayUrl()). apps/web ruft keine davon (Plan Abschnitt 3, (b1)-1).
//
// KEINE neue Trust-Idee: isTrustedLocalCaller ist die BEREITS reviewte Grenze aus
// AUTH-P3 (echter Loopback-Socket UND kein X-Forwarded-For). Sie wird an genau EINER
// Stelle formuliert (G5) - hinter Render erscheint auch externer Verkehr als Loopback,
// die Socket-Adresse allein taugt darum NICHT als Gate (AM1, empirisch belegt).
//
// BENANNTE Funktionsdeklaration, keine anonyme Arrow: der Routen-Inventar-Test aus
// AUTH-P1 erkennt Auth-Middleware an handler.name im Express-Stack. Eine Arrow waere
// "<anonymous>" - die sieben Routen saehen ungeschuetzt aus (src/route-policy.js,
// AUTH_MIDDLEWARE_NAMES).
//
// Antwortform wie adminOnlyMiddleware/webAuthGateMiddleware: 403 + sprachneutraler
// Code, kein Detail darueber, WARUM abgelehnt wurde (kein Topologie-Leak).
import { isTrustedLocalCaller } from "../routes/_tenant.js";
import { auditAuthFailed, AUTH_FAILED_GRUND } from "../util.js";

export function internalOnly(req, res, next) {
  if (isTrustedLocalCaller(req)) return next();
  auditAuthFailed(req, AUTH_FAILED_GRUND.NOT_LOCAL);
  res.status(403).json({ error: "Forbidden" });
}
