// Gemeinsame Sicherheits-Helfer fuer Gateway und Audio-Bridge.
import crypto from "crypto";

// Timing-sicherer Vergleich fuer Passwoerter/Tokens (kein Timing-Seitenkanal wie bei ===)
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---- PII-Hygiene fuer Logs (DSGVO-Datenminimierung, T-P0-7) --------------------
// Telefonnummern/E-Mails duerfen nicht im Klartext in Diagnose-/Banner-Logs landen
// (Render persistiert stdout -> PII at rest). Diese Helfer erzeugen de-identifizierte,
// aber stabile Tokens (gleicher Wert -> gleiches Token, ueber Logzeilen korrelierbar),
// ohne den Vollwert zu zeigen. NICHT fuer den forensischen Audit-Trail (audit()) -
// der protokolliert Ziel + Identitaet bewusst vollstaendig (Toll-Fraud-Nachweis).
const MASK_VISIBLE_TAIL = 4; // sichtbare End-Zeichen einer maskierten Nummer
const MASK_HASH_LEN = 6;     // Hex-Stellen des Korrelations-Hash bei Nummern
const EMAIL_HASH_LEN = 8;    // Hex-Stellen des E-Mail-Hash (Vorgabe T-P0-7)
const TEXT_HASH_LEN = 8;     // Hex-Stellen des Text-Korrelations-Hash (Diagnose-Sonden)

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

// E-Mail fuer Logs auf einen nicht umkehrbaren SHA256-Praefix reduzieren (erste 8
// Hex-Stellen): stabil pro Adresse, aber nicht rueckrechenbar. Normalisiert
// (trim + lowercase), damit dieselbe Adresse dasselbe Token ergibt. Bsp.:
// a@b.de -> 363a175f. Leerwert -> "-".
export function hashEmail(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "-";
  return sha256Hex(s).slice(0, EMAIL_HASH_LEN);
}

// GQ-S1: beliebigen Text auf ein nicht umkehrbares SHA256-Praefix reduzieren - gleicher
// Text ergibt dasselbe Token, ueber Logzeilen vergleichbar, ohne den Wortlaut zu zeigen.
// Anders als hashEmail BEWUSST ohne trim/lowercase: die Sonden muessen "identischer Text"
// von "erweitertem Text" unterscheiden, jede Normalisierung wuerde genau das verwischen.
// Leerwert -> "-" (gleiche Konvention wie maskNumber/hashEmail).
export function hashText(value) {
  const s = String(value ?? "");
  if (!s) return "-";
  return sha256Hex(s).slice(0, TEXT_HASH_LEN);
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
});

export function auditAuthFailed(req, grund) {
  audit("auth_failed", req, `path=${req.path} grund=${grund}`);
}
