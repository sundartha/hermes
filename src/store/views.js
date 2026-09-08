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
// KS-P5: die zwei Belastungs-Anker (estimatedCostSpendMonthKey/estimatedCostPeriodKey)
// verlassen die API ebenfalls NICHT - sie gehoeren zur selben internen Abrechnungs-Achse
// wie estimatedCostCents. Ohne das Strippen wanderten zwei neue Felder in /api/state und
// die MCP-Ausgaben und braechen die Byte-Identitaet der Read-Parity-Tests.
// LCT P2: die fuenf Kosten-Felder verlassen die API NICHT (Muster summarySmsSentAt) -
// interne Abrechnungs-/Forensik-Groessen, kein Anzeige-Vertrag. Haelt /api/state und die
// Self-Service-Antwort BYTE-IDENTISCH zum Bestand; die Sichtbarkeit entscheidet P5, nicht
// diese inerte Phase.
// AL-P1: telnyxConversationId (Provider-Handle) und callerTurns (Forensik-Zaehler)
// verlassen die API NICHT (Muster summarySmsSentAt / LCT-P2-Kostenfelder) - kein
// Anzeige-Vertrag, kein Nutzer wartet darauf. Haelt /api/state + die Self-Service-
// Antwort BYTE-IDENTISCH zum Bestand; Sichtbarkeit entscheidet spaeter eine Phase, die
// sie braucht, nicht diese Messphase.
// AL-P11: `result` wird BEWUSST NICHT gestrippt - die Ergebnis-Karte ist genau das,
// was Dashboard und Art.-15-Export zeigen sollen. Der PII-empfindliche Teil (evidence)
// haengt an der kurzen Frist, nicht an dieser Sicht.
// OUTBOUND-E5: `fromActualE164`/`fromSource` werden BEWUSST NICHT gestrippt (anders als
// `fromRegistrationSource` oben, ein rein interner Betriebs-Marker) - sie beantworten
// genau die Nutzer-Frage "welche Nummer wurde tatsaechlich gesendet", ist die Nummer, die
// der Angerufene ohnehin sieht, und traegt kein Fremdtenant-Feld.
export function publicCall({
  streamToken,
  _finished,
  summarySmsSentAt,
  // F2-Mail: der Summary-Mail-Dedup-Marker ist wie summarySmsSentAt rein intern (kein
  // API-Leak, Muster oben).
  summaryMailSentAt,
  telnyxConversationId,
  callerTurns,
  estimatedCostCents,
  estimatedCostSpendMonthKey,
  estimatedCostPeriodKey,
  actualCostMicroCents,
  costTruedAt,
  costTruedSource,
  costTruingAttempts,
  // INBOX-P1: beide Inbox-Marker sind rein intern.
  inboxEntryAt,
  inboxSeenAt,
  // OUTBOUND-E5: rein interner Betriebs-Marker (Muster summarySmsSentAt/telnyxConversationId).
  // Er beantwortet eine Betreiber-Frage ("ging die eigene DID raus?"), keine Nutzer-Frage.
  fromRegistrationSource,
  // KV2-2: das Kostenprofil ist ein Betreiber-Datum wie die uebrigen Kosten-Felder
  // darueber (estimatedCostCents … costTruingAttempts) - es beantwortet keine
  // Nutzerfrage und hat in /api/state nichts verloren.
  costProfile,
  // ST3: Betreiber-Diagnose-Zaehler der Stimmen-Detektoren (PII-frei) - beantwortet
  // keine Nutzerfrage, Muster costProfile (kein /api/state-Leak).
  elDetectorCounts,
  // SEC-P1: die Ereignis-Anker sind ein rein interner Wiederholungs-Riegel (Muster
  // summarySmsSentAt/costProfile) - keine Nutzerfrage, kein Anzeige-Vertrag. Haelt
  // /api/state, die Self-Service-Antwort und die MCP-Ausgaben BYTE-IDENTISCH.
  webhookAnchors,
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
export function findActiveNumber(state, tenantId, provider) {
  return state.numbers.find(
    (number) =>
      number.tenantId === tenantId &&
      number.status === NUMBER_STATUS.ACTIVE &&
      (provider === undefined || number.provider === provider),
  );
}

// Sprache eines Tenants OHNE laufenden Call (Self-Service-Ansicht, Greeting-Migration):
// dieselbe Praezedenz wie im Anruf (resolveCallLanguage), mit der aktiven Nummer als
// Geo-Anker - EINE Quelle (G5), damit die Vorlagen-Sprache im Dashboard nicht von der
// Sprache abweicht, in der der Anruf spaeter tatsaechlich rendert.
export function tenantLanguage(state, tenantId) {
  return resolveCallLanguage(state, { tenantId, numberRecord: findActiveNumber(state, tenantId) });
}

// Existiert IRGENDEINE aktive Nummer im Store? Tenant-agnostisches Boot-Gate-Praedikat
// (P2b): der Dienst ist "telefonbar", sobald mind. ein Tenant eine aktive Nummer hat -
// kein OWNER/BOOTSTRAP-Pin mehr. Gleiche Status-Quelle wie findActiveNumber (G5).
export function hasActiveNumber(state) {
  return state.numbers.some((number) => number.status === NUMBER_STATUS.ACTIVE);
}

// LCT P7 (Fixkosten sichtbar machen): Plattform-weiter Zaehler aktiver Nummern fuer die
// DID-Listenmiete-Anzeige (GET /api/billing/platform-costs). PII-frei: liefert nur eine
// Ganzzahl, KEINE E.164/Tenant-Kennung. Gleiche Status-Quelle wie hasActiveNumber (G5).
export function countActiveNumbers(state) {
  return state.numbers.filter((number) => number.status === NUMBER_STATUS.ACTIVE).length;
}

// Aktive Nummer eines Tenants als e164-String fuer die Anzeige (fail-closed: keine
// eigene aktive Nummer -> "", NIE die Nummer eines fremden Tenants als Fallback ->
// kein PII-/Toll-Fraud-Leck). Gleiche Quelle wie outboundFrom (findActiveNumber).
export function activeNumberFor(state, tenantId) {
  const hit = findActiveNumber(state, tenantId);
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

export function numberStatusFor(state, tenantId) {
  const own = state.numbers.filter((number) => number.tenantId === tenantId);
  if (own.some((number) => number.status === NUMBER_STATUS.ACTIVE)) return NUMBER_DISPLAY_STATUS.ACTIVE;
  if (own.some((number) => number.status === NUMBER_STATUS.PROVISIONING || number.status === NUMBER_STATUS.CAPTURING))
    return NUMBER_DISPLAY_STATUS.PROVISIONING;
  if (own.some((number) => number.status === NUMBER_STATUS.REQUESTED)) return NUMBER_DISPLAY_STATUS.REQUESTED;
  // Reale (wenn auch gescheiterte) Nummer schlaegt IMMER den globalen Skip-Marker unten
  // (gleiche Prioritaet wie ACTIVE/PROVISIONING/REQUESTED oben, Invariante 3 Fix B): ein
  // Retry legt eine FRISCHE Nummer an statt die alte 'failed' wiederzubeleben (own faellt
  // nie leer) - die frische gewinnt bereits ueber die Checks oben.
  if (own.some((number) => number.status === NUMBER_STATUS.FAILED)) return NUMBER_DISPLAY_STATUS.FAILED;
  if (findTenant(state, tenantId)?.numberProvisionSkipReason === GLOBAL_CAP_REASON)
    return NUMBER_DISPLAY_STATUS.BLOCKED;
  return NUMBER_DISPLAY_STATUS.NONE;
}

// Kommende Termine eines Tenants (vergangene weggefiltert). EINE Quelle (G5) fuer
// /api/state und /api/self-service/state; die routen-spezifische Slice bleibt am
// Aufrufer. store wird injiziert (DIP), damit Test- und Produktions-Store dieselbe
// Funktion nutzen.
export function upcomingCalendar(store, tenantId) {
  return store.getCalendar(tenantId).filter((event) => event.end >= new Date().toISOString());
}
