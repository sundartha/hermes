// Read-Views ueber den Store: pure, store-/state-parametrisierte Helfer fuer die
// API-Antworten (Dashboard + Self-Service). BEWUSST store/state als Argument (nicht
// das globale store-Modul importiert): so teilen server.js (globales Backend) UND
// die in-process getestete Self-Service-Factory (injizierter pglite-Store) EINE
// Quelle (G5/DIP) - kein Mismatch zwischen Test- und Produktions-Store.
import { NUMBER_STATUS } from "./defaults.js";

// Call-Record fuer API-Antworten: streamToken (Zugangsgeheimnis des /media-Streams)
// und interne Flags duerfen den Server nie verlassen.
export function publicCall({ streamToken, _finished, ...rest }) {
  return rest;
}

// Die EINE aktive Nummer eines Tenants aus der numbers-Tabelle (eine Quelle fuer
// outboundFrom (Absender-Wahl) UND activeNumberFor (/api/state-Anzeige) - kein
// doppelter Tenant-/Status-Filter, G5). Liefert den Datensatz oder undefined.
export function findActiveNumber(s, tenantId) {
  return s.numbers.find((n) => n.tenantId === tenantId && n.status === NUMBER_STATUS.ACTIVE);
}

// Aktive Nummer eines Tenants als e164-String fuer die Anzeige (fail-closed: keine
// eigene aktive Nummer -> "", NIE config.twilioNumber als Fremd-Tenant-Fallback ->
// kein PII-/Toll-Fraud-Leck). Gleiche Quelle wie outboundFrom (findActiveNumber).
export function activeNumberFor(s, tenantId) {
  const hit = findActiveNumber(s, tenantId);
  return hit ? hit.e164 : "";
}

// Kommende Termine eines Tenants (vergangene weggefiltert). EINE Quelle (G5) fuer
// /api/state und /api/self-service/state; die routen-spezifische Slice bleibt am
// Aufrufer. store wird injiziert (DIP), damit Test- und Produktions-Store dieselbe
// Funktion nutzen.
export function upcomingCalendar(store, tenantId) {
  return store.getCalendar(tenantId).filter((e) => e.end >= new Date().toISOString());
}
