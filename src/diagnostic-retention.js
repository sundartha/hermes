// Diagnose-Retention (PLAN-CONVERSATION-QUALITY-V2 P2b): die EINE Quelle fuer die Frage
// "darf das Roh-Transkript dieses Calls die Summary ueberleben?". Zwei Entscheidungen,
// eine Regel:
//   - beim Anlegen (POST /api/calls): darf der Wunsch des Aufrufers gewaehrt werden?
//   - beim Abschluss (finishCall):     unterbleibt der Purge?
// Rein: kein Store, kein IO, kein config-Import - beide Aufrufer injizieren, was sie
// ohnehin in der Hand haben. Damit offline und ohne Spawn testbar.
//
// FAIL-CLOSED (DSGVO/Datenminimierung): kein Flag, kein Treffer oder Frist 0 ergibt
// EXAKT das heutige Verhalten (Purge nach der Summary). Der Wunsch aus dem Request-Body
// ist NIE die Wahrheit - die Ziel-Pruefung liegt serverseitig, hier.

// Ist die Diagnose-Retention ueberhaupt scharf? DIAGNOSTIC_RETENTION_DAYS=0 = Feature aus
// (Plan P2b Punkt 2): dann wird weder ein Flag gewaehrt noch ein Purge unterdrueckt.
export function diagnosticRetentionEnabled(privacy) {
  return privacy.diagnosticRetentionDays > 0;
}

// Darf `call.diagnostic` fuer diesen Outbound gesetzt werden?
//   requested  - der rohe Body-Wunsch. STRIKT === true: ein urlencoded "false" ist ein
//                nicht-leerer String und damit truthy - jede lockere Pruefung wuerde die
//                Aufbewahrung genau dann verlaengern, wenn sie abgelehnt werden soll.
//   to         - das BEREITS normalisierte Ziel (ctx.to nach dem normalize_target-Gate).
//   ownNumber  - die eigene verifizierte Nummer des Tenants (store.tenantPrivateNumber;
//                beim Setzen ueber setPrivateNumber E.164- UND land-validiert).
// Kein Treffer -> false, ohne Fehler: der Anruf laeuft normal, nur ohne Diagnose-Retention.
export function diagnosticRetentionGranted({ requested, to, ownNumber, privacy }) {
  if (requested !== true) return false;
  if (!diagnosticRetentionEnabled(privacy)) return false;
  return Boolean(ownNumber) && to === ownNumber;
}

// Ueberlebt das Roh-Transkript dieses Calls den Summary-Abschluss? Zweite Linie zum
// Anlege-Gate (Defense-in-depth, dieselbe EINE Regel): eine nachtraeglich auf 0 gedrehte
// Frist schaltet die Retention auch fuer bereits markierte Calls ab.
export function keepsTranscriptForDiagnosis(call, privacy) {
  return call.diagnostic === true && diagnosticRetentionEnabled(privacy);
}
