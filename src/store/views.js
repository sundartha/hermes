// Read-Views ueber den Store: pure, store-/state-parametrisierte Helfer fuer die
// API-Antworten (Dashboard + Self-Service). BEWUSST store/state als Argument (nicht
// das globale store-Modul importiert): so teilen server.js (globales Backend) UND
// die in-process getestete Self-Service-Factory (injizierter pglite-Store) EINE
// Quelle (G5/DIP) - kein Mismatch zwischen Test- und Produktions-Store.
import { NUMBER_STATUS, GLOBAL_CAP_REASON } from "./defaults.js";
import { findTenant } from "./state-ops.js";

// Call-Record fuer API-Antworten: streamToken (Zugangsgeheimnis des /media-Streams)
// und interne Flags duerfen den Server nie verlassen. summarySmsSentAt (F2 P9) ist ein
// rein interner persistierter Dedup-Marker -> wie _finished gestrippt (kein API-Leak).
// aiAssistantToken (Telnyx-P1) ist das per-Call-Secret des Brain-Shims -> wie streamToken
// strippen, damit es NIE ueber /api/state oder /api/calls/:id leakt (Regel 4).
export function publicCall({ streamToken, _finished, summarySmsSentAt, aiAssistantToken, ...rest }) {
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

// Existiert IRGENDEINE aktive Nummer im Store? Tenant-agnostisches Boot-Gate-Praedikat
// (P2b): der Dienst ist "telefonbar", sobald mind. ein Tenant eine aktive Nummer hat -
// kein OWNER/BOOTSTRAP-Pin mehr. Gleiche Status-Quelle wie findActiveNumber (G5).
export function hasActiveNumber(s) {
  return s.numbers.some((n) => n.status === NUMBER_STATUS.ACTIVE);
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
  BLOCKED: "blocked", // Abo aktiv, Provisioning aber am globalen Cap gescheitert (Fix B)
  NONE: "none",
});

export function numberStatusFor(s, tenantId) {
  const own = s.numbers.filter((n) => n.tenantId === tenantId);
  if (own.some((n) => n.status === NUMBER_STATUS.ACTIVE)) return NUMBER_DISPLAY_STATUS.ACTIVE;
  if (own.some((n) => n.status === NUMBER_STATUS.PROVISIONING || n.status === NUMBER_STATUS.CAPTURING))
    return NUMBER_DISPLAY_STATUS.PROVISIONING;
  if (own.some((n) => n.status === NUMBER_STATUS.REQUESTED)) return NUMBER_DISPLAY_STATUS.REQUESTED;
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
