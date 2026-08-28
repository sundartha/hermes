// CDF1 (Report #2 5.4): maschinenlesbarer, PII-freier Fehlergrund aus dem normalisierten
// Provider-Lifecycle ({status, diagnostics} aus extractLifecycleEvent). Provider-agnostisch:
// die CallStatus-Vokabel ist Twilio-Konvention, die Telnyx' TeXML spiegelt; der SIP-Cause
// verfeinert NUR den generischen "failed"-Fall. PII-frei by construction (nur Status-/
// Cause-Token, NIE Nummern/Namen - diagnostics.sipHangupCause ist bereits ueber
// safeCauseToken gefiltert).
//
// OUTBOUND-E2 (F1, Regressionsfang Ausfall 27.08.2026): der Bestand oben klassifizierte
// urspruenglich NUR "zustande gekommen (completed) vs. nicht" - ein SIP-Code verfeinerte
// den generischen "failed"-Fall lediglich als angehaengtes DETAIL ("failed:403"), OHNE
// SCHULD-Klasse. Fuer den Fall "der Anruf kam nie zustande" gab es zusaetzlich gar kein
// Wort - deshalb trugen unser Konfigurationsdefekt (SIP 403, der Ausfall) und der
// Tippfehler eines Nutzers (SIP 404, Ziel existiert nicht) bis heute dasselbe Label.
//
// Review-Befund S2-1 (Runde 3): zwei Zuordnungen DESSELBEN SIP-Codes auf einen Grund waeren
// das Gegenteil des Etappenziels "EIN Fehlervokabular ueber alle Engines" gewesen - deshalb
// nutzt callFailureReason() unten (der TeXML-/Call-Control-Lifecycle-Weg) jetzt DIESELBE
// Schuld-Zuordnung sipBase() wie providerErrorReason() (der ElevenLabs-Weg). EINE
// Zuordnungstabelle (SIP-Code -> Schuld-Basis-Token), zwei Aufrufer - kein Zweitweg mehr,
// der denselben SIP-403 als blosses "failed" statt als "not-placed" ausgibt. Das Modul
// traegt weiterhin zwei Erzeuger-FAMILIEN (Lifecycle eines zustande gekommenen Gespraechs
// oben, Ablehnung eines nie zustande gekommenen Anrufs unten), aber nur noch EINE
// SIP-Klassifikation - beide PII-frei by construction, beide reine Funktionen ohne
// Netz-/Store-/Log-Zugriff.

// Erfolgs-/Selbstsprechende Status (Domaenen-Vokabel, identisch zur /voice/status-Terminalliste).
// Exportiert (G22, Nachfassrunde): telnyx-call-control-ingest.js braucht denselben Token fuer
// den gespeicherten Call-Status - EIN Wort an EINER Stelle statt zweimal woertlich getippt.
export const COMPLETED_STATUS = "completed";
// Status, die schon selbst den Grund tragen -> 1:1 als Token (Status gewinnt vor SIP-Cause,
// vgl. Spec-Beispiel: no-answer + sipHangupCause=487 -> "no-answer").
const SELF_DESCRIBING_FAILURES = ["no-answer", "busy", "canceled"];
const GENERIC_FAILURE_STATUS = "failed";
// Trenner zwischen Basis-Token und Detail ("failed:603"). EINE Quelle fuer den Erzeuger
// (callFailureReason) und den Leser (failureReasonBase) - vorher stand er nur als Literal
// im Template und musste vom Leser erraten werden.
const DETAIL_SEPARATOR = ":";

