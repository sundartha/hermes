// Read-Views ueber den Store: pure, store-/state-parametrisierte Helfer fuer die
// API-Antworten (Dashboard + Self-Service). BEWUSST store/state als Argument (nicht
// das globale store-Modul importiert): so teilen server.js (globales Backend) UND
// die in-process getestete Self-Service-Factory (injizierter pglite-Store) EINE
// Quelle (G5/DIP) - kein Mismatch zwischen Test- und Produktions-Store.
import { NUMBER_STATUS, GLOBAL_CAP_REASON } from "./defaults.js";
import { findTenant, resolveCallLanguage } from "./state-ops.js";

// Call-Record fuer API-Antworten: streamToken (Zugangsgeheimnis des /media-Streams)
// und interne Flags duerfen den Server nie verlassen. summarySmsSentAt (F2 P9) ist ein
// rein interner persistierter Dedup-Marker -> wie _finished gestrippt (kein API-Leak).
// LCT P2: die fuenf Kosten-Felder verlassen die API NICHT (Muster summarySmsSentAt) -
// interne Abrechnungs-/Forensik-Groessen, kein Anzeige-Vertrag. Haelt /api/state und die
// Self-Service-Antwort BYTE-IDENTISCH zum Bestand; die Sichtbarkeit entscheidet P5, nicht
// diese inerte Phase.
// AL-P1: telnyxConversationId (Provider-Handle) und callerTurns (Forensik-Zaehler)
// verlassen die API NICHT (Muster summarySmsSentAt / LCT-P2-Kostenfelder) - kein
// Anzeige-Vertrag, kein Nutzer wartet darauf. Haelt /api/state + die Self-Service-
// Antwort BYTE-IDENTISCH zum Bestand; Sichtbarkeit entscheidet spaeter eine Phase, die
// sie braucht, nicht diese Messphase.
export function publicCall({
  streamToken,
  _finished,
  summarySmsSentAt,
  telnyxConversationId,
  callerTurns,
  estimatedCostCents,
  actualCostMicroCents,
  costTruedAt,
  costTruedSource,
  costTruingAttempts,
  ...rest
}) {
  return rest;
}

// Die EINE aktive Nummer eines Tenants aus der numbers-Tabelle (eine Quelle fuer
// outboundFrom (Absender-Wahl) UND activeNumberFor (/api/state-Anzeige) - kein
// doppelter Tenant-/Status-Filter, G5). Liefert den Datensatz oder undefined.
// Optionales provider-Argument: gesetzt -> zusaetzlich nach Provider filtern (z.B.
// finishCall braucht die SMS-Absendernummer DESSELBEN Providers wie der Call);
// weggelassen -> erste aktive Nummer (Default fuer outboundFrom).
export function findActiveNumber(s, tenantId, provider) {
  return s.numbers.find(
    (n) =>
      n.tenantId === tenantId &&
      n.status === NUMBER_STATUS.ACTIVE &&
      (provider === undefined || n.provider === provider),
  );
}

// Sprache eines Tenants OHNE laufenden Call (Self-Service-Ansicht, Greeting-Migration):
// dieselbe Praezedenz wie im Anruf (resolveCallLanguage), mit der aktiven Nummer als
// Geo-Anker - EINE Quelle (G5), damit die Vorlagen-Sprache im Dashboard nicht von der
// Sprache abweicht, in der der Anruf spaeter tatsaechlich rendert.
export function tenantLanguage(s, tenantId) {
  return resolveCallLanguage(s, { tenantId, numberRecord: findActiveNumber(s, tenantId) });
}

// Existiert IRGENDEINE aktive Nummer im Store? Tenant-agnostisches Boot-Gate-Praedikat
// (P2b): der Dienst ist "telefonbar", sobald mind. ein Tenant eine aktive Nummer hat -
// kein OWNER/BOOTSTRAP-Pin mehr. Gleiche Status-Quelle wie findActiveNumber (G5).
export function hasActiveNumber(s) {
  return s.numbers.some((n) => n.status === NUMBER_STATUS.ACTIVE);
}

