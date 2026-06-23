// Gemeinsame Sicherheits-Helfer fuer Gateway und Audio-Bridge.
import crypto from "crypto";

// Timing-sicherer Vergleich fuer Passwoerter/Tokens (kein Timing-Seitenkanal wie bei ===)
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Audit-Logzeile fuer sicherheitsrelevante Aktionen (Call-Ausloesung, Cancel,
// Settings, Auth-Fehlversuche). details NIEMALS mit Secrets/PII fuellen.
// req optional: server-interne Ereignisse OHNE Request (z.B. finishCall ->
// sms_summary_skipped) rufen mit req=null und werden als ip=system markiert.
export function audit(action, req, details = "") {
  console.log(`[audit] ${action} ip=${req?.ip ?? "system"}${details ? " " + details : ""}`);
}
