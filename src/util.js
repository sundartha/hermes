// Gemeinsame Sicherheits-Helfer fuer Gateway und Audio-Bridge.
import crypto from "crypto";

// Timing-sicherer Vergleich fuer Passwoerter/Tokens (kein Timing-Seitenkanal wie bei ===)
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const MASK_VISIBLE_TAIL = 4; // sichtbare End-Zeichen einer maskierten Nummer
const MASK_HASH_LEN = 6;     // Hex-Stellen des Korrelations-Hash bei Nummern
const EMAIL_HASH_LEN = 8;    // Hex-Stellen des E-Mail-Hash (Vorgabe T-P0-7)

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Telefonnummer fuer Logs maskieren: die letzten 4 Zeichen bleiben sichtbar (zur
// Wiedererkennung), davor ein nicht umkehrbares SHA256-Praefix zur Korrelation.
// Bsp.: +491701234567 -> ***4567#b4267a. Leerwert -> "-".
export function maskNumber(value) {
  const s = String(value ?? "").trim();
  if (!s) return "-";
  return `***${s.slice(-MASK_VISIBLE_TAIL)}#${sha256Hex(s).slice(0, MASK_HASH_LEN)}`;
}

const SEVEN_OR_MORE_DIGITS_WITH_SEPARATORS = /(?:\+|%2b|\\u002b)\d(?:(?:[ /-]|%20)?\d){6,}|(?<![a-z\d]-?)(?![12]\d{3}-\d\d-\d\d(?!-))\d(?:(?:[ /-]|%20)?\d){6,}(?![a-z\d])/gi;

export function maskNumbersInText(text) {
  return String(text).replace(SEVEN_OR_MORE_DIGITS_WITH_SEPARATORS, (number) => maskNumber(number));
}

// E-Mail fuer Logs auf einen nicht umkehrbaren SHA256-Praefix reduzieren (erste 8
// Hex-Stellen): stabil pro Adresse, aber nicht rueckrechenbar. Normalisiert
// (trim + lowercase), damit dieselbe Adresse dasselbe Token ergibt. Bsp.:
// a@b.de -> 363a175f. Leerwert -> "-".
export function hashEmail(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "-";
  return sha256Hex(s).slice(0, EMAIL_HASH_LEN);
}

// Audit-Logzeile fuer sicherheitsrelevante Aktionen (Call-Ausloesung, Cancel,
// Settings, Auth-Fehlversuche). details NIEMALS mit Secrets/PII fuellen.
// req optional: server-interne Ereignisse OHNE Request (z.B. finishCall ->
// sms_summary_skipped) rufen mit req=null und werden als ip=system markiert.
export function audit(action, req, details = "") {
  console.log(`[audit] ${action} ip=${req?.ip ?? "system"}${details ? " " + details : ""}`);
}

// ---- Auth-Ablehnungen: EIN Eintrag, EINE Vokabel (PLAN-AUTH-GATE AUTH-P5) -------
// Bis AUTH-P5 schrieb NUR das Basic-Auth-Gate eine auth_failed-Zeile. Seit AUTH-P7 ist
// das Gate ganz gefallen; die drei Nachfolger-Sicherungen (webAuthGateMiddleware,
// adminOnlyMiddleware, internalOnly) schreiben die Zeile deshalb selbst - ueber DIESE
// eine Funktion, damit sie nicht an mehreren Stellen leicht verschieden dasteht (G5)
// und die Grund-Token eine feste, benannte Menge bleiben (G25).
//
// ABSOLUTE REGEL 4: req.path, NIEMALS req.originalUrl. originalUrl traegt den Query-
// String - dort haengen der OAuth-code (/auth/callback) und die Stripe-session_id
// (/api/billing/checkout-return). Der Query gehoert nie in den Forensik-Trail.
//
// Schluesselname `grund=` statt `reason=`: dasselbe Ereignis traegt in src/auth.js
// bereits `grund=` (mcpAuth). Zwei Schreibweisen fuer dasselbe Feld waeren im Log ein
// echter Defekt - der Konstantenname spiegelt darum den Log-Schluessel.
export const AUTH_FAILED_GRUND = Object.freeze({
  NO_SESSION: "no_session", // kein gueltiges Sitzungs-Cookie / keine gueltige Session (401)
  NOT_ACTIVE: "not_active", // Sitzung gueltig, Tenant-Status nicht erlaubt (403)
  NOT_ADMIN: "not_admin", // Sitzung gueltig, aber kein Admin (403)
  NOT_LOCAL: "not_local", // kein vertrauenswuerdiger In-Process-Aufrufer (403)
  // SEC-P3: schreibender Request mit FREMDEM Origin auf einer Self-Service-Route (403).
  // Fehlender Origin ist KEIN Treffer und erzeugt keine Zeile (Normalfall S2S/Webhook).
  CROSS_ORIGIN: "cross_origin",
  // E5: vorhandener, nicht erlaubter Origin auf /mcp (403, MCP-Spec T-06). EIGENER
  // Token, damit die /mcp-Ablehnung im Log nicht mit der Self-Service-CSRF-Wache
  // verwechselt wird - die beiden Wachen haben verschiedene Anker und verschiedene
  // Heilwege (Allowlist-Nachtrag gegen Proxy-Konfiguration).
  MCP_CROSS_ORIGIN: "mcp_cross_origin",
});

// detail: OPTIONALES, schon gefiltertes Zusatzfeld im Log (heute nur `origin=<host>`
// der /mcp-Wache). NIE Rohtext aus einem Header und nie ein Secret - der Aufrufer
// filtert, diese Funktion formatiert nur. Ohne Argument byte-identisch zu vorher; die
// vier Bestandsaufrufer an fuenf Stellen (src/web-auth.js 3x, src/middleware.js,
// src/wiring/internal-only.js) bleiben unveraendert gueltig.
export function auditAuthFailed(req, grund, detail = "") {
  audit("auth_failed", req, `path=${req.path} grund=${grund}${detail ? ` ${detail}` : ""}`);
}
