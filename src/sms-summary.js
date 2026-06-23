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
//  - reason ist NUR bei fehlendem Ziel != null; sonst null.
import { findActiveNumber } from "./store/views.js";

export function planSummarySms(store, config, call) {
  const to = store.tenantPrivateNumber(call.tenantId);
  // Absender = aktive Nummer des Call-Tenants auf DEMSELBEN Provider wie der Call.
  const smsFrom = findActiveNumber(store.load(), call.tenantId, call.provider);
  const optIn = store.tenantContext(call.tenantId).settings.smsSummaryOptIn;
  if (!config.sendSmsSummary) return { to, smsFrom, send: false, reason: null };
  if (!to) return { to, smsFrom, send: false, reason: "no_private_number" };
  if (!smsFrom || !optIn) return { to, smsFrom, send: false, reason: null };
  return { to, smsFrom, send: true, reason: null };
}