// Liefert ein stabiles, kleines Token (string) ODER null (Erfolg/aktiv/leer -> KEIN Grund).
// Form: "no-answer" | "busy" | "canceled" | "<schuld-basis>:invite-<sipcode>" |
// "failed:<roher-cause>" | "failed" | <roher status>. Der numerische SIP-Fall laeuft ueber
// sipBase() (S2-1: EINE Zuordnung mit providerErrorReason geteilt, s. Modul-Kopf); ein
// NICHT-numerischer Auflegegrund (z.B. Telnyx' "normal_clearing"-Wortfamilie, s.
// hangupCauseStatus weiter unten) faellt auf das alte, unklassifizierte Detail-Anhaengen
// zurueck - fail-closed, keine erfundene Schuld fuer einen Wert, der kein SIP-Statuscode ist.
export function callFailureReason({ status, diagnostics } = {}) {
  if (!status || status === COMPLETED_STATUS) return null;
  if (SELF_DESCRIBING_FAILURES.includes(status)) return status;
  if (status === GENERIC_FAILURE_STATUS) {
    const rawCause = diagnostics?.sipHangupCause;
    const sip = statusNumber(rawCause, SIP_STATUS_MAX);
    if (sip !== null) return reasonOf(sipBase(sip), detailOf(SOURCE_INVITE, sip));
    return rawCause ? `${GENERIC_FAILURE_STATUS}${DETAIL_SEPARATOR}${rawCause}` : GENERIC_FAILURE_STATUS;
  }
  return status; // unbekannter Nicht-completed-Status -> defensiver Passthrough, kein Bruch
}

// Basis-Token eines Grundes: "failed:603" -> "failed", "no-answer" -> "no-answer",
// null/leer -> null. Der Detail-Teil (SIP-Cause) verfeinert nur die Diagnose und hat
// bewusst keinen eigenen Nutzertext. Rein, ohne Nebeneffekt.
export function failureReasonBase(reason) {
  return reason ? String(reason).split(DETAIL_SEPARATOR)[0] : null;
}

// ---- OUTBOUND-E2 (F1): drei Basis-Klassen, getrennt nach SCHULD --------------------
// Der Bestand oben klassifiziert ein Gespraech, das ZUSTANDE KAM. Fuer den Fall "der
// Anruf kam nie zustande" gab es kein Wort - und deshalb trugen der Konfigurationsdefekt
// des Betreibers (SIP 403, Ausfall 27.08.2026) und der Tippfehler des Nutzers (SIP 404)
// bis heute dasselbe Label. Die Trennung ist der Kern: der Nutzertext loest auf dem
// BASIS-Token auf (i18n/failure-reason-texts.js), und der spaetere Betreiber-Alarm zaehlt
// genau EINE Klasse.
export const NOT_PLACED = "not-placed"; // unsere/des Anbieters Schuld
export const UNREACHABLE = "unreachable"; // das Ziel ist nicht erreichbar
export const RESULT_UNKNOWN = "result-unknown"; // der Ausgang ist unbekannt

// EINE Quelle aller Basis-Token, die DIESES Modul erzeugt. Grund: der Vollstaendigkeits-
// Waechter (test/gq-p15-failure-reason-notification.test.js) baute seine Menge bisher aus
// einem hartkodierten Array - ein Token aus einem neuen Erzeuger tauchte dort NIE auf und
// der Nutzer bekam wieder "<Ziel> (Status: failed)". Der defensive Passthrough
// (unbekannter Nicht-completed-Status, s. callFailureReason) steht bewusst NICHT drin: er
// ist nicht aufzaehlbar und faellt absichtlich auf den Bestandstext zurueck (GQ-P15-A4).
export const FAILURE_REASON_BASE_TOKENS = Object.freeze([
  ...SELF_DESCRIBING_FAILURES,
  GENERIC_FAILURE_STATUS,
  NOT_PLACED,
  UNREACHABLE,
  RESULT_UNKNOWN,
]);

// Quelle des Details - geschlossene Menge, nie aus Anbieter-Text gebildet.
const SOURCE_START = "start";
const SOURCE_INVITE = "invite";
const SOURCE_PROVIDER = "provider";
const SOURCE_POLL = "poll";
const POLL_TIMEOUT_DETAIL = "timeout";

// HTTP-Klassen des ANRUFSTARTS. 4xx = der Anbieter hat uns abgelehnt (Schluessel, Nummer,
// Konto) -> unsere Schuld. 5xx = er hat uns nicht geantwortet -> wir wissen NICHT, ob
// gewaehlt wurde. Genau diese Trennung haelt spaeter den Alarm sauber: ein 5xx-Sturm des
// Anbieters darf nicht wie ein Konfigurationsdefekt zaehlen.
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_STATUS_MAX = 599;

