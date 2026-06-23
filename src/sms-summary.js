// F2 P7: Ziel- und Sende-Entscheidung fuer die Summary-SMS nach einem Inbound-Call.
// Aus finishCall (server.js) ausgelagert, damit die sicherheitskritische Logik OFFLINE
// unit-testbar ist (server.js bootet beim Import: app.listen + Boot-Guard-process.exit).
//
// Reine LESE-Entscheidung: kein Schreib-IO, kein Netz-Call. Liest nur aus dem Store.
//
// Garantien:
//  - Ziel IMMER ueber call.tenantId (derselbe Schluessel wie der Absender-Lookup) -> keine
//    Cross-Tenant-Fehlzustellung (H3). Das Ziel ist die PRIVATE Nummer des Call-Tenants,
//    NICHT mehr config.ownerNumber - es gibt KEINEN ownerNumber-Fallback (AK #5).
//  - Kein Ziel (keine private Nummer hinterlegt) -> nicht senden, reason="no_private_number"
//    (PII-frei auditierbar). Notification + kein Throw liegen beim Aufrufer (M4).
//  - Opt-Out (settings.smsSummaryOptIn === false, Decision #2), globaler Feature-Schalter
//    (config.sendSmsSummary) und fehlender Absender unterdruecken den Versand OHNE
//    reason-Audit (das sind keine "Ziel fehlt"-Faelle, nichts pro Tenant zu melden).
//  - Tages-Cap (F2 P8, Toll-Fraud H1): N erfolgreich gesendete Summary-SMS pro Tenant im
//    rollierenden 24h-Fenster -> die naechste wird mit reason="daily_cap" still uebersprungen
//    (PII-frei auditierbar). Quelle ist der Usage-Ledger (store.dailySmsCount).
//  - reason ist bei fehlendem Ziel ("no_private_number") UND bei erreichtem Tages-Cap
//    ("daily_cap") != null; sonst null.
import { findActiveNumber } from "./store/views.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function planSummarySms(store, config, call) {
  const to = store.tenantPrivateNumber(call.tenantId);
  // Absender = aktive Nummer des Call-Tenants auf DEMSELBEN Provider wie der Call.
  const smsFrom = findActiveNumber(store.load(), call.tenantId, call.provider);
  const optIn = store.tenantContext(call.tenantId).settings.smsSummaryOptIn;
  // F2 P9 (M2): persistierter Dedup-Marker - wurde fuer diesen Call schon eine Summary-SMS
  // gesendet, NIE erneut senden. Der Marker (call.summarySmsSentAt) ueberlebt den Prozess-
  // Restart, anders als das In-Memory-Flag call._finished -> genau eine SMS pro Call, auch
  // bei mehrfachem /voice/status-Callback mit Restart dazwischen. Kein reason (normaler
  // Dedup, kein Ziel-Defizit -> nichts pro Tenant zu auditieren).
  if (call.summarySmsSentAt) return { to, smsFrom, send: false, reason: null };
  if (!config.sendSmsSummary) return { to, smsFrom, send: false, reason: null };
  if (!to) return { to, smsFrom, send: false, reason: "no_private_number" };
  if (!smsFrom || !optIn) return { to, smsFrom, send: false, reason: null };
  // Tages-Cap pro Tenant (H1): zaehlt NUR erfolgreich gesendete SMS (Ledger), im
  // rollierenden 24h-Fenster. Cap erreicht -> still uebersprungen, kein Fehler.
  const since = new Date(Date.now() - MS_PER_DAY).toISOString();
  if (store.dailySmsCount(call.tenantId, since) >= (config.dailySmsCap ?? 20))
    return { to, smsFrom, send: false, reason: "daily_cap" };
  return { to, smsFrom, send: true, reason: null };
}