// LCT P7 (Fixkosten sichtbar machen): Plattform-weiter Zaehler aktiver Nummern fuer die
// DID-Listenmiete-Anzeige (GET /api/billing/platform-costs). PII-frei: liefert nur eine
// Ganzzahl, KEINE E.164/Tenant-Kennung. Gleiche Status-Quelle wie hasActiveNumber (G5).
export function countActiveNumbers(s) {
  return s.numbers.filter((n) => n.status === NUMBER_STATUS.ACTIVE).length;
}

// Aktive Nummer eines Tenants als e164-String fuer die Anzeige (fail-closed: keine
// eigene aktive Nummer -> "", NIE die Nummer eines fremden Tenants als Fallback ->
// kein PII-/Toll-Fraud-Leck). Gleiche Quelle wie outboundFrom (findActiveNumber).
export function activeNumberFor(s, tenantId) {
  const hit = findActiveNumber(s, tenantId);
  return hit ? hit.e164 : "";
}

// Anzeige-Status der EINEN Nummer eines Tenants fuer den Dashboard-Chip (read-only,
// tenant-gescoped, fail-closed). Praesentations-Enum (NICHT der interne Lifecycle):
// provisioning+capturing -> "provisioning" ("wird eingerichtet"); keine Nummer -> "none".
// EINE Quelle (G5) fuer /api/state UND /api/self-service/state; kein Fremd-Tenant-Leck.
export const NUMBER_DISPLAY_STATUS = Object.freeze({
  ACTIVE: "active",
  PROVISIONING: "provisioning",
  REQUESTED: "requested",
  FAILED: "failed", // Nummer-Kauf/-Gebuehr gescheitert (z.B. placeHold 402) -> Retry noetig (Fix C)
  BLOCKED: "blocked", // Abo aktiv, Provisioning aber am globalen Cap gescheitert (Fix B)
  NONE: "none",
});

export function numberStatusFor(s, tenantId) {
  const own = s.numbers.filter((n) => n.tenantId === tenantId);
  if (own.some((n) => n.status === NUMBER_STATUS.ACTIVE)) return NUMBER_DISPLAY_STATUS.ACTIVE;
  if (own.some((n) => n.status === NUMBER_STATUS.PROVISIONING || n.status === NUMBER_STATUS.CAPTURING))
    return NUMBER_DISPLAY_STATUS.PROVISIONING;
  if (own.some((n) => n.status === NUMBER_STATUS.REQUESTED)) return NUMBER_DISPLAY_STATUS.REQUESTED;
  // Reale (wenn auch gescheiterte) Nummer schlaegt IMMER den globalen Skip-Marker unten
  // (gleiche Prioritaet wie ACTIVE/PROVISIONING/REQUESTED oben, Invariante 3 Fix B): ein
  // Retry legt eine FRISCHE Nummer an statt die alte 'failed' wiederzubeleben (own faellt
  // nie leer) - die frische gewinnt bereits ueber die Checks oben.
  if (own.some((n) => n.status === NUMBER_STATUS.FAILED)) return NUMBER_DISPLAY_STATUS.FAILED;
  if (findTenant(s, tenantId)?.numberProvisionSkipReason === GLOBAL_CAP_REASON)
    return NUMBER_DISPLAY_STATUS.BLOCKED;
  return NUMBER_DISPLAY_STATUS.NONE;
}

// Kommende Termine eines Tenants (vergangene weggefiltert). EINE Quelle (G5) fuer
// /api/state und /api/self-service/state; die routen-spezifische Slice bleibt am
// Aufrufer. store wird injiziert (DIP), damit Test- und Produktions-Store dieselbe
// Funktion nutzen.
export function upcomingCalendar(store, tenantId) {
  return store.getCalendar(tenantId).filter((e) => e.end >= new Date().toISOString());
}