// SIP-Status. Quelle: RFC 3261 (401/403/404/407/480/486/603), Bedeutung je Code dort.
const SIP_UNAUTHORIZED = 401;
const SIP_FORBIDDEN = 403;
const SIP_PROXY_AUTH_REQUIRED = 407;
const SIP_NOT_FOUND = 404;
const SIP_TEMPORARILY_UNAVAILABLE = 480;
const SIP_BUSY_HERE = 486;
const SIP_DECLINE = 603;
const SIP_SERVER_ERROR_MIN = 500;
// Obergrenze der 5xx-Klasse (RFC 3261: 6xx ist eine eigene "global failure"-Klasse, nicht
// mehr "server error"). Nur 5xx ist durch den Kommentar bei NOT_PLACED_SIP_STATUS belegt
// ("der Trunk/Carrier hat den INVITE definitiv abgelehnt") - fuer 6xx existiert keine
// Belegung, deshalb faellt 6xx (ausser den unten explizit belegten Codes) auf
// RESULT_UNKNOWN zurueck (fail-closed, s. sipBase).
const SIP_GLOBAL_FAILURE_MIN = 600;
const SIP_STATUS_MAX = 699;

// Wer den INVITE abgelehnt hat, entscheidet die Klasse - NICHT die Zahl an sich.
// 401/403/407: die Gegenseite verweigert UNSERE Berechtigung (der 27.08.-Fall: die
// Absendernummer gehoerte dem Konto nicht mehr). 5xx: der Trunk/Carrier hat den INVITE
// definitiv abgelehnt - ebenfalls unsere Seite, anders als beim HTTP-5xx, wo wir gar
// keine Antwort haben.
const NOT_PLACED_SIP_STATUS = new Set([SIP_UNAUTHORIZED, SIP_FORBIDDEN, SIP_PROXY_AUTH_REQUIRED]);
const UNREACHABLE_SIP_STATUS = new Set([
  SIP_NOT_FOUND,
  SIP_TEMPORARILY_UNAVAILABLE,
  SIP_BUSY_HERE,
  SIP_DECLINE,
]);

// Die EINZIGEN zwei Muster, die den Anbieter-Freitext beruehren duerfen. Sie LESEN, sie
// reichen nicht durch: was sie greifen, ist eine 3-stellige Zahl bzw. ein Carrier-Kuerzel
// der Form D<zwei Ziffern>. Der Rohtext selbst wird weder gespeichert noch geloggt - er
// kann Rufnummern tragen ("Invalid destination number ..."). Dasselbe Niveau wie
// safeCauseToken (adapters/telnyx/webhook-events.js).
const SIP_STATUS_IN_REASON = /sip status:\s*(\d{3})/i;
const CARRIER_CODE_IN_REASON = /\bD\d{2}\b/;

// Ein Detail ist eine Verkettung gepruefter Bausteine - nie ein Fremdstring.
const detailOf = (source, code, carrier) => [source, code, carrier].filter(Boolean).join("-");
const reasonOf = (base, detail) => `${base}${DETAIL_SEPARATOR}${detail}`;

// Nur eine ganze Zahl im gueltigen Statusbereich wird zum Detail; alles andere faellt weg
// (kein NaN, kein Fremdtext, keine Ziffernfolge aus einer Rufnummer).
function statusNumber(value, max) {
  const zahl = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(zahl) && zahl >= HTTP_CLIENT_ERROR_MIN && zahl <= max ? zahl : null;
}

// HTTP-Ablehnung des ANRUFSTARTS -> Token. Rein, ohne Netz/Store/Log. Gilt fuer ALLE drei
// Engine-Zweige: der catch in routes/api-calls.js umschliesst sie alle.
// Kein providerStatus (Netzfehler/Timeout) -> null: wir behaupten keinen Grund, den wir
// nicht haben (Bestandsverhalten, s. PLAN Abschnitt 8).
export function startRejectionReason(providerStatus) {
  const code = statusNumber(providerStatus, HTTP_STATUS_MAX);
  if (code === null) return null;
  const base = code >= HTTP_SERVER_ERROR_MIN ? RESULT_UNKNOWN : NOT_PLACED;
  return reasonOf(base, detailOf(SOURCE_START, code));
}

