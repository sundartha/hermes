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

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Telefonnummer fuer Logs maskieren: die letzten 4 Zeichen bleiben sichtbar (zur
// Wiedererkennung), davor ein nicht umkehrbares SHA256-Praefix zur Korrelation.
// Bsp.: +491701234567 -> ***4567#9f2c1a. Leerwert -> "-".
export function maskNumber(value) {
  const s = String(value ?? "").trim();
  if (!s) return "-";
  return `***${s.slice(-MASK_VISIBLE_TAIL)}#${sha256Hex(s).slice(0, MASK_HASH_LEN)}`;
}

// E-Mail fuer Logs auf einen nicht umkehrbaren SHA256-Praefix reduzieren (erste 8
// Hex-Stellen): stabil pro Adresse, aber nicht rueckrechenbar. Normalisiert
// (trim + lowercase), damit dieselbe Adresse dasselbe Token ergibt. Bsp.:
// a@b.de -> 0d6f3a1c. Leerwert -> "-".
export function hashEmail(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "-";
  return sha256Hex(s).slice(0, EMAIL_HASH_LEN);
}

// Audit-Logzeile fuer sicherheitsrelevante Aktionen (Call-Ausloesung, Cancel,
// Settings, Auth-Fehlversuche). details NIEMALS mit Secrets fuellen.
export function audit(action, req, details = "") {
  console.log(`[audit] ${action} ip=${req.ip}${details ? " " + details : ""}`);
}
