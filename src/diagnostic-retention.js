// Diagnose-Retention (PLAN-CONVERSATION-QUALITY-V2 P2b): die EINE Quelle fuer die Frage
// "darf das Roh-Transkript dieses Calls die Summary ueberleben?". Zwei Entscheidungen,
// eine Regel:
//   - beim Anlegen (POST /api/calls): entscheidet der SERVER, gegen einen Widerspruch
//     des Aufrufers;
//   - beim Abschluss (finishCall):     unterbleibt der Purge?
// Rein: kein Store, kein IO, kein config-Import - beide Aufrufer injizieren, was sie
// ohnehin in der Hand haben. Damit offline und ohne Spawn testbar.
//
// GQ-P11: bis 2026-08-06 verlangte das Anlege-Gate ein ausdrueckliches Opt-in im
// Request-Body - also, dass das CLIENT-MODELL das Flag von sich aus setzt. Gemessen:
// 58 Calls in Produktion, kein einziger mit diagnostic=true. Das Diagnose-Werkzeug hing
// damit an genau dem Verhalten, das es diagnostizieren soll. Seither ist der Wunsch des
// Aufrufers ein OPT-OUT.
//
// FAIL-CLOSED (DSGVO/Datenminimierung): fehlende eigene Nummer, fremdes Ziel oder Frist 0
// ergibt weiterhin EXAKT das Bestandsverhalten (Purge nach der Summary). Die eigentliche
// Datenschutz-Grenze ist und bleibt die ZIEL-Pruefung (to === ownNumber), die serverseitig
// hier liegt - nicht der Body-Wert.

// Ist die Diagnose-Retention ueberhaupt scharf? DIAGNOSTIC_RETENTION_DAYS=0 = Feature aus
// (Plan P2b Punkt 2): dann wird weder ein Flag gewaehrt noch ein Purge unterdrueckt.
export function diagnosticRetentionEnabled(privacy) {
  return privacy.diagnosticRetentionDays > 0;
}

// Die beiden Formen, in denen ein Widerspruch ankommen kann: als JSON-Boolean und als
// urlencodeter String (app.js parst BEIDE Body-Typen). Der Bestandskommentar hat den Fall
// schon einmal richtig gesehen, nur in der anderen Richtung: ein nicht-leerer String ist
// truthy. Seit der Umkehrung ist die Falle spiegelbildlich - eine Truthiness-Pruefung
// wuerde ein "false" verschlucken und die Aufbewahrung genau dann verlaengern, wenn ihr
// widersprochen wurde. Deshalb ausdruecklich gegen beide Formen, nie per Truthiness.
const DECLINE_VALUES = new Set([false, "false"]);

function callerDeclined(requested) {
  return DECLINE_VALUES.has(requested);
}

// Darf `call.diagnostic` fuer diesen Outbound gesetzt werden?
//   requested  - der rohe Body-Wert. Seit GQ-P11 ein OPT-OUT: nur ein ausdruecklicher
//                Widerspruch (false / "false") verhindert die Aufbewahrung; fehlt er,
//                entscheidet allein der Server ueber Ziel und Frist.
//   to         - das BEREITS normalisierte Ziel (ctx.to nach dem normalize_target-Gate).
//   ownNumber  - die eigene verifizierte Nummer des Tenants (store.tenantPrivateNumber;
//                beim Setzen ueber setPrivateNumber E.164- UND land-validiert).
// Ein Anruf an die eigene verifizierte Nummer IST ein Testanruf - beide Seiten der Leitung
// gehoeren demselben Tenant. Kein Treffer -> false, ohne Fehler: der Anruf laeuft normal,
// nur ohne Diagnose-Retention.
export function diagnosticRetentionGranted({ requested, to, ownNumber, privacy }) {
  if (callerDeclined(requested)) return false;
  if (!diagnosticRetentionEnabled(privacy)) return false;
  return Boolean(ownNumber) && to === ownNumber;
}

// Ueberlebt das Roh-Transkript dieses Calls den Summary-Abschluss? Zweite Linie zum
// Anlege-Gate (Defense-in-depth, dieselbe EINE Regel): eine nachtraeglich auf 0 gedrehte
// Frist schaltet die Retention auch fuer bereits markierte Calls ab.
export function keepsTranscriptForDiagnosis(call, privacy) {
  return call.diagnostic === true && diagnosticRetentionEnabled(privacy);
}