// Der Fehler-Datensatz eines Anbieter-Gespraechs (ElevenLabs metadata.error) -> Token.
// Klassifiziert wird auf `code` (in der Anbieter-OpenAPI required) UND auf den aus dem
// Grundtext gezogenen SIP-Status. `error_type` wird BEWUSST NICHT gelesen: es ist live
// vorhanden, aber nicht Teil der veroeffentlichten Schemazusicherung - eine Klassifikation
// darauf waere eine Zusage, die uns niemand gegeben hat.
// Unbekannter SIP-Status -> RESULT_UNKNOWN (fail-closed): lieber "wir wissen es nicht" als
// eine erfundene Schuldzuweisung.
export function providerErrorReason(error) {
  if (!error || typeof error !== "object") return null;
  const reason = typeof error.reason === "string" ? error.reason : "";
  const sip = statusNumber(SIP_STATUS_IN_REASON.exec(reason)?.[1], SIP_STATUS_MAX);
  const carrier = CARRIER_CODE_IN_REASON.exec(reason)?.[0] ?? null;
  if (sip === null)
    return reasonOf(RESULT_UNKNOWN, detailOf(SOURCE_PROVIDER, statusNumber(error.code, HTTP_STATUS_MAX)));
  return reasonOf(sipBase(sip), detailOf(SOURCE_INVITE, sip, carrier));
}

// Die Schuld-Zuordnung des SIP-Status an EINER Stelle (haelt providerErrorReason unter der
// Komplexitaetsgrenze und macht die Regel als Regel lesbar).
function sipBase(sip) {
  if (UNREACHABLE_SIP_STATUS.has(sip)) return UNREACHABLE;
  if (NOT_PLACED_SIP_STATUS.has(sip)) return NOT_PLACED;
  if (sip >= SIP_SERVER_ERROR_MIN && sip < SIP_GLOBAL_FAILURE_MIN) return NOT_PLACED;
  return RESULT_UNKNOWN;
}

// Der Ergebnisabruf hat aufgegeben. BEIDE Faelle sind "wir wissen nicht, was passiert ist"
// - nicht "es ist schiefgegangen": der Anruf kann sehr wohl gelaufen sein.
export const POLL_TIMEOUT_REASON = reasonOf(RESULT_UNKNOWN, detailOf(SOURCE_POLL, POLL_TIMEOUT_DETAIL));

export function pollProviderErrorReason(providerStatus) {
  return reasonOf(RESULT_UNKNOWN, detailOf(SOURCE_POLL, SOURCE_PROVIDER, statusNumber(providerStatus, HTTP_STATUS_MAX)));
}

// Befund 5: TeXML liefert mit CallStatus bereits die vorklassifizierte Status-Vokabel
// (completed/busy/no-answer/canceled/failed); Telnyx' Call-Control-Pfad liefert dagegen NUR
// den rohen hangup_cause. Diese Tabelle uebernimmt fuer den Call-Control-Pfad genau die
// Klassifikation, die bei TeXML bereits Telnyx selbst vornimmt - damit callFailureReason()
// oben UNVERAENDERT wiederverwendet werden kann (G5: ein Reason-Vokabular fuer beide Pfade).
//
// Quellen je Kennung (Pflicht CLAUDE.md - "Erfinde keine"):
// - "timeout" -> no-answer: developers.telnyx.com/api-reference/call-commands/transfer-call
//   ("hangup_cause of timeout" bei nicht erreichter Annahme) UND LIVE-Beleg
//   tasks/befund-toolwahl-4-forensik.md Zeile 91f (hangup_cause=timeout sip_hangup_cause=487
//   = kein Antworten beim Ziel).
// - "user_busy" -> busy: Telnyx-Support-Artikel 5025298 ("Troubleshooting Call Completion"),
//   dort USER_BUSY(17) "the called party is currently engaged in another call".
// - "originator_cancel" -> canceled: KEIN eigenstaendiger Telnyx-Doku-Beleg gefunden (nur
//   die allgemeine Q.850/FreeSWITCH-Ursachenfamilie, der auch die zwei bestaetigten Werte
//   oben folgen). Quelle ist hier ausschliesslich die Testspezifikation (Fall 3) - im
//   Bericht als offene Luecke benannt.
const HANGUP_CAUSE_STATUS = Object.freeze({
  timeout: "no-answer",
  user_busy: "busy",
  originator_cancel: "canceled",
});

// Nachfassrunde (Blocker A, G26): "kein answered_at" darf NIE zwischen null und dem Feld-
// Fehlen (undefined) unterscheiden - genau diese Sorte Invariante hat das Repo schon einmal
// teuer bezahlt (Owner-Zitat). hangupCauseStatus prueft darum answeredAt nie auf Gleichheit
// mit null, sondern ausschliesslich auf TRUTHINESS: ein echter ISO-String ist truthy, sowohl
// null ALS AUCH undefined (und jeder andere leere Wert) sind falsy und nehmen denselben Zweig
// - kein Aufrufer kann diese Weiche durch Auslassen des Feldes umgehen, weder heute noch bei
// einem kuenftigen zweiten Provider-Adapter.

// Nachfassrunde (Blocker B, Gegner-Review): "kein answered_at" ist ein FEHLENDER Beleg,
// kein Beweis - call.answered und call.hangup sind getrennte Webhook-Requests ohne Ordnungs-
// /Wiederholungsgarantie (der Anbieter kann den ersten verlieren oder verspaetet liefern).
// Meldet Telnyx TROTZDEM eine Ursache, die nur bei einem zustandegekommenen Gespraech
// entsteht, WIDERSPRICHT das dem fehlenden Zeitstempel - und der Zweifel geht NICHT zulasten
// des Mandanten (sonst: falsche Fehlschlag-SMS UND 0 gebuchte Minuten, ein Geld-Defekt, der
// schwerer wiegt als der Ausgangsbefund). Belegte Kennung: "normal_clearing" (Fall 4/8 der
// Pruefung, LIVE-Beleg tasks/gq-chain-state.md Zeile 1288 - ein sauberer, beidseitig normaler
// Gespraechsabschluss). Bewusst ALS BENANNTE MENGE (nicht verstreut im if): weitere belegte
// "die Leitung stand"-Kennungen kommen hier dazu, nicht als zusaetzliche Bedingung irgendwo.
const LINE_WAS_UP_CAUSES = new Set(["normal_clearing"]);

// Normalisiert Telnyx' Call-Control-hangup_cause + answeredAt auf dieselbe Status-Vokabel wie
// TeXML's CallStatus. Reihenfolge ist eine Aussage:
//   1. echt beantwortet (answeredAt truthy)            -> completed, IMMER (Gegenprobe Fall 4)
//   2. kein Zeitstempel, aber ein Beleg fuer "Leitung stand" (LINE_WAS_UP_CAUSES) -> completed,
//      der Widerspruch wird NICHT zulasten des Mandanten aufgeloest (Fall 8, Blocker B)
//   3. kein Zeitstempel, bekannte Nichtannahme-Ursache -> praeziser Grund (no-answer/busy/
//      canceled, Faelle 1-3/7)
//   4. kein Zeitstempel, Ursache unbekannt/fehlt        -> ehrlicher genereller Rueckfall,
//      roher Anbieter-Token reist mit wenn vorhanden (Faelle 5/6) - "Erfinde keine" gilt fuer
//      die ZUORDNUNG (kein geratenes no-answer/busy/canceled), nicht fuer den generischen
//      Status selbst. Der defensive Passthrough in callFailureReason() oben ("unbekannter
//      Nicht-completed-Status") gibt diesen Status 1:1 als lesbaren Grund zurueck.
export function hangupCauseStatus({ answeredAt, hangupCause } = {}) {
  if (answeredAt) return COMPLETED_STATUS;
  if (LINE_WAS_UP_CAUSES.has(hangupCause)) return COMPLETED_STATUS;
  if (HANGUP_CAUSE_STATUS[hangupCause]) return HANGUP_CAUSE_STATUS[hangupCause];
  if (!hangupCause) return GENERIC_FAILURE_STATUS;
  return `${GENERIC_FAILURE_STATUS}${DETAIL_SEPARATOR}${hangupCause}`;
}
