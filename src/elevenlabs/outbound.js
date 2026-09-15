// ---- ElevenLabs-Anrufstart: der dritte Outbound-Weg ----------------------------------
// Neben TeXML und Telnyx-Call-Control fuehrt hier der Agent des ANBIETERS das Gespraech.
// Wir waehlen, wir sichern ab, wir buchen - aber wir sprechen nicht: es gibt auf diesem
// Weg weder Turn-Schleife noch Audio bei uns.
//
// WARUM KEIN PROVIDER-ADAPTER (src/telephony/adapters/*, Registry): der PROVIDER des
// Anrufs bleibt telnyx - die DID liegt dort, ElevenLabs haengt per SIP-Trunk daran. Ein
// zweiter Registry-Eintrag wuerde eine Anbieter-Wahl behaupten, die es nicht gibt (die
// Ports Signaturpruefung/SMS/Nummernkauf haetten hier kein Gegenstueck). Dies ist ein
// ENGINE-Zweig nach dem Muster von src/telnyx-origination.js.
//
// SICHERUNGEN (Absolute Regel 1): dieses Modul kennt KEIN einziges Gate und darf keins
// bekommen. Es waehlt erst, wenn die eine, unveraenderte Outbound-Gate-Kette in
// routes/api-calls.js den Anruf freigegeben hat - inklusive Kill-Switch, Verifikation
// (KYC/Abo), Kostendecke und dem Identitaets-Gate, das den Auftraggeber-Namen erzwingt
// (Traeger der Offenlegung, Artikel 50 EU AI Act). Eine zweite Formulierung derselben
// Regeln hier waere eine zweite, schwaechere Wahrheit.
//
// OFFENLEGUNG (Absolute Regel 2): der Satz ist first_message der AGENTEN-Konfiguration
// (elevenlabs/agent_configs/outbound-agent.template.json) und wird hier NICHT
// uebersteuert. Eine conversation_config_override wird vom Anbieter bei nicht
// freigeschaltetem Feld STILL ignoriert - der Satz duerfte nie daran haengen. Was unsere
// Seite liefert, ist der WERT, in den er faellt: owner_name - und der faellt NIE leer aus
// (s. dynamicVariables): eine gesetzliche Pflicht haengt nie an einer Variablen ohne
// Default.
//
// SPRACHE UND STIMME (Eigentuemer-Entscheidung 16.08.2026, Punkt 4): pro Anruf werden am
// Agenten AUSSCHLIESSLICH diese zwei Dinge gesetzt, und beide kommen aus dem DATENSATZ,
// nie vom Aufrufer - abgeleitet aus Mandant und Angerufenem (s. call-locale.js, EINE
// Aufloesung fuer beide Wege). Durchgesetzt wird das eine Ebene tiefer von der weissen
// Liste in convai.js, fail-closed vor dem einzigen Netzzugriff.
//
// ERGEBNIS: ziehend. Der Anbieter meldet das Gespraechsende nicht an uns, wir holen es ab
// (GET /v1/convai/conversations/{id}, Takt ELEVENLABS_RESULT_POLL_MS) und legen Transkript
// und Zusammenfassung an denselben Call-Record, den get_transcript ohnehin liest.
import { LOCALES, localeFor } from "../i18n/locales.js";
import { cappedEndedAtMs, carrierEndMsOf, classifyCallTime, FROM_SOURCE } from "../store/state-ops.js";
import { MAX_CALL_DURATION_CAP_S } from "../store/defaults.js";
import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";
import { BEENDE_VERSUCH, ENDE_ANKER, FRIST_ANKER, nachlaufPolitikFuer, pollDarfWirken } from "./nachlauf-politik.js";
import { findActiveNumber } from "../store/views.js";
import { POLL_TIMEOUT_REASON, pollProviderErrorReason, providerErrorReason } from "../telephony/failure-reason.js";
import { verifiedOpeningLine } from "./opening-line.js";
import { tenantToolToken } from "./tenant-tool-token.js";
import { MS_PER_SECOND, sleep } from "../utils/timer.js";
import { callLocaleFor, providerVoicemailMessage } from "./call-locale.js";
import { endConversation, fetchConversation, startOutboundCall, startResultOf } from "./convai.js";
// ST3 (O3): AUDIO_TAG wohnt seit dem Move im Heuristik-Modul (EINE Quelle fuer [el-tags]
// UND die B1-Lexemisierung, Import-Richtung nur hierher - kein Zykel); findeB1Treffer ist
// die reine B1-Heuristik (kein Store, kein Netz, s. dort).
import { AUDIO_TAG, findeB1Treffer } from "./b1-doppelankaendigung.js";
import { spokenTimezoneName } from "./nanp-area-codes.js";
import { callTimeContext } from "./time-context.js";
import { persistEndWithReason } from "../telephony/call-termination.js";
// KV2-4: die Belegzeilen dieses Gespraechs (Regelwerk und Geldpruefung liegen daneben,
// nicht hier - s. kosten-beleg.js).
import { anrufFuehrtTelnyxSip, recordElevenLabsKostenBelege } from "./kosten-beleg.js";
// OUTBOUND-E5 (F3): die reine Registrierungs-Auswahl - kein Netz, kein Store (s. dort).
import { waehleAbsenderRegistrierung, ABSENDER_QUELLE } from "../telephony/absender-registrierung.js";
import crypto from "node:crypto";

// Endzustaende des Anbieters. Alles andere gilt als LAUFEND und wird weiter abgeholt: ein
// unbekannter Status darf kein Gespraech vorzeitig fuer beendet erklaeren. Die Obergrenze
// der Abhol-Schleife ist der Max-Dauer-Cap des Aufrufers, nicht diese Liste.
const PROVIDER_DONE = "done";
const PROVIDER_FAILED = "failed";
const FINISHED_PROVIDER_STATUS = Object.freeze([PROVIDER_DONE, PROVIDER_FAILED]);

// G5: EINE Formulierung von "der Anbieter hat ein fertiges Ergebnis" fuer Poll-Takt und Beende-Pfad.
function anbieterErgebnisFertig(conversation) {
  return Boolean(conversation) && FINISHED_PROVIDER_STATUS.includes(conversation.status);
}

// Unsere Call-Endzustaende (store/state-ops.js) - bewusst benannt, weil "failed" auf
// beiden Seiten vorkommt und die beiden Vokabulare nicht dasselbe sind.
const CALL_COMPLETED = "completed";
const CALL_FAILED = "failed";

// Der EINE Anbieter-Status, bei dem das Gespraech nachweislich noch LAEUFT. GEMESSEN
// (tasks/spike1-messung.jsonl, "in-progress-felder", conv_8801kzzs612ffneskmr32gmsb33t: 60
// Abfragen im 5-Sekunden-Takt): waehrend status="in-progress" bleibt metadata.
// call_duration_secs ueber 59 Vergleiche hinweg 0 und das Transkript leer - die REST-Sicht
// ist waehrend des Gespraechs tot und wird erst beim Uebergang auf "processing" auf einen
// Schlag befuellt. Eine 0 unter DIESEM Status heisst deshalb "noch nicht bekannt", NICHT
// "niemand hat abgenommen" (s. answeredAnchorOutcome).
//
// BEWUSST EINZELN statt "alles ausser done/failed gilt als laufend": nur fuer diesen einen
// Status ist die nichtssagende 0 gemessen. Jeder andere Status behaelt sein Bestandsverhalten
// - und die sichere Seite dieser Frage ist "nicht abgenommen", nicht "laeuft noch": eine
// faelschlich als laufend gewertete Nicht-Rufannahme wuerde dem Kunden eine Klingelphase in
// Rechnung stellen, und das verbietet die Eigentuemer-Auflage ("lieber eine Minute zu wenig
// als eine erfundene"). Die Poll-Schleife (FINISHED_PROVIDER_STATUS oben) beantwortet eine
// ANDERE Frage ("weiter abholen?") und faellt deshalb auf die andere sichere Seite.
const PROVIDER_IN_PROGRESS = "in-progress";

// KS-EL1 (Owner-Entscheidung, s. Modul-Kopf): der GRUND, wenn metadata.call_duration_secs
// beim Abgleich (answeredAnchorOutcome) weder 0 noch eine positive Zahl ist (fehlt, NaN,
// negativ, falscher Typ) - additiv am Call, s. store/state-ops.js recordAnsweredUnclearReason.
const ANSWERED_UNCLEAR_REASON = "call_duration_secs_unusable";

// S1-B (unabhaengige Durchsicht 17.08.2026): "Dauer 0" ist NICHT EIN Sachverhalt, sondern
// ZWEI - und sie auf dasselbe Ergebnis fallen zu lassen war der Defekt (Repo-Lehre "nie zwei
// Sachverhalte auf ein Label"):
//   BEENDETES Gespraech, Dauer 0  -> niemand hat abgenommen. Bekannt, kein Anker.
//   LAUFENDES Gespraech, Dauer 0  -> die Dauer ist zum Lesezeitpunkt schlicht unbekannt
//                                    (gemessen, s. PROVIDER_IN_PROGRESS). Der Anker bleibt
//                                    stehen, wie er ist.
// Beide Gruende landen im selben additiven Feld (answeredUnclearReason) wie die Bestandswerte
// - unterscheidbar an ihrem Wert, sichtbar ueber GET /api/calls/{id} (store/views.js#
// publicCall streicht das Feld NICHT).
const ANSWERED_REASON_NOT_ANSWERED = "call_duration_secs_zero_not_answered";
const ANSWERED_REASON_CONVERSATION_RUNNING = "call_duration_secs_unknown_conversation_in_progress";

// OUTBOUND-E2 (Ausfall 27.08.2026): der DRITTE Sachverhalt hinter "Dauer 0". Der Anbieter
// hat uns einen FEHLER genannt - der Anruf ist nie zustande gekommen, es hat nicht bloss
// niemand abgenommen. Bis heute fielen beide auf ANSWERED_REASON_NOT_ANSWERED, und der
// Betreiber konnte seinen eigenen Konfigurationsdefekt nicht von einer Nichtannahme
// unterscheiden (genau die Vermischung, die dieser Block seit S1-B verbietet).
// WELCHER Fehler es war, sagt nicht dieses Feld, sondern call.failureReason (das EINE
// Vokabular, telephony/failure-reason.js) - hier steht nur, warum es keinen Anker gibt.
const ANSWERED_REASON_PROVIDER_REJECTED = "provider_rejected_before_answer";

// TEIL 1 (Owner-Auftrag 15.08.2026, Fortsetzung Aufgabe 2 - "der Poll unterscheidet
// dauerhaft von voruebergehend"): HTTP-Status des Ergebnisabrufs, bei denen Weiterpollen
// NIE zum Erfolg fuehren kann. GEMESSEN rein lesend gegen api.elevenlabs.io (15.08.2026,
// s. .fortschritt.md "PHASE 2 vorgearbeitet"):
//   401  unser Schluessel taugt nicht (egal ob falsch oder ganz fehlend)
//   404  das Gespraech ist beim Anbieter nicht (mehr) da - auch eine unsinnige Kennung
//        liefert 404, NICHT 422 (ein 422 auf diesem Pfad ist NICHT belegt)
// JEDER andere Status/Fehler (429/5xx/Timeout/Netzfehler, UND jeder hier nicht gemessene
// Status) bleibt VORUEBERGEHEND - fuer 429/5xx/Timeout belegt richtig, fuer alles NICHT
// Gemessene die sicherere Seite (erneut versuchen bis zur bestehenden Poll-Obergrenze)
// statt eine ungemessene Klasse zu erfinden.
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const PERMANENT_FETCH_STATUS = Object.freeze([HTTP_UNAUTHORIZED, HTTP_NOT_FOUND]);

// TEIL 2 (Owner-Auftrag 15.08.2026, Fortsetzung Aufgabe 2 - "die Wiederholung fuehrt vor
// dem Aufgeben"): DAUERHAFT (s. PERMANENT_FETCH_STATUS) gilt erst bei WIEDERHOLUNG - ein
// EINZELNER 401/404 wird wie voruebergehend behandelt und fuehrt zu einem weiteren
// Versuch, erst dieselbe Fehlerklasse MEHRFACH IN FOLGE laesst den Poll aufgeben. GRUND:
// ob es beim Anbieter ein Fenster gibt, in dem ein frisch gestartetes Gespraech per GET
// noch nicht auffindbar ist (ein 404, OBWOHL das Gespraech laeuft), ist NICHT belegt und
// wird hier auch nicht behauptet - diese Schwelle ist der Schutz gegen genau diesen
// unbelegten Fall, keine gemessene Anbieter-Zusicherung. Der Wert bleibt klein: es geht um
// den Ausschluss eines schmalen Zeitfensters (ein Rennen), nicht um Geduld mit einem
// tatsaechlich toten Gespraech - die Risiko-Asymmetrie ist eindeutig (ein paar Abfragen zu
// viel kosten Bruchteile eines Cents, ein zu frueh gekapptes Gespraech kostet den Kunden
// mitten im Satz). Die bestehende Zeit-Obergrenze (classifyCallTime, s.u.) bleibt die
// zweite, UNVERAENDERTE Bremse.
// Exportiert, damit test/el-beende-versuch.test.js (F2) die Wiederholung GEGEN diesen
// Wert bepruefen kann, statt eine zweite, driftfaehige Kopie der Zahl im Test zu tippen
// (G25/G22): "erst nach N Versuchen, nicht beim ersten" ist nur dann eine echte
// Zusicherung, wenn N aus derselben Quelle kommt wie die Produktionslogik.
export const PERMANENT_ERROR_STREAK_LIMIT = 3;

// Der GRUND, wenn der Poll wegen eines DAUERHAFTEN Anbieter-Fehlers aufgibt - derselbe
// Mechanismus wie ANSWERED_UNCLEAR_REASON oben (recordAnsweredUnclearReason, existiert
// bereits), ein EIGENER Wert: dort ist der Anbieter erreichbar, liefert aber ein
// unbrauchbares call_duration_secs; hier ist der Anbieter fuer diesen Call gar nicht mehr
// (401) oder nicht mehr auffindbar (404) erreichbar - zwei verschiedene Gruende, im
// Store/Log unterscheidbar.
const ANSWERED_UNCLEAR_REASON_PERMANENT_ERROR = "poll_permanent_provider_error";

// Owner-Auftrag 15.08.2026 (cancel_call darf nicht luegen): der Beende-Versuch
// (convai.js#endConversation, DELETE) ist NICHT belegt, die Leitung beim Anbieter
// tatsaechlich zu kappen - der EINZIGE verlaessliche Deckel bleibt der ANBIETER SELBST:
// max_duration_seconds, besessen in elevenlabs/agent_configs/outbound-agent.template.json
// (live 600s seit 2026-08-15, s. dortiger _notbremse_hinweis). GENANNTER Wert statt
// gelesener Datei: die Vorlage bleibt in dieser Sitzung unangetastet (Auftragsgrenze) -
// dieser Wert BEWACHT sie, aendert sie nicht (Bewachung statt Korrektur, gleiches Muster
// wie prompt.timezone). Exportiert fuer die ehrliche cancel_call-Antwort (routes/
// api-calls.js), damit N dort KEINE Magic Number ist.
export const ELEVENLABS_PROVIDER_MAX_DURATION_S = 600;

// IEL-B4 (E7c): wie lange der Poll eines ueberbrueckten Inbound-Calls nach dem
// Carrier-Ende (elNachlaufStartedAt) auf das Anbieter-Ergebnis wartet. STARTWERT, NICHT
// GEMESSEN: die Verarbeitungsdauer nach Verbindungsende ist nicht aufgezeichnet
// (spike1-messung belegt nur den Uebergang auf "processing"). Gleich dem besessenen
// Anbieter-Deckel, weil (1) die Frist nie gebucht wird (Ende-Anker = Carrier-Ende, E17) -
// ein zu langer Wert kostet kein Geld, (2) ein zu kurzer Transkript, Zusammenfassung und
// Inbox-Eintrag verliert. Obergrenze fuer den Datensatz bleibt der Max-Dauer-Cap.
export const INBOUND_NACHLAUF_FRIST_MS = ELEVENLABS_PROVIDER_MAX_DURATION_S * MS_PER_SECOND;

// E18(1): Ausgang eines Poll-Takts, der einen Folgetakt geplant hat - jeder andere Ausgang
// traegt den Call aus dem Register laufendeInboundPolls aus.
const FOLGETAKT_GEPLANT = Symbol("folgetakt-geplant");

// S1-A (unabhaengige Durchsicht 17.08.2026): auf DIESEM Weg ist der Anbieter-Deckel eine
// HARTE OBERGRENZE, kein Default. classifyCallTime/cappedEndedAtMs rechnen eine Ebene
// tiefer (call.maxDurationS || defaultMaxDurationS) - der hereingereichte Deckel wirkt dort
// also NUR fuer Anrufe OHNE eigene Frist, und die gibt es hier nicht: routes/api-calls.js
// setzt maxDurationS bei JEDEM Anruf (an einem echten Anruf vom 17.08.2026 gemessen: 1800).
// AUSFALLWEG ohne diese Kappung: der Anbieter legt bei 600 s auf, unser Ergebnisabruf
// liefert dauerhaft 5xx - der Poll laeuft bis 1800 s, cappedEndedAtMs stempelt
// endedAt = answeredAt + 1800 s, und voiceMinutesOf (billing/metering.js) bucht 30 statt 10
// Minuten; bei 30 ct/min 9,00 statt 3,00 EUR, jedes Mal. Die wirksame Grenze ist deshalb das
// MINIMUM aus der anrufeigenen Frist und dem Anbieter-Deckel.
//
// WARUM EINE KOPIE DES DATENSATZES und nicht ein Eingriff in callLimitMs/classifyCallTime/
// cappedEndedAtMs: die drei sind mit dem TELNYX-Weg geteilt (telephony/call-lifecycle.js,
// telephony/reattach.js, routes/voice.js), und dort ist "call-eigene Frist schlaegt Default"
// RICHTIG - dort gibt es keinen fremden Deckel, der frueher bindet. Die Kappung bleibt
// deshalb hier, wo der Anbieter-Deckel besessen ist; die geteilten Funktionen bleiben
// unangetastet (sie LESEN den Datensatz nur, sie mutieren ihn nicht - die Kopie ist
// gefahrlos und verlaesst diese Datei nicht).
function callUnderProviderCap(call) {
  const eigeneFrist = call.maxDurationS || ELEVENLABS_PROVIDER_MAX_DURATION_S;
  return { ...call, maxDurationS: Math.min(eigeneFrist, ELEVENLABS_PROVIDER_MAX_DURATION_S) };
}

// S1-3 (Owner-Auftrag 15.08.2026, "der Notaus haengt zwei Minuten"): eigene, KURZE Frist
// fuer BEIDE Anbieter-Aufrufe des ABBRUCH-Pfades (endActiveCall, s.u.) - dem Max-Dauer-Cap
// UND cancel_call. terminateAndBillCall WARTET synchron auf sie (die Reihenfolge
// Abruf-vor-Loeschversuch bleibt, sie rettet Transkript und Buchungsanker); ohne eigene
// Frist blockiert ein stummer Anbieter Kappung UND cancel_call ueber das volle
// convai.js#REQUEST_TIMEOUT_MS (120000ms - bemessen fuer die SIP-Klingelphase des
// AnrufSTARTS, nicht fuer einen Metadaten-GET oder einen DELETE) und verzoegert die Buchung
// sowie den einzigen Leitungs-Stopp-Versuch um dieselbe Zeit. 10000ms sind ein Zehntel des
// Bestandswerts: grosszuegig genug fuer eine normale Anbieter-Antwort (im Alltag
// Millisekunden, kein SIP-Warten), kurz genug, dass ein stummer Anbieter Kappung/
// cancel_call hoechstens 10s statt 2 Minuten haelt.
//
// S1-C (unabhaengige Durchsicht 17.08.2026): der Name sagt PROVIDER, nicht RESULT_FETCH,
// weil die Frist seither BEIDE Aufrufe deckt. Vorher galt sie nur fuer den GET - der
// awaitete DELETE dahinter lief weiter in die 120 s, und der Abbruch konnte damit 130
// Sekunden haengen, waehrend der Kommentar hier "hoechstens 10 s" versprach. Der
// Loeschversuch (endConversation) laeuft weiterhin IN JEDEM FALL, auch wenn die Frist des
// Ergebnisabrufs ablaeuft (fetchConversationSoft faengt den Abbruch fail-soft ab, s. dort).
export const EL_ABORT_PROVIDER_TIMEOUT_MS = 10000;

// IEL-B5 (E10): Ergebnis-Abrufe des Beende-Pfads (Cap, Geld-Wache, cancel_call) eines
// ueberbrueckten Inbound-Calls NACH dem Auflegen des Elternbeins. STARTWERT, NICHT GEMESSEN
// (wie INBOUND_NACHLAUF_FRIST_MS): die Verarbeitungsdauer nach Verbindungsende ist nicht
// aufgezeichnet. Wartezeit hoechstens Versuche x EL_ABORT_PROVIDER_TIMEOUT_MS + (Versuche - 1)
// x resultPollMs; die Leitung ist dann schon aufgelegt - das Warten verzoegert nur Buchung und
// cancel_call-Antwort, nie die Kappung. Exportiert fuer den Test (G22).
export const EL_TERMINATION_RESULT_ATTEMPTS = 3;

// Rollen: der Anbieter kennt "agent" und "user", unser Transkript "agent" und "caller".
// Alles, was nicht der Agent ist, ist die Gegenstelle - ein unbekannter Rollenname darf
// keine Zeile verschlucken.
const AGENT_ROLE = "agent";
const CALLER_ROLE = "caller";

// Anbieter-Befund call_successful ("success" | "failure" | "unknown") auf unsere Achse.
// Alles Unbekannte -> "unclear", derselbe Sentinel wie im LLM-Weg (mcp-tools.js).
const OBJECTIVE_ACHIEVED_BY_PROVIDER = Object.freeze({ success: true, failure: false });
const OBJECTIVE_ACHIEVED_UNKNOWN = "unclear";

// ABNAHME-D1 (Owner-Auftrag: eigene Felder im Ergebnisschema plus ein Prompt, der sie
// anfordert): die Data-Collection-Feld-Kennungen des Agenten (elevenlabs/agent_configs/
// outbound-agent.template.json, platform_settings.data_collection) - GENAU diese fuenf
// Schluessel liest dieser Weg aus analysis.data_collection_results. Modul-Konstanten
// (G25), damit Feld-Kennung (dort deklariert) und Lesestelle (hier) nie auseinanderlaufen.
const DATA_COLLECTION_ID = Object.freeze({
  APPOINTMENT_DATE: "appointment_date",
  APPOINTMENT_TIME: "appointment_time",
  AMOUNT: "amount",
  CURRENCY: "currency",
  // TEIL 3 derselben Auflage: NUR befuellt, wenn der Agent laut Prompt tatsaechlich eine
  // Bestaetigung des Angerufenen bekommen hat (s. die Feld-Beschreibung in der Vorlage) -
  // eine aus der Vorwahl abgeleitete Hypothese erreicht diese Kennung nie.
  CONFIRMED_TIMEZONE: "confirmed_timezone",
  // Der im Gespraech vereinbarte naechste Schritt. Die Kennung ist in der Vorlage seit
  // jeher deklariert, hatte aber bis heute KEINEN Leser (s. persistNextStep unten).
  NEXT_STEPS: "next_steps",
});

// Der Typ, unter dem ein Action Item am Store liegt (store/state-ops.js: actionItems[].type).
// "appointment" liest list_action_items (mcp-tools.js, Termin-Praefix) seit jeher - einen
// SCHREIBER bekam der Wert erst mit persistNextStep unten.
const ACTION_ITEM_TYPE = Object.freeze({ TODO: "todo", APPOINTMENT: "appointment" });

// Herkunfts-Kennung fuer TEIL 3 (recordCalleeConfirmedTimezone, store/state-ops.js): der
// EINZIGE heutige Erzeuger eines bestaetigten Zonenwerts ist dieser Weg. Ein eigener
// Bezeichner statt eines blossen true/false, weil ein spaeterer zweiter Erzeuger (z.B.
// eine Bestaetigung ueber SMS) denselben Wert mit ANDERER Herkunft schreiben koennte -
// "ueberschreibbar" (Eigentuemer-Auflage) ist nur nachvollziehbar, wenn die Herkunft
// mitreist statt zu raten, WELCHER Weg zuletzt geschrieben hat.
export const CALLEE_TIMEZONE_ORIGIN_ELEVENLABS = "elevenlabs_data_collection";

// Liest EINEN Data-Collection-Wert aus der Anbieter-Antwort (ABNAHME-D1). FEHLT die
// Angabe (kein Termin/Betrag im Gespraech verhandelt, der Normalfall - s. der
// Feld-Default-Kommentar in store/state-ops.js) oder ist sie eine leere Zeichenkette,
// liefert diese Funktion null - kein Platzhalter, kein Fehler, kein Log (die
// Owner-Auflage nennt das ausdruecklich den Normalfall, kein Fehlerfall). Der Wert
// reist als STRING weiter, auch wenn der Anbieter eine Zahl liefert (Feld "amount" ist am
// Agenten als type:"number" deklariert, s. Vorlage): Praezedenz answeredUnclearReason
// (state-ops.js) ist eine TEXT-Spalte auf BEIDEN Backends - ein zweiter Zahlentyp koennte
// zwischen json.js (haelt den rohen JS-Wert) und pg.js (NUMERIC kaeme als String vom
// Treiber zurueck, s. hydratedMicroCents-Praezedenz) auseinanderlaufen.
function collectedValue(dataCollectionResults, id) {
  const value = dataCollectionResults?.[id]?.value;
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

// Alle fuenf Angaben in EINEM Schritt aus derselben Anbieter-Antwort (G5, Praezedenz
// objectiveAchievedOf/endStatusOf daneben: reine Ableitung ohne Store-Zugriff, P5/P6).
// confirmedTimezone ist bewusst NICHT Teil des appointment/amount-Bloecks: TEIL 2 und
// TEIL 3 landen an ZWEI verschiedenen Store-Mutatoren (recordProviderCollectedFields vs.
// recordCalleeConfirmedTimezone), weil TEIL 3 zusaetzlich Herkunft+Zeitstempel braucht
// und ueberschreibbar sein muss, waehrend TEIL 2 dem einfacheren, nicht-set-once-
// Praezedenzfall von recordProviderCallResult folgt.
// Exportiert (wie answeredAnchorOutcome daneben): reine Ableitung ohne Store-Zugriff,
// ohne Store/Netz direkt testbar.
export function collectedFieldsOf(conversation) {
  const results = conversation.analysis?.data_collection_results;
  return {
    appointmentDate: collectedValue(results, DATA_COLLECTION_ID.APPOINTMENT_DATE),
    appointmentTime: collectedValue(results, DATA_COLLECTION_ID.APPOINTMENT_TIME),
    amount: collectedValue(results, DATA_COLLECTION_ID.AMOUNT),
    currency: collectedValue(results, DATA_COLLECTION_ID.CURRENCY),
    confirmedTimezone: collectedValue(results, DATA_COLLECTION_ID.CONFIRMED_TIMEZONE),
  };
}

// MODUL-EBENE aus demselben Grund wie finishWithoutProviderResult/fetchConversationOutcome
// weiter unten (G30, haelt makeElevenLabsOutbound unter der Zeilengrenze). Additiv NEBEN
// Transkript und Zusammenfassung (persistProviderResult ruft diese Funktion NACH
// store.recordProviderCallResult auf, aendert dort nichts). TEIL 2
// (appointmentDate/appointmentTime/amount/currency) wird IMMER geschrieben (die vier
// bleiben null, wenn das Gespraech die jeweilige Angabe nicht hergab - der Normalfall).
// TEIL 3 (die bestaetigte Zeitzone) wird NUR geschrieben, wenn tatsaechlich ein
// bestaetigter Wert vorliegt - "nur bestaetigte Werte werden gespeichert" ist die
// Owner-Auflage, hier am Aufruf selbst durchgesetzt statt dem Store-Mutator ueberlassen.
// IEL-B4 (E6): fuer einen ueberbrueckten Inbound-Call entsteht KEIN next_steps-Item -
// summarizeCall schreibt die Items auf dem EL-Transkript (Sprache, allowSummaries).
function persistCollectedFields({ store, callId, conversation, politik }) {
  const collected = collectedFieldsOf(conversation);
  store.recordProviderCollectedFields(callId, collected);
  if (collected.confirmedTimezone) {
    store.recordCalleeConfirmedTimezone(callId, {
      timezone: collected.confirmedTimezone,
      origin: CALLEE_TIMEZONE_ORIGIN_ELEVENLABS,
      confirmedAt: new Date().toISOString(),
    });
  }
  const nextStep = politik.naechsteSchritteAlsAufgabe ? nextStepActionItemOf(conversation, collected) : null;
  if (nextStep) store.addActionItem(callId, nextStep.text, nextStep.type);
}

// Der im Gespraech vereinbarte NAECHSTE SCHRITT, als Action Item am Store.
//
// WARUM ES DAS BRAUCHT: die Feld-Kennung "next_steps" ist am Agenten seit jeher
// deklariert (elevenlabs/agent_configs/outbound-agent.template.json, platform_settings.
// data_collection: "A short summary of the next steps agreed at the end of the call"),
// wurde vom Anbieter also bei jedem Gespraech mitgeliefert - und von KEINEM Leser
// abgeholt. Dieser Weg schrieb deshalb ueberhaupt kein Action Item, waehrend der
// Bestandsweg welche schreibt (claude.js: die Zusammenfassung ruft store.addActionItem).
// Folge auf dem NEUEN Hauptweg: list_action_items (mcp-tools.js) blieb dauerhaft leer,
// egal was im Gespraech vereinbart wurde.
//
// DERSELBE MUTATOR WIE IM BESTANDSWEG (store.addActionItem), bewusst kein zweiter
// Schreibweg: so gilt hier dieselbe Entdopplung inhaltsgleicher Eintraege (GQ-P4) und
// derselbe Weg an den Auftraggeber. Ein zweiter Poll-Takt oder ein Beende-Versuch nach
// bereits geholtem Ergebnis (endActiveCall ruft persistProviderResult ebenfalls) legt
// deshalb KEIN zweites Item an.
//
// NICHTS ERFUNDEN: hat das Gespraech keinen naechsten Schritt hergeben, entsteht kein
// Eintrag - derselbe Normalfall wie bei den fuenf Angaben oben.
//
// DER TYP KOMMT AUS DEMSELBEN GESPRAECH: hat es einen Termin hergegeben (Datum oder
// Uhrzeit), ist der naechste Schritt ein Termin, sonst eine Aufgabe. Damit bekommt
// ACTION_ITEM_TYPE.APPOINTMENT seinen ersten Schreiber ueberhaupt - gelesen wird der Wert
// seit jeher (mcp-tools.js praefixt solche Zeilen mit dem Termin-Praefix).
//
// REINE ABLEITUNG ohne Store-Zugriff (P5, Praezedenz collectedFieldsOf/answeredAnchorOutcome
// daneben): sie ENTSCHEIDET nur, der EINE Aufrufer oben schreibt. `collected` reist als
// Argument statt hier ein zweites Mal abgeleitet zu werden (G5) - es ist dieselbe
// Anbieter-Antwort, die der Aufrufer bereits ausgewertet hat.
function nextStepActionItemOf(conversation, collected) {
  const text = collectedValue(
    conversation.analysis?.data_collection_results,
    DATA_COLLECTION_ID.NEXT_STEPS,
  );
  if (!text) return null;
  const istTermin = Boolean(collected.appointmentDate || collected.appointmentTime);
  return { text, type: istTermin ? ACTION_ITEM_TYPE.APPOINTMENT : ACTION_ITEM_TYPE.TODO };
}

// Die Beschriftungen, mit denen Verbote und Hintergrund beim Agenten ankommen, kommen aus
// dem ENGLISCHEN Prompt-Baustein des Bestandswegs - derselbe, den src/claude.js ueber
// loc.prompt liest. ENGLISCH BLEIBT HIER RICHTIG, auch seit der Anruf seine Sprache waehlt
// (s. call-locale.js): diese Texte werden nicht GESPROCHEN, sie instruieren das Modell -
// genau wie der System-Prompt des Agenten, der aus demselben Grund englisch bleibt
// (Begruendung in der Vorlage, _prompt_grundlage_hinweis). Gesprochen und deshalb
// sprachabhaengig ist allein die Offenlegung. Ein zweiter, hier neu getippter Satz
// Beschriftungen waere eine zweite Wahrheit (G5).
const EN_PROMPT = LOCALES.en.prompt;

// Trennzeichen der Fakten-Liste - identisch zum Bestandsweg (src/claude.js,
// HINTERGRUND-Sektion), damit derselbe Kontext auf beiden Wegen gleich aussieht.
const KEY_FACT_SEPARATOR = "; ";

// Der Vorrang-Satz, woertlich aus dem Bestand. Dort haengt er als Anhaengsel an den
// Spielraum-Regeln und traegt darum ein fuehrendes Leerzeichen (src/claude.js:268); hier
// beginnt er eine eigene Zeile, deshalb getrimmt - der Wortlaut bleibt unangetastet.
const CONSTRAINTS_PRECEDENCE = EN_PROMPT.mandate.constraintsPrecedence.trim();

// Der Bestand setzt Beschriftung und Briefing mit EINEM Leerzeichen zusammen
// (src/claude.js assignmentBlock); die HINTERGRUND-Beschriftungen tragen ihren Abstand
// dagegen schon im Baustein. Deshalb hier einmal angeklebt statt in contextLine.
const BRIEFING_LABEL = `${EN_PROMPT.briefingLabel} `;

// Im Bestand stehen die GRENZEN als Aufzaehlung, auf diesem Weg steht die Buchungs-Grenze
// in Prosa - der Listenstrich faellt weg, der Satz bleibt unangetastet.
const LIST_DASH = /^-\s+/;

// Jeder Wert geht als getrimmter String raus, nie als undefined/null: fehlt dem Anbieter
// eine Variable, die seine Agenten-Vorlage referenziert, bricht er das Gespraech stumm ab
// (WebSocket-Close 1008), bevor ein Wort gesprochen ist. Zugleich DIE Leer-Pruefung der
// Bausteine unten: getrimmt wird VOR dem Ankleben einer Beschriftung, sonst ergibt ein
// blanker Wert genau die nackte Ueberschrift ("CONSTRAINTS:"), die es zu vermeiden gilt.
const alsText = (wert) => (typeof wert === "string" ? wert.trim() : "");

// IEL-B6 (E12): EIN Auftraggeber-Ausdruck fuer beide Richtungen - der Name, sonst der
// Fallback der Sprache des Satzes, in den er faellt.
export function auftraggeberAusdruck(ownerName, locale) {
  return alsText(ownerName) || locale.disclosureOwnerFallback;
}

const roleOf = (role) => (role === AGENT_ROLE ? AGENT_ROLE : CALLER_ROLE);

const endStatusOf = (conversation) =>
  conversation.status === PROVIDER_DONE ? CALL_COMPLETED : CALL_FAILED;

const objectiveAchievedOf = (conversation) =>
  OBJECTIVE_ACHIEVED_BY_PROVIDER[conversation.analysis?.call_successful] ??
  OBJECTIVE_ACHIEVED_UNKNOWN;

// IEL-B4 (E6): leer fuer Inbound-EL -> finishCall laeuft in summarizeCall (unser LLM, Anrufsprache).
const providerSummaryOf = (conversation, politik) =>
  politik.anbieterZusammenfassung ? conversation.analysis?.transcript_summary || null : null;

// KS-EL1 (Owner-Entscheidung, s. Modul-Kopf): WAS aus dem Buchungsanker werden soll, reine
// Entscheidung OHNE Store-Mutation (P5/P6) - exportiert, weil sie ohne Store/Netz testbar
// ist. answeredAt traegt heute ZWEI Sachverhalte auf EINEM Feld: "die Verbindung steht"
// (markAnswered am Anrufstart, gelesen von isInCallConsult/mapStatus - bleibt UNVERAENDERT
// stehen) und "ab hier wird bezahlt" (voiceMinutesOf). Diese Funktion liefert den Wert fuer
// den ZWEITEN Sachverhalt, gezogen aus der Anbieter-Wahrheit metadata.call_duration_secs:
// der Wert ist 0, WAEHREND status=in-progress, und wird erst beim Uebergang auf
// processing/done befuellt (tasks/spike1-messung.jsonl:12).
//
// EHRLICHKEIT: OB dieser Wert ab der Rufannahme misst oder die Klingelphase (SIP-Ringing)
// einschliesst, ist NICHT belegt - der Anbieter dokumentiert die Zaehlgrenze nicht. Diese
// Ableitung geht darum vom GUENSTIGEREN Fall aus (Rufannahme bis Ende) - das ist eine
// ANNAHME, keine belegte Tatsache; ein echter Anruf mit bekannter Klingeldauer misst das
// demnaechst nach.
//
//   positiv (>0)        -> answeredAtIso = endedAt minus Dauer. voiceMinutesOf (billing/
//                           metering.js) rundet danach exakt ceil(Dauer/60) - die Minuten
//                           des Anbieters, OHNE dass diese Funktion voiceMinutesOf kennt
//                           oder anfasst.
//   0, Gespraech vorbei  -> NIEMAND hat abgenommen: Anker weg. Bekannt, nicht unklar - aber
//                           seit S1-B mit GRUND und Log, weil auch dieser Fall NICHT bucht
//                           und ein nicht buchender Anruf nie still bleiben darf.
//                           Lieber eine Minute zu wenig als eine erfundene.
//   0, Gespraech laeuft  -> die Dauer ist zum Lesezeitpunkt unbekannt (gemessen, s.
//                           PROVIDER_IN_PROGRESS) - der bestehende Anker BLEIBT UNANGETASTET
//                           (keepExistingAnchor). S1-B: ein cancel_call nach vier Minuten
//                           Gespraech loeschte hier bisher den Buchungsanker und buchte 0
//                           Minuten, waehrend wir Anbieter und Carrier voll zahlen - und der
//                           Beleg war 0,3 s spaeter beim Anbieter geloescht (DELETE). Es
//                           wird KEINE Dauer erfunden: stehen bleibt allein der eigene
//                           Verbindungsstempel (markAnswered), derselbe Anker, mit dem jeder
//                           Telnyx-Anruf abgerechnet wird.
//   fehlend/unbrauchbar  -> kein Anker, PLUS der Grund (ANSWERED_UNCLEAR_REASON): anders
//                           als bei 0 steht hier NICHT fest, ob abgenommen wurde. S2
//                           (Owner-Auftrag 15.08.2026): "unbrauchbar" deckt NICHT nur
//                           durationSecs, sondern auch endedAtIso selbst - store.
//                           endCallRecord kann null liefern (Call zwischen Pruefung und
//                           diesem Aufruf verschwunden), Date.parse(undefined) waere NaN
//                           und liesse new Date(NaN).toISOString() WERFEN, mitten im
//                           Buchungspfad. Die Fail-Soft-Zusage des Moduls deckt bisher nur
//                           den Netzabruf (s. Modul-Kopf), NICHT diese reine Ableitung -
//                           deshalb beide Werte gemeinsam auf Brauchbarkeit geprueft.
//
// Die drei Ausgaenge bekommen je einen eigenen Erzeuger (statt dreimal dasselbe
// Objektliteral): die Form steht damit an EINER Stelle, und jeder Ausgang traegt einen
// Namen, statt am Leser als Feld-Kombination haengen zu bleiben (G5/G16).
const anchorFromProviderDuration = (answeredAtIso) => ({
  answeredAtIso,
  unclearReason: null,
  keepExistingAnchor: false,
});
const clearAnchor = (unclearReason) => ({ answeredAtIso: null, unclearReason, keepExistingAnchor: false });
const keepAnchor = (unclearReason) => ({ answeredAtIso: null, unclearReason, keepExistingAnchor: true });

// OUTBOUND-E2 (Lint-Rueckfall): ausgelagert, damit answeredAnchorOutcome unter der
// Komplexitaetsgrenze bleibt - das zusaetzliche if fuer den Anbieterfehler (s.u.) kam dazu.
// Rein, ohne Nebeneffekt.
function usableProviderDuration(durationSecs, endedAtMs) {
  const durationUsable =
    typeof durationSecs === "number" && Number.isFinite(durationSecs) && durationSecs > 0;
  return durationUsable && Number.isFinite(endedAtMs);
}

export function answeredAnchorOutcome(endedAtIso, conversation) {
  const metadata = conversation?.metadata;
  const durationSecs = metadata?.call_duration_secs;
  const endedAtMs = Date.parse(endedAtIso); // NaN bei fehlendem/kaputtem endedAtIso (S2)
  if (usableProviderDuration(durationSecs, endedAtMs))
    return anchorFromProviderDuration(new Date(endedAtMs - durationSecs * MS_PER_SECOND).toISOString());
  // Reihenfolge bindend: ERST fragen, ob das Gespraech ueberhaupt schon vorbei ist. Eine
  // brauchbare Dauer (oben) schlaegt die Frage, alles darunter haengt an ihr.
  if (conversation?.status === PROVIDER_IN_PROGRESS) return keepAnchor(ANSWERED_REASON_CONVERSATION_RUNNING);
  // OUTBOUND-E2, GELD-INVARIANTE: DIESE Frage steht ZWISCHEN dem Laeuft-noch-Zweig und der
  // Dauer-0-Frage - NIE weiter oben. Zoege man sie an den Anfang, verloere JEDE Konversation
  // mit metadata.error ihren Buchungsanker, auch die 90 Sekunden lange, die am Ende einen
  // Anbieterfehler meldet: answeredAt=null -> voiceMinutesOf bucht 0 -> wir zahlen den
  // Carrier und kassieren nichts (PM-14). Hier unten gilt sie nur noch fuer Anrufe OHNE
  // brauchbare Anbieter-Dauer - und dort ist ein gemeldeter Fehler der staerkere Beleg als
  // "Dauer 0" oder "Dauer unbrauchbar".
  if (metadata?.error) return clearAnchor(ANSWERED_REASON_PROVIDER_REJECTED);
  if (durationSecs === 0) return clearAnchor(ANSWERED_REASON_NOT_ANSWERED);
  return clearAnchor(ANSWERED_UNCLEAR_REASON);
}

// OUTBOUND-E2: OB ein Anbieterfehler ein Fehlergrund AM CALL wird, haengt an genau
// derselben Entscheidung wie der Buchungsanker - eine zweite Stelle koennte auseinander
// laufen und Label und Geld widersprechen lassen. Regel: nur wenn aus der Anbieter-Dauer
// KEIN Buchungsanker geworden ist. Ein 42-Sekunden-Gespraech, das am Ende einen Fehler
// meldet, ist zustande gekommen und wird bezahlt - es traegt keinen "nie zustande
// gekommen"-Grund. WAS der Fehler bedeutet, entscheidet das EINE Vokabular
// (telephony/failure-reason.js), nicht diese Datei.
const providerErrorReasonFor = (anchor, conversation) =>
  anchor.answeredAtIso || anchor.keepExistingAnchor ? null : providerErrorReason(conversation?.metadata?.error);

// Nur Zeilen mit gesprochenem Inhalt: der Anbieter fuehrt auch Werkzeug-Ereignisse im
// transcript, die kein message-Feld tragen.
const spokenLines = (conversation) =>
  (conversation.transcript || []).filter((zeile) => zeile && zeile.message);

// BEFUND 3 (Anruf 6, 18.08.2026): der Agent sprach woertlich "[Curious] Interessant, das
// koennte wichtig sein." Ursache war ein Widerspruch in der Konfiguration -
// tts.suggested_audio_tags schlug dem Modell zehn solcher Marken vor, waehrend der Prompt
// sie verbot. Beide Quellen sind seither zu (Vorlage), und genau deshalb gibt es diese
// Pruefung: eine Konfiguration, die im Dashboard oder beim naechsten Anlegen des Agenten
// zurueckfaellt, wuerde sonst still wieder Marken sprechen.
//
// WARUM MELDEN UND NICHT ENTFERNEN: das Transkript ist der Nachweis nach Artikel 50 EU AI
// Act. Was gesprochen wurde, gehoert hinein - auch das Falsche. Stilles Strippen machte
// aus dem Nachweis eine Schoenschrift und verstecket zugleich den Konfigurationsfehler.
//
// NUR AGENTEN-ZEILEN: Klammern in einer Anrufer-Zeile kaemen aus der Spracherkennung und
// sagen nichts ueber unsere Konfiguration.
//
// WAS GELOGGT WIRD: die Anzahl und die gefundenen Marken selbst. Sie sind KEIN
// Gespraechsinhalt, sondern die Eigenproduktion des Modells - und ohne sie waere die
// Meldung fuer die Diagnose wertlos (welche Marke leckt, entscheidet, welche Quelle offen
// steht). Der Rest der Zeile bleibt draussen (Absolute Regel 4).
//
// VORFALL 2026-09-02 (tasks/PLAN-AGENTEN-STIMME.md, ST3/O3): der Agent sprach
// "[froehlich]" woertlich - die zweite DE-Marke nach dem 18.08.-Fix ([Curious]-Serie,
// Konfig-Ursache) und nach "[freundlich]" (19.08., damals bewusst zurueckgestellt).
// Diesmal KEINE offene Quelle: suggested_audio_tags ist leer, die Soft-Timeout-Texte
// sind klammerfrei - B2 ist Adhaeren-Luecke des Modells, keine Konfig. Im selben
// Vorfall zeigte sich B1: der Agent kuendigte den Inhalt an und kuendigte ihn ein
// zweites Mal an, bevor er ihn lieferte - dafuer gibt es seit ST3 den zweiten
// Detektor daneben (reportDoubleAnnouncements, Heuristik in b1-doppelankaendigung.js)
// und das diagnostische Zaehlfeld am Call-Datensatz (recordElDetectorCounts,
// Owner-Entscheidung 6): MELDEN, NICHT ENTFERNEN gilt fuer beide - das Transkript
// bleibt unveraendert (Art. 50).
function reportAudioTags(callId, lines) {
  const marken = lines
    .filter((zeile) => roleOf(zeile.role) === AGENT_ROLE)
    .flatMap((zeile) => zeile.message.match(AUDIO_TAG) ?? []);
  if (marken.length === 0) return marken;
  console.error(
    `[el-tags] call=${callId} treffer=${marken.length} marken=${[...new Set(marken)].join(",")} - ` +
      "der Agent hat Klammerausdruecke GESPROCHEN. Quellen pruefen: tts.suggested_audio_tags " +
      "und turn.soft_timeout_config am Agenten.",
  );
  return marken;
}

// ST3 (O3, NUR Diagnose): B1 - der Agent kuendigt denselben Inhalt an und kuendigt ihn
// erneut an, bevor er ihn liefert (Vorfall 2026-09-02, s. Kommentarblock oben). Dieselbe
// Disziplin wie [el-tags]: NUR Agent-Zeilen, NUR MELDEN - keine Transkript-Aenderung.
//
// WAS GELOGGT WIRD (Pre-Mortem R8): Trefferzahl, Leit-Cues und Zeilenindizes - KEINE
// Vollsaetze. Die Cues sind Einzelwoerter aus den geschlossenen Listen der Heuristik,
// die Zeilenindizes beziehen sich auf die Liste gesprochener Zeilen, die
// persistProviderResult sieht. Heuristik MIT dokumentierter False-Positive-Toleranz
// (Owner-Entscheidung 5): Feuert [el-b1] dauernd, ist das Rauschen sicht- und zaehlbar
// (Zaehlfeld), und die Detailligung wird duenner gezogen - NIE abgestellt.
function reportDoubleAnnouncements(callId, lines) {
  const treffer = findeB1Treffer(lines);
  if (treffer.length === 0) return treffer;
  const cues = treffer.map((einTreffer) => einTreffer.cues.join("+")).join(",");
  const zeilen = [...new Set(treffer.map((einTreffer) => einTreffer.zeile))].join(",");
  console.error(
    `[el-b1] call=${callId} treffer=${treffer.length} cues=${cues} zeilen=${zeilen} - ` +
      "der Agent hat denselben Inhalt doppelt angekuendigt (B1). Heuristik, NUR Diagnose.",
  );
  return treffer;
}

// Die Buchungs-Grenze des Agenten - die WIRKUNG des Mandats, nicht sein Wortlaut. Der
// Bestand tauscht sie pro Anruf (src/claude.js:210: mandateScopeGiven ->
// boundaries.noBookingWithMandate, sonst boundaries.noBooking). Ein statischer
// Prompt-Satz kann das nicht: er sagte dem Agenten neben seinem Mandat die Regel des
// mandatlosen Falls zu ("nimm den Terminwunsch als Nachricht auf"), und welcher der
// beiden Saetze im Konflikt gewinnt, entschiede der Anruf. Sie reist deshalb IM WERT,
// wie Verbote und Hintergrund auch.
const bookingBoundary = (spielraumGegeben) =>
  (spielraumGegeben
    ? EN_PROMPT.boundaries.noBookingWithMandate
    : EN_PROMPT.boundaries.noBooking
  ).replace(LIST_DASH, "");

// Der Spielraum in den Worten des Auftraggebers, gefolgt von der Buchungs-Grenze, die er
// stellt. Die Enum-Achse on_out_of_scope hat auf diesem Weg noch keinen Platz (die Vorlage
// kennt genau EINEN {{mandate}}-Slot) - eine bewusste Luecke des Anrufstarts, kein
// Datenverlust: das Mandat bleibt vollstaendig am Call-Record.
//
// Die Weiche haengt am SPIELRAUM ALLEIN, nicht am Vorhandensein eines Mandats: eine blosse
// Ausweich-Reihenfolge ermaechtigt zu nichts (dieselbe Bedingung wie mandateScopeGiven,
// src/claude.js:97). Der Wert ist damit NIE leer - die Grenze gilt in beiden Lagen.
function mandateText(mandate) {
  const spielraum = alsText(mandate?.decide_freely);
  const rahmen = [spielraum, alsText(mandate?.fallback_order)].filter(Boolean).join(" ");
  const grenze = bookingBoundary(Boolean(spielraum));
  return rahmen ? `${rahmen}\n${grenze}` : grenze;
}

// Die harten Verbote - die OBERGRENZE des Mandats. Ohne sie wird aus "entscheide frei, aber
// hoechstens 40 Euro" am Anbieter "entscheide frei": kein halbes Mandat, sondern ein
// weitergehendes.
//
// Beschriftung, Vorrang-Satz UND der fuehrende Zeilenumbruch reisen MIT dem Wert und
// stehen NICHT im Prompt der Vorlage: der ist EIN statischer Text und kann keinen Block
// weglassen. Der Bestand laesst beides weg, sobald es keine Verbote gibt (src/claude.js:
// die constraints-Zeile in assignmentBlock und der Vorrang-Satz in mandateSection rendern
// nur bei gesetztem call.constraints) - statisch verspraeche der Prompt bei einem Auftrag
// ohne Verbote den Vorrang eines Textes, den es gar nicht gibt, und lud den Agenten ein,
// sich Grenzen auszudenken oder sein Mandat abzuschwaechen. Der Umbruch gehoert aus
// demselben Grund in den Wert (so loest es auch der Bestand, assistantContextSection):
// stuende er in der Vorlage, bliebe er als Leerzeile stehen, wenn der Wert wegfaellt.
function constraintsText(constraints) {
  const verbote = alsText(constraints);
  if (!verbote) return "";
  return `\n${EN_PROMPT.constraintsLabel} ${verbote}\n${CONSTRAINTS_PRECEDENCE}`;
}

// Der verdichtete Hintergrund des Auftrags. Aufbau, Reihenfolge, Beschriftungen und der
// Riegel am Ende sind die der HINTERGRUND-Sektion des Bestandswegs (src/claude.js
// assistantContextSection): jede Zeile rendert nur, wenn ihr Feld INHALT hat, und ohne eine
// einzige Zeile faellt der Block ganz weg - samt seines fuehrenden Umbruchs, der wie dort im
// Wert steckt. Der Riegel gehoert dazu - der Inhalt ist Information FUER den Agenten, keine
// Anweisung, die er weitergibt.
//
// Das Kanal-Gate (ASSISTANT_CONTEXT_ENABLED) wird hier NICHT ein zweites Mal formuliert: ist
// es zu, traegt der Call-Record gar keinen Kontext (routes/api-calls.js), und die
// Kontext-Zeilen fallen von selbst weg.
//
// Das BRIEFING steht als erste Zeile im selben Block - dieselbe Reihenfolge wie im Bestand
// (src/claude.js assignmentBlock: BRIEFING vor der HINTERGRUND-Sektion). Es faehrt bewusst
// im vorhandenen Wert mit statt als zehnte Variable: die Agenten-Vorlage muesste sonst um
// einen Platzhalter wachsen, den erst ein Push an den Anbieter wirksam macht. Es haengt
// NICHT am Kontext-Gate - Briefing und Kontext sind zwei Felder, und ein Block aus nur
// einem von beiden ist ein vollstaendiger Block.
function backgroundText({ context, briefing }) {
  const label = EN_PROMPT.background;
  const lines = [
    contextLine(BRIEFING_LABEL, briefing),
    contextLine(label.summary, context?.summary),
    contextLine(label.relationship, context?.recipient_relationship),
    contextLine(label.outcome, context?.desired_outcome),
    contextLine(label.facts, keyFactsText(context?.key_facts)),
  ].filter(Boolean);
  if (!lines.length) return "";
  return `\n${label.heading}\n${lines.join("\n")}\n${label.guardrail}`;
}

// Der Platzhalter-Anfang des Anbieters. Ein unversorgtes {{...}} in einem Wert, den der
// Anbieter aufloest, ist im besten Fall Muell und im schlechtesten der 1008-Abbruch (der
// Angerufene hoert Stille, belegt im Kopfkommentar von
// test/el-vorlage-variablen-abgleich.test.js). Benannt statt nackt im Code (G25).
export const PLACEHOLDER_OPENER = "{{";

// OC-P2: die Prompt-Sektion fuer den Owner-Fall - gebaut wie constraintsText/
// backgroundText: "" oder ein fertiger Block mit fuehrendem Zeilenumbruch, NIE null, NIE
// undefined. "" ist der Normalfall und laesst den Prompt am Anbieter EXAKT den heutigen
// Text rendern (leere Variablenwerte sind erprobt - constraints und background gehen
// heute regelmaessig leer hinaus).
//
// STRIKT === true: ein Bestands-Datensatz ohne das Feld (undefined) heisst NICHT-Owner,
// und NICHT-Owner heisst Offenlegung. Der Schalter wird hier NICHT noch einmal gelesen -
// er steckt bereits im Praedikat (src/callee-is-owner.js, ausgewertet in
// routes/api-calls.js); zwei Auswertungen desselben Schalters waeren zwei Wahrheiten.
//
// Der eingesetzte Offenlegungssatz kommt aus DERSELBEN einen Quelle wie der statische
// Rahmen und die Presets (LOCALES.<lang>.disclosure), in der OFFENLEGUNGSsprache dieses
// Anrufs - obwohl der Prompt englisch ist. Keine zweite Fassung, keine Uebersetzung hier.
// P4a: die Nachricht ist an den ANGERUFENEN gerichtet und beginnt mit dem Pflichtsatz -
// sie folgt deshalb der Offenlegungssprache, nicht der Gespraechssprache (E-1).
function calleeRelationText({ call, owner, offenlegung }) {
  if (call.calleeIsOwner !== true) return "";
  const block = `\n${EN_PROMPT.calleeRelation({ owner, disclosure: offenlegung.disclosure(owner) })}`;
  return block.includes(PLACEHOLDER_OPENER) ? "" : block;
}

// DE1: der Anrufbeantworter-Text dieses Anrufs, in der Sprache des Anrufs. Gebaut wie
// calleeRelationText direkt darueber und aus demselben Grund an derselben Stelle: der
// Wortlaut kommt aus EINER Quelle (call-locale.js -> LOCALES), hier steht nur der
// Waechter davor.
//
// WARUM DER TEXT UEBERHAUPT VON UNS KOMMT: das Feld am Agenten
// (built_in_tools.voicemail_detection.params.voicemail_message) laesst sich weder je
// Sprache noch je Anruf uebersteuern (Anbieter-Schema, 2026-09-04 gemessen). Es loest
// aber dynamische Variablen auf - der einzige Weg, auf dem ein deutscher Anruf keinen
// englischen Anrufbeantworter-Text mehr hinterlaesst.
//
// "" HEISST HIER: KEINE NACHRICHT. Der Anbieter beendet den Anruf dann sofort, statt
// etwas zu sprechen (Schema-Beschreibung des Feldes) - fail-safe: eine Lage, in der wir
// den Text nicht sauber bauen koennen, hinterlaesst LIEBER NICHTS als eine Nachricht
// ohne belastbare Offenlegung. Dieselbe {{-Sperre und dieselbe Semantik wie bei
// ownerFirstMessage/calleeRelationText: ein unversorgtes {{...}} in einem Wert, den der
// Anbieter aufloest, ist im besten Fall Muell und im schlechtesten der 1008-Abbruch.
// P4a: die Nachricht ist an den ANGERUFENEN gerichtet und beginnt mit dem Pflichtsatz -
// sie folgt deshalb der Offenlegungssprache, nicht der Gespraechssprache (E-1).
function voicemailText({ owner, offenlegung, openingLine }) {
  const text = providerVoicemailMessage({ locale: offenlegung, ownerName: owner, openingLine });
  return text.includes(PLACEHOLDER_OPENER) ? "" : text;
}

// Die Zone des ANGERUFENEN reist samt ihrem Satz und ihrem fuehrenden Zeilenumbruch -
// dasselbe Muster wie constraintsText/backgroundText und aus demselben Grund: der Prompt
// der Vorlage ist EIN statischer Text und kann keinen Block weglassen. Stuende der Satz
// statisch dort, verspraeche er bei einem nicht ableitbaren Land (jede +1-Nummer, s.
// time-context.js) eine Umrechnung gegen eine Zone, die niemand kennt.
//
// DREI LAGEN, DIE NICHT DASSELBE SIND (Eigentuemer-Entscheidung 2026-08-15) - genau EINE
// tritt je Anruf ein, der Wert ist deshalb NIE leer, und die frueher statisch im Prompt der
// Vorlage stehende Auffangzeile ist mit ihnen weggefallen (sie erlaubte weiterhin eine
// absolute Uhrzeit und waere neben Lage 3 eine zweite, schwaechere Wahrheit):
//   TATSACHE   die Zone steht ueber das LAND der Nummer fest (+33 -> Europe/Paris). Der
//              Agent rechnet um, ohne zu fragen.
//   HYPOTHESE  bei +1 gibt es kein Land, nur die Vorwahl. Die Zuordnung stimmt meistens,
//              aber nicht immer (Staaten ueber Zonengrenzen, Arizona ohne Sommerzeit), und
//              "meistens richtig" heisst bei Terminen: still falsche Uhrzeiten. Der Wert
//              reist deshalb als ANNAHME, und der Agent bestaetigt sie in EINEM Satz,
//              BEVOR er eine absolute Uhrzeit nennt - der Angerufene weiss seine Zone, das
//              ist die verlaesslichste Quelle, die es gibt, und sie kostet eine Sekunde.
//   KEINE      steht gar nichts fest, nennt der Agent GAR KEINE absolute Uhrzeit, spricht
//              unbestimmt ("tomorrow morning") und laesst die Gegenseite die Uhrzeit
//              nennen. Lieber unbestimmt als falsch - dieselbe Regel wie bei erfundenen
//              Zahlen.
// OFFEN als eigenes Paket, hier bewusst NICHT gebaut: den im Gespraech BESTAETIGTEN Wert
// speichern (zweite Haelfte der Eigentuemer-Entscheidung). Das braucht eine
// Ergebnis-Rueckmeldung des Agenten an uns und ein Feld am Store - beides gibt es auf
// diesem Weg noch nicht.
//
// Die Saetze sind hier getippt und stammen NICHT aus EN_PROMPT: der Bestandsweg hat kein
// Gegenstueck (dort steht die Uhrzeit fertig gerendert im Systemprompt, es gibt keinen
// Baustein dafuer). Ein neuer Eintrag in src/i18n/prompts/en.js waere ein Baustein ohne
// Leser im Bestand.
const calleeZoneFactSentence = (zone) =>
  `\nThe person you are calling is in the ${zone} time zone - convert every time you agree between those two zones and say which zone you mean.`;

// Der Bestaetigungssatz nennt die VERMUTETE Zone mit ihrem gesprochenen Namen. Ein fester
// Beispielname stuende bei jedem Anruf ausserhalb dieser einen Zone neben einer anderen
// Vermutung - der Agent liesse sich die falsche Zone bestaetigen und haette damit genau den
// Fehler eingesammelt, gegen den die Bestaetigung gebaut ist.
const calleeZoneHypothesisSentence = (zone) =>
  `\nThe person you are calling is probably in the ${zone} time zone. That is an assumption derived from their area code, it is not confirmed, and it may be wrong. Before you name any specific time, confirm it in one short sentence, for example: "I have you down as ${spokenTimezoneName(zone)} - is that right?" Once they have confirmed it, convert every time you agree between those two zones and say which zone you mean.`;

const CALLEE_ZONE_UNKNOWN_SENTENCE = `\nYou do not know which time zone the person you are calling is in, and you must not guess one. Never name an absolute time while the zone is unknown - no specific time, no clock time. Stay vague instead ("tomorrow morning") and let them name the exact time; then repeat it back together with the time zone they used.`;

function calleeTimezoneText({ calleeZone, calleeZoneHypothesis }) {
  if (calleeZone) return calleeZoneFactSentence(calleeZone);
  if (calleeZoneHypothesis) return calleeZoneHypothesisSentence(calleeZoneHypothesis);
  return CALLEE_ZONE_UNKNOWN_SENTENCE;
}

// Eine Kontext-Zeile - Beschriftung NUR bei Inhalt: ein blankes Feld ergaebe sonst eine
// Zeile, die aus nichts als ihrer Ueberschrift besteht ("- Desired outcome: ").
function contextLine(label, wert) {
  const text = alsText(wert);
  return text ? `${label}${text}` : "";
}

// Die Fakten-Liste als eine Zeile. Blanke Eintraege fallen raus, statt als leere Glieder
// zwischen den Trennzeichen zu stehen; bleibt nichts uebrig, entfaellt die Zeile ganz.
function keyFactsText(keyFacts) {
  if (!Array.isArray(keyFacts)) return "";
  return keyFacts.map(alsText).filter(Boolean).join(KEY_FACT_SEPARATOR);
}

// Fail-CLOSED: ein eingeschalteter Zweig ohne vollstaendige Kennungen waehlt NICHT. Ein
// stiller Rueckfall auf Telnyx waere die schlechtere Wahl - er verschleiert eine
// Fehlkonfiguration, die niemand bemerkt, solange die Anrufe irgendwie laufen. Der
// Aufrufer beendet den Call ueber seinen EINEN Fehlerpfad (Reserve frei, Tenant offen).
function assertConfigured(el) {
  const fehlend = [
    !el.apiKey && "ELEVENLABS_API_KEY",
    !el.agentId && "ELEVENLABS_AGENT_ID",
    !el.agentPhoneNumberId && "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
  ].filter(Boolean);
  if (fehlend.length)
    throw new Error(
      `ElevenLabs-Anrufstart ist eingeschaltet, aber unvollstaendig konfiguriert: ${fehlend.join(", ")}`,
    );
}

// OUT-05-EL (Trockenlege-Naht, Owner-Auftrag 15.08.2026, Aufgabe 1): das Gegenstueck zu
// FAKE_ORIGINATE (telephony/registry.js#fakeVoice) fuer DIESEN Weg - FAKE_ORIGINATE deckt
// nur den Telnyx-Transport ab, config.safety.fakeOriginateElevenlabs (src/config.js) den
// EINEN Netzzugriff hier (startOutboundCall, s. originateCall unten). Die Antwort ist in
// der FORM des Anbieters (SIPTrunkOutboundCallResponse: success, message, conversation_id,
// sip_call_id, Antwort von POST /v1/convai/sip-trunk/outbound-call) - die WERTE sind
// erfunden (fake_el_-/fake_sip_-Praefix macht das im Store/Log sofort erkennbar), NICHT
// die Form. originateCall liest daraus GENAU wie aus der echten Antwort (.conversation_id).
// sip_call_id steht hier NUR der Form halber und wird bewusst von niemandem gelesen: das
// Feld traegt auch beim echten Anbieter nicht den Join-Schluessel, sondern dessen call_sid
// (s. convai.js#startResultOf, an Anruf 2 vom 17.08.2026 gemessen).
// FAKE_ID_BYTE_LENGTH: dieselbe Laenge wie fakeVoice (telephony/registry.js), reine
// Lesbarkeits-Konstante ohne fachliche Bedeutung (G25).
const FAKE_ID_BYTE_LENGTH = 8;
function fakeSipTrunkOutboundCallResponse() {
  const suffix = crypto.randomBytes(FAKE_ID_BYTE_LENGTH).toString("hex");
  return {
    success: true,
    message: "fake_originate: kein SIP-Anruf ausgeloest (Trockenlege-Naht)",
    conversation_id: `fake_el_${suffix}`,
    sip_call_id: `fake_sip_${suffix}`,
  };
}

// DER TORZUSTAND DES RUECKFRAGEKANALS, als Wert und nicht als Verhalten (Eigentuemer-
// Entscheidung 17.08.2026, Punkt 1 und 3). Zwei Zeichenketten statt true/false: der
// Anbieter setzt dynamische Variablen als TEXT in den Prompt ein, und "false" laese sich
// dort schlechter lesen als ein Wort. Die weisse Liste bleibt bei zwei Pfaden - der
// Prompt ist EINER, fest und gepusht, und verzweigt an diesem Wert.
//
// FAIL-CLOSED, und die Zusage haengt am TOR: consultAllowedFor liefert einen strikten
// Wahrheitswert, jeder unbekannte Zustand kommt dort schon als false heraus (an vier
// Faellen gemessen, test/elevenlabs-torzustand.test.js). Das `=== true` hier ist
// Doppelsicherung fuer den Tag, an dem jemand das Tor lockerer macht - und ausdruecklich
// KEIN Waechter: eine Rotprobe daran bleibt gruen, solange das Tor strikt ist. Ein
// falsch-positiver Torzustand waere schlimmer als ein falsch-negativer - der Agent saegte
// eine Rueckfrage zu, die nie kommt.
// Seit Thema B (2026-08-19) das GETEILTE Vokabular beider Tore: consult_available
// UND lookup_available sprechen dieselben zwei Woerter - der Prompt verzweigt an
// beiden Stellen mit demselben Muster ('If that says "unavailable" ...').
const GATE_AVAILABLE = "available";
const GATE_UNAVAILABLE = "unavailable";

// Der Standard, wenn niemand ein Tor verdrahtet hat. Er ENTSCHEIDET nichts - er sagt
// nein. Das ist kein zweites Tor (das waere Blocker BL-2 des Rueckfrage-Webhooks), sondern
// dieselbe Antwort, die die Torkette in jedem unklaren Fall gibt: unbekannt sieht aus wie
// nicht verfuegbar. Der Preis ist benannt: vergisst jemand die Verdrahtung, bietet der
// Agent nie eine Rueckfrage an - konservativ, sofort am ersten Anruf sichtbar, und nie
// eine Zusage, die niemand einloest.
const ohneRueckfrageTor = () => false;
// Dasselbe fuer die Recherche (Thema B): unverdrahtet heisst "nicht verfuegbar" -
// der Agent bietet dann nie eine Recherche an, die der Webhook ablehnen wuerde.
const ohneRechercheTor = () => false;

// OUTBOUND-E5 (F3): der Standard-Metrik-Empfaenger, wenn niemand welche verdrahtet hat -
// ein No-op statt eines Wurfs, dasselbe Muster wie ohneRueckfrageTor/ohneRechercheTor.
// HEREINGEREICHT statt importiert (Muster consultAllowedForCall, s. Signatur unten): src/
// metrics.js importiert src/config.js und bindet damit dessen DATA_DIR-Snapshot beim
// Laden - ein statischer Import HIER haette jede Datei, die outbound.js STATISCH laedt
// (mehrere Testdateien tun das, Muster test/el-sip-call-id-join.test.js), an diesen
// Zeitpunkt gebunden, BEVOR der Test sein eigenes DATA_DIR setzen kann (Lehre
// test-base-env-drift - am 2026-08-29 genau so gemessen: ein Testlauf schrieb daraufhin
// in das echte data/store.json statt in sein Temp-Verzeichnis).
const ohneMetrikMeldung = Object.freeze({ logSenderFallback: () => {} });

// Der Auftrag reist als DYNAMISCHE VARIABLE. Es sind genau die, die die Agenten-Vorlage
// verbraucht ({{owner_name}}, {{callee}}, {{objective}}, {{constraints}}, {{background}},
// {{mandate}}, {{owner_timezone}}, {{callee_timezone}}, {{today}}, {{consult_available}},
// {{opening_line}}, {{lookup_available}}, {{callee_relation}}, {{voicemail_line}},
// {{inbound_situation}}, dazu tenant_token fuer die Werkzeuge; die Namensmenge pinnt
// test/el-vorlage-variablen-abgleich.test.js) - fehlt eine, bliebe ihr Platzhalter im Agenten-Prompt
// unaufgeloest. Der Weg ueber eine Prompt-Uebersteuerung scheidet aus: eine nicht
// freigeschaltete conversation_config_override wird vom Anbieter STILL ignoriert.
//
// opening_line (Thema A, 2026-08-19) ist der GESPROCHENE Anrufgrund in first_message -
// die bei Auftragsannahme festgelegte, geprueft-validierte Zeile vom Call-Datensatz,
// hier nur noch gegen ihren Annahme-Hash gehalten (verifiedOpeningLine): stimmt er
// nicht, spricht der Anruf den deterministischen Rueckfall, NIE den veraenderten Text.
// In den Anrufbeantworter-Text geht sie seit DE1 als WERT ein (voicemail_line), nicht
// mehr als Platzhalter. {{objective}} bleibt daneben ROH bestehen - es speist den
// PROMPT (die Aufgabe des Agenten), nicht mehr die gesprochene Eroeffnung; die
// Aufgabentreue haengt am vollen Wortlaut des Auftraggebers.
//
// owner_name ist der einzige mit INHALTLICHEM Default: er traegt die Offenlegung (Regel 2,
// Artikel 50 EU AI Act), und die haengt nie an einer Variablen ohne Default. Ein fehlender
// oder blanker Name ergaebe sonst den halben Satz "...on behalf of ." - das Identitaets-
// Gate davor (telephony/outbound-gates.js) prueft den WAHRHEITSWERT des Namens, ein Name
// aus lauter Leerzeichen passiert es. DER DEFAULT SPRICHT DIE SPRACHE DES ANRUFS
// (locale.disclosureOwnerFallback, aufgeloest in call-locale.js): frueher stand hier fest
// der englische Ausdruck, der in einem deutschen oder franzoesischen Offenlegungssatz ein
// Sprachbruch mitten in der Pflichtaussage waere.
// Die uebrigen tragen ohne Inhalt den leeren String:
// sie muessen DA sein, aber ihr Fehlen kostet keine Pflicht, sondern nur Inhalt. AUSSER
// {{mandate}}: dort haengt seit der Mandats-Weiche die Buchungs-Grenze mit drin, und die
// gilt in BEIDEN Lagen - der Wert ist deshalb nie leer (s. mandateText).
//
// AUSSPRACHE (Eigentuemer-Befund 15.08.2026, der Name klang falsch): der Name geht
// UNVERAENDERT raus - keine Lautschrift, keine Ersatz-Schreibweise an dieser Stelle. Wie er
// KLINGT, entscheidet ein Aussprache-Woerterbuch am Agenten (Zuordnungsfeld
// conversation_config.tts.pronunciation_dictionary_locators, besessen und begruendet in
// elevenlabs/agent_configs/outbound-agent.template.json, _aussprache_hinweis). Das ist die
// einzige Stelle, die traegt: den Namen spricht auch first_message - ein fertiger Text vor
// jedem Modell-Turn -, und was hier verfremdet wuerde, stuende genau so im Transkript und in
// der Offenlegung, deren Wortlaut wir nachweisen muessen.
//
// Die vier gebauten Bloecke gehen UNGETRIMMT raus: sie sind per Bau String (jeder Baustein
// liefert "" oder einen fertigen Block), sie haben ihre Eingaben bereits VOR der
// Leer-Pruefung getrimmt - und ihr fuehrender Zeilenumbruch ist Inhalt, den ein Trimmen
// hier wegfressen wuerde (dann stuende der Block ohne Leerzeile an der Auftragszeile).
//
// ZEIT (T7/T8): die Zone des Auftraggebers und das heutige Datum sind IMMER gesetzt (der
// Zeitkontext liefert beide fail-safe). Fuer die Gegenstelle geht IMMER ein Satz raus, aber
// nie ein blosser Bezeichner: er sagt zugleich, wie sicher der Wert ist - Tatsache,
// bestaetigungspflichtige Annahme oder gar keine Zone (s. calleeTimezoneText). Geraten wird
// dabei nichts (s. time-context.js). Vorher wirkte an dieser Stelle ein Festwert am Agenten
// ("Europe/Berlin"), der weder besessen noch pro Anruf richtig war.
//
// offenlegung + openingLine kommen HEREIN statt hier aufgeloest zu werden (s.
// startCallBody): die Owner-Eroeffnung braucht dieselbe Grund-Zeile, und
// verifiedOpeningLine WARNT bei einem Hash-Bruch - ein zweiter Aufruf ergaebe dieselbe
// Zeile, aber eine zweite Warnung zum selben Anruf, also zwei Kandidaten in der Diagnose
// statt einem (G5/P6).
// P4a: `owner` kommt HEREIN statt hier berechnet zu werden - EIN Auftraggeber-Ausdruck
// fuer alle drei Leser (owner_name, callee_relation, die uebersteuerte Eroeffnung) lebt
// jetzt in startCallBody (G5); drei Rechnungen desselben Defaults waeren drei Wahrheiten.
// IEL-B6: der Inbound-Builder (inbound-initiation.js) leitet seine Schluesselmenge hieraus
// ab (eine Quelle) - deshalb exportiert.
export function dynamicVariables({
  call,
  owner,
  offenlegung,
  openingLine,
  time,
  consultAllowed,
  lookupAllowed,
  tenantToken,
}) {
  return {
    consult_available: consultAllowed === true ? GATE_AVAILABLE : GATE_UNAVAILABLE,
    // Thema B: der Torzustand der Recherche, aus DERSELBEN Torkette wie der Webhook
    // (research/registry.js#elevenLabsLookupAvailableFor) - fail-closed, dieselbe
    // Doppelsicherung wie consult_available darueber.
    lookup_available: lookupAllowed === true ? GATE_AVAILABLE : GATE_UNAVAILABLE,
    opening_line: openingLine,
    owner_name: owner,
    callee: alsText(call.to),
    objective: alsText(call.goal),
    constraints: constraintsText(call.constraints),
    background: backgroundText({ context: call.context, briefing: call.briefing }),
    mandate: mandateText(call.mandate),
    owner_timezone: alsText(time.ownerZone),
    callee_timezone: calleeTimezoneText(time),
    today: alsText(time.today),
    // OC-P2: "" fuer jedes Nicht-Owner-Ziel - der Prompt am Anbieter rendert dann exakt
    // den heutigen Text.
    callee_relation: calleeRelationText({ call, owner, offenlegung }),
    // DE1: der GANZE Anrufbeantworter-Text, in der Sprache dieses Anrufs. Er benutzt
    // DENSELBEN owner-Ausdruck wie owner_name eine Zeile darueber (zwei Rechnungen
    // desselben Defaults waeren zwei Wahrheiten, G5) und DIESELBE geprueft-validierte
    // Grund-Zeile wie die Eroeffnung.
    voicemail_line: voicemailText({ owner, offenlegung, openingLine }),
    // IEL-B3 (L5): die Inbound-Sektion der Vorlage (Ende der PERSONA-Zeile). Ein
    // ausgehender Anruf ist nie eingehend: der Wert ist hier IMMER "", und der Prompt am
    // Anbieter rendert damit exakt den Text ohne diese Sektion (Muster callee_relation).
    // Mitreisen MUSS sie trotzdem - ein Prompt-Platzhalter ohne Wert bliebe unaufgeloest.
    // Den Blocktext fuer eingehende Anrufe baut der Inbound-Weg, nicht dieser Anrufstart.
    inbound_situation: "",
    // SEC-P4: die Mandanten-Dimension des Werkzeug-Tokens. Die Werkzeug-Definition liest
    // sie ueber dynamic_variable in ihren Anfragekoerper (dieselbe Mechanik wie
    // conversation_id aus system__conversation_id); der PROMPT nennt sie NIE - kein
    // Modell bekommt sie zu sehen und kann sie aussprechen (Absolute Regel 4). ALS
    // LETZTER Schluessel, damit die Reihenfolge des Bestands-Koerpers unberuehrt bleibt.
    tenant_token: tenantToken,
  };
}

// Sprache, Stimme und Offenlegungs-Ausdruck EINES Anrufs (s. call-locale.js), an dieselbe
// eine Aufloesung gereicht, die auch der Bestandsweg benutzt. MODUL-EBENE aus demselben
// Grund wie finishWithoutProviderResult weiter unten (G30, haelt makeElevenLabsOutbound
// unter der Zeilengrenze); alle Abhaengigkeiten reisen als EIN Objekt (F1).
//
// Der Geo-Anker ist die Nummer, ueber die dieser Anruf tatsaechlich hinausgeht (call.from)
// - GENAU die, mit der routes/api-calls.js call.language aufgeloest hat: dieselbe
// Funktion, dieselbe Eingabe, derselbe Zustand, also kein zweites Ergebnis.
//
// defaultVoiceId ist die global konfigurierte Plattform-Stimme - der Wert, auf den die
// Stimmen-Karte faellt, wenn eine Sprache keine eigene Kennung hat (Deutsch, s.
// telephony/adapters/telnyx/elevenlabs-voice.js, wo genau dieser Env-Name als
// Plattform-Stimme benannt ist). Es ist eine rohe ElevenLabs-Voice-Kennung, kein
// Telnyx-Format - der Env-Name sagt nur, WER sie bisher gereicht bekam.
//
// EXPORTIERT seit Thema A (2026-08-19): routes/api-calls.js braucht dieselbe
// Aufloesung VOR createCall (die Eroeffnungszeile entsteht in der Sprache des
// Anrufs). call ist dort ein call-FOERMIGES Objekt {tenantId, from, to} - genau die
// drei Felder, die diese Funktion liest; ein zweiter Zusammenbau der Argumente an
// der Route waere der Weg, auf dem beide Sprachen still auseinanderlaufen.
export function callLocaleOf({ store, config, call, ownerName }) {
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    numberRecord: store.numberRecordByE164(call.from),
    ownerName,
    defaultVoiceId: config.telnyx.telnyxElevenLabs.voiceId,
    // Das ANGERUFENE Ziel, bereits normalisiert (routes/api-calls.js) - der hoechst-
    // gewichtete Eingang der OFFENLEGUNGS-Sprachwahl, s. call-locale.js. Nicht call.to
    // roh vom Aufrufer: normalisiert wird eine Ebene hoeher, hier wird nur gelesen.
    to: call.to,
    // P4a: die GESPRAECHSSPRACHE steht am Datensatz (routes/api-calls.js hat Sprachwunsch
    // und Auftraggeber-Kette dort zu EINEM Wert gemacht). Sie wird hier nicht zum zweiten
    // Mal aufgeloest; die Offenlegungssprache leitet die Naht selbst aus `to` ab.
    callLanguage: call.language,
  });
}

// OUTBOUND-E5 (F3): Absender-Registrierung waehlen und einen Rueckfall LAUT machen -
// MODUL-EBENE aus demselben Grund wie callLocaleOf darueber (G30, haelt
// makeElevenLabsOutbound unter der Zeilengrenze). DIESELBE Quelle wie resolve_outbound
// (views.js#findActiveNumber, tenant-gefiltert) - kein zweiter Absenderpfad. Die
// Auswahl selbst ist rein und netzfrei (waehleAbsenderRegistrierung); sie kann nur eine
// Registrierung liefern, die an der Nummer haengt, die dieser Anruf als from gebucht hat.
// LAUT, nie still (E4-Lehre 4): der Rueckfall ist im Log benannt, wird gezaehlt und steht
// am Anruf-Datensatz. PII-frei - Herkunft und Grund, nie eine Rufnummer.
function absenderFuerAnruf({ store, call, el, metrics }) {
  const absender = waehleAbsenderRegistrierung({
    numberRecord: findActiveNumber(store.load(), call.tenantId),
    fromE164: call.from,
    rueckfallId: el.agentPhoneNumberId,
  });
  if (absender.quelle === ABSENDER_QUELLE.RUECKFALL_GLOBAL) {
    console.warn(`[el-outbound] Absender-Rueckfall (call=${call.id}): grund=${absender.grund}`);
    metrics.logSenderFallback({ grund: absender.grund });
  }
  store.recordFromRegistrationSource(call.id, absender.quelle);
  return absender;
}

// OUTBOUND-E5 (F3): die vom Anbieter gemeldete Absendernummer persistieren - MODUL-EBENE
// aus demselben Grund wie absenderFuerAnruf darueber (G30). Die Fixture traegt hier ein
// MASKIERTES Token, kein E.164 - die Formpruefung sitzt im Store-Mutator (recordActualSender).
function recordAbsenderMessung(store, callId, conversation) {
  store.recordActualSender(callId, {
    e164: conversation.metadata?.phone_call?.agent_number,
    source: FROM_SOURCE.PROVIDER_MEASURED,
  });
}

// Das Gespraech ist beim Anbieter zu Ende. Transkript, Zusammenfassung und Befund KOMMEN
// VON IHM (wir haben auf diesem Weg weder Audio noch Turn-Schleife) und landen ueber die
// Store-Mutatoren an denselben Feldern, die get_transcript ohnehin liest - kein zweiter
// Schreibweg neben dem Store. MODUL-EBENE (G30/G34): die Funktion braucht ausser store
// keinen Zustand der Fabrik - dieselbe Begruendung wie bei recordAbsenderMessung darueber.
//
// belegNachreifbar (KV2-4): DATENFELD der EL-Belegzeile, keine Verhaltensweiche - es
// steuert hier keine Verzweigung, es wird persistiert (deshalb kein G15/F3-Selektor). Die
// beiden Aufrufer liefern es ausdruecklich, ohne Default: der regulaere Weg laesst den
// Anbieter-Datensatz stehen, der Abbruchweg loescht ihn unmittelbar danach.
// politik (IEL-B4) ist dagegen bewusst eine Verhaltensweiche (Spec E6/E7): sie entscheidet,
// ob Anbieter-Zusammenfassung und next_steps-Item geschrieben werden (nachlauf-politik.js).
function persistProviderResult({ store, callId, conversation, belegNachreifbar, politik }) {
  const zeilen = spokenLines(conversation);
  // VOR dem Schreiben: die Meldung gilt dem, was der Anbieter geliefert hat, und darf
  // nicht an einem spaeteren Store-Fehler haengen bleiben (s. reportAudioTags).
  // ST3: beide Detektoren melden und zaehlen - das Zaehlfeld (Owner-Entscheidung 6)
  // macht die Rueckfall-Rate messbar (Treffer/Anrufe) und aendert am Transkript nichts.
  const audioTagMarken = reportAudioTags(callId, zeilen);
  const b1Treffer = reportDoubleAnnouncements(callId, zeilen);
  store.recordElDetectorCounts(callId, { elTags: audioTagMarken.length, elB1: b1Treffer.length });
  for (const zeile of zeilen) store.addTranscript(callId, roleOf(zeile.role), zeile.message);
  store.recordProviderCallResult(callId, {
    summary: providerSummaryOf(conversation, politik),
    objectiveAchieved: objectiveAchievedOf(conversation),
  });
  // ABNAHME-D1 (TEIL 2/3): s. persistCollectedFields oben (Modul-Ebene, G30).
  persistCollectedFields({ store, callId, conversation, politik });
  // PHASE-6-VORAUSSETZUNG, die EINZIGE Quelle des Join-Schluessels zur Telefonie-
  // Rechnung: der "otb_"-Wert, den auch der Telnyx-Beleg unter sip_call_id fuehrt
  // (GEMESSEN an beiden Enden, test/fixtures/elevenlabs-conversations.js). Die Antwort
  // des Anrufstarts scheidet als Quelle aus - sie liefert unter demselben Feldnamen
  // ElevenLabs' call_sid (s. convai.js#startResultOf, an Anruf 2 vom 17.08.2026 gemessen).
  //
  // DIE STELLE IST BEWUSST GEWAEHLT: persistProviderResult laeuft auf BEIDEN Wegen VOR
  // dem Loeschversuch beim Anbieter - im regulaeren Ende (finishFromConversation) gibt es
  // gar keinen, im Abbruch (endActiveCall) ist die Reihenfolge Abruf-vor-Loeschen bindend.
  // Was hier nicht gesichert ist, ist danach unwiederbringlich weg.
  //
  // PREIS DER EINEN QUELLE, bewusst getragen: kommt nie ein Ergebnis (Anbieter stumm,
  // Prozess vorher weg), bleibt der Schluessel leer und die Telefonie-Kosten dieses
  // Anrufs sind ihm nicht mehr zuzuordnen. Ein FALSCHER Schluessel waere schlechter: er
  // jointet ebenfalls nicht, sperrt aber zusaetzlich (set-once) die richtige Quelle aus
  // und behauptet dabei eine Zuordnung, die es nicht gibt.
  //
  // IEX-A1: nur fuer Profile mit telnyx_sip-Traeger (Katalog,
  // kosten-beleg.js#anrufFuehrtTelnyxSip). Der Inbound-EL-Weg (Telnyx-Dial) liefert als
  // call_id eine UUID ohne Telnyx-Beleg; sein Leg-Schluessel ist twilioSid +
  // telnyx_session_id (billing/call-leg-ref.js). Der Waechter in
  // state-ops.js#recordSipCallId bleibt unveraendert und meldet eine Fremdform auf Profilen
  // mit telnyx_sip weiter laut.
  const fuehrtTelnyxSip = anrufFuehrtTelnyxSip(store.getCall(callId));
  if (fuehrtTelnyxSip) store.recordSipCallId(callId, conversation.metadata?.phone_call?.call_id);
  // OUTBOUND-E5 (F3): die vom Anbieter gemeldete Absendernummer - AUCH im abgelehnten Fall
  // befuellt (Befund 27.08.). Formpruefung sitzt im Store-Mutator (recordActualSender).
  recordAbsenderMessung(store, callId, conversation);
  // KV2-4: der EL-Beleg (vorlaeufig) plus, nur bei Profil mit telnyx_sip (IEX-A1), die
  // erwartete telnyx_sip-Zeile. HIER, weil beide Aufrufer von persistProviderResult damit
  // bedient sind - das regulaere Ende und der Abbruch -, und ALS LETZTER SCHRITT, weil
  // dieser Schreibweg rein additiv ist und keinen der Anbieter-Wahrheits-Schreiber oben
  // beeinflussen darf. Kein Netz-IO: die Antwort
  // liegt bereits vollstaendig im Speicher. Fail-soft (s. dort) - dieses Buch hat noch
  // keinen Leser und darf den Geld-/Terminierungspfad nie anhalten.
  recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar, erwarteTelnyxSip: fuehrtTelnyxSip });
}

// Die EINZIGEN zwei Dinge, die pro Anruf am Agenten des Anbieters gesetzt werden duerfen
// (Eigentuemer-Entscheidung 16.08.2026): die Sprache und die Stimme. Beide kommen aus dem
// aufgeloesten Locale (call-locale.js), also aus dem Datensatz - kein Aufrufer kann sie
// setzen. Die weisse Liste in convai.js#assertOverrideWhitelisted setzt genau diese zwei
// Pfade fail-closed durch, BEVOR der Anfragekoerper das Netz sieht; ein dritter Pfad hier
// braecht den Anrufstart ab, statt still durchzurutschen.
//
// DIE STIMME IST BIS ZUM PUSH WIRKUNGSLOS - und zwar STILL: die Erlaubnis-Karte des
// LIVE-Agenten (platform_settings.overrides.conversation_config_override) stand am
// 17.08.2026 rein lesend gemessen auf agent.language = true, tts.voice_id = FALSE. Der
// Anbieter ignoriert einen nicht freigeschalteten Pfad kommentarlos - kein Fehler, keine
// Warnung, der Anruf laeuft einfach in der im Dashboard gewaehlten Stimme. Die Vorlage im
// Repo erlaubt beide (dieselbe Karte, dort true/true), der Push dieser Karte ist eine
// Eigentuemer-Handlung und noch nicht ausgefuehrt. Ab diesem Push wirkt die Stimme OHNE
// Codeaenderung. Der Vermerk steht hier, weil ein stillschweigend wirkungsloser Wert an
// genau dieser Stelle bereits zweimal zugeschlagen hat.
//
// KEINE STIMME KONFIGURIERT -> KEIN tts-ZWEIG: eine leere Plattform-Stimme wuerde als
// voice_id: "" hinausgehen und dem Agenten seine im Dashboard gewaehlte Stimme nehmen,
// ohne eine zu setzen. Weglassen laesst sie stehen - fail-safe, dieselbe Haltung wie

//
// OC-P2: DIE EINE KOMPOSITIONSSTELLE DER OWNER-EROEFFNUNG (G5/S2). Sie besteht aus der
// Owner-Begruessung und derselben Grund-Zeile, die der Bestandsfall hinter der Offenlegung
// spricht - nur mit der Begruessung davor statt der Offenlegung. Es gibt keinen zweiten
// Ort, an dem eine Eroeffnung zusammengesetzt wird (composedOpeningLine bleibt die
// Kompositionsstelle der Grund-Zeile selbst, opening-line.js).
//
// "" HEISST: KEINE UEBERSTEUERUNG - nicht "leere first_message". Der Aufrufer laesst den
// Schluessel dann GANZ weg. Ein leerer Wert naehme dem Agenten seine Eroeffnung, ohne eine
// zu setzen - derselbe Fehler, den der tts-Zweig darueber bereits benennt.
//
// VIER BEDINGUNGEN, alle fail-closed:
//   1. call.calleeIsOwner === true - strikt, undefined heisst NICHT-Owner;
//   2. ein nicht-leerer Vorname (es gibt KEINEN Namens-Rueckfall, s. LOCALES.ownerOpening);
//   3. der zusammengesetzte Text ist nicht blank. Doppelsicherung nach dem Muster von
//      consult_available: sie kann heute nicht greifen (ownerOpening liefert bei
//      gesetztem Vornamen nie ""), und sie ist ausdruecklich KEIN Waechter - eine
//      Rotprobe daran bleibt gruen. Sie steht fuer den Tag, an dem ein Bundle den
//      Baustein aendert;
//   4. kein {{ im Text. Das ist der EINZIGE erreichbare Angriffsweg dieser Kette: der
//      Vorname stammt vom Tenant (store.tenantContext), die Grund-Zeile kann keine
//      Klammern tragen (validOpeningLine verbietet {} , opening-line.js). Ein
//      "{{irgendwas}}" im Vornamen wuerde in einer uebersteuerten first_message zum
//      1008-Abbruch - der Angerufene hoert Stille.
function ownerFirstMessage({ call, offenlegung, firstName, openingLine }) {
  if (call.calleeIsOwner !== true) return "";
  const vorname = alsText(firstName);
  if (!vorname) return "";
  // P4a: die KI-Kennzeichnung der Owner-Eroeffnung ersetzt den Pflichtsatz (OC) und
  // traegt dieselbe Pflicht - also dieselbe Sprache. Der Beweis des Praedikats lautet
  // "die NUMMER gehoert dem Tenant", nicht "die PERSON ist der Tenant".
  return sichereEroeffnung([offenlegung.ownerOpening(vorname), openingLine]);
}

// "" HEISST: KEINE UEBERSTEUERUNG - nicht "leere first_message" (s. conversationConfig-
// Override). EIN Waechter fuer beide Lagen (G5/S2): blank oder ein unversorgtes {{...}}
// ergeben "", weil ein unaufgeloester Platzhalter im besten Fall Muell und im
// schlechtesten der 1008-Abbruch ist (der Angerufene hoert Stille).
function sichereEroeffnung(teile) {
  const text = teile.filter(Boolean).join(" ").trim();
  return !text || text.includes(PLACEHOLDER_OPENER) ? "" : text;
}

// P4a: DIE EINE Kompositionsstelle der pro Anruf uebersteuerten Eroeffnung - zwei
// einander ausschliessende Lagen, sonst leer:
//   1. das eigene Ziel (OC-P2): die Owner-Begruessung tritt an die Stelle des
//      Pflichtsatzes - unveraendert, weder weiter noch enger (I-2);
//   2. Gespraechs- und Offenlegungssprache laufen auseinander (F-2): dann waehlt der
//      Anbieter ueber agent.language das language_preset - und damit den Pflichtsatz -
//      in der GESPRAECHSSPRACHE aus. Ein franzoesisch gefuehrter Anruf an eine deutsche
//      Nummer bekaeme so den franzoesischen Satz, den der Angerufene nicht versteht.
//      Deshalb reist der Satz hier als WERT, aus DERSELBEN Quelle wie der statische
//      Rahmen (LOCALES.<sprache>.disclosure) - keine zweite Fassung, keine Uebersetzung.
// Fallen beide Sprachen zusammen (jeder Anruf ohne Sprachwunsch im eigenen Sprachraum),
// bleibt es beim statischen Anbietertext und der Koerper ist byte-identisch zum Bestand.
// Laesst sich in Lage 2 keine sichere Eroeffnung bauen, entsteht "" - dann WIRFT der
// Waechter in convai.js vor dem Netzzugriff. Es gibt bewusst KEINEN dritten, stillen
// Ausgang: ein Anruf mit unpassendem Pflichtsatz ist schlechter als kein Anruf.
function perCallFirstMessage({ call, locale, offenlegung, firstName, owner, openingLine }) {
  const ownerEroeffnung = ownerFirstMessage({ call, offenlegung, firstName, openingLine });
  if (ownerEroeffnung) return ownerEroeffnung;
  if (locale.language === locale.disclosureLanguage) return "";
  return sichereEroeffnung([offenlegung.disclosure(owner), openingLine]);
}

function conversationConfigOverride({ call, locale, offenlegung, firstName, owner, openingLine }) {
  const eroeffnung = perCallFirstMessage({ call, locale, offenlegung, firstName, owner, openingLine });
  return {
    agent: {
      language: locale.language,
      // WEGLASSEN STATT LEER SETZEN - dasselbe Muster wie der tts-Zweig darunter.
      ...(eroeffnung ? { first_message: eroeffnung } : {}),
    },
    ...(locale.voiceId ? { tts: { voice_id: locale.voiceId } } : {}),
  };
}

// Der vollstaendige Anfragekoerper des Anrufstarts (POST /v1/convai/sip-trunk/
// outbound-call): WEN wir anrufen, WOMIT der Agent arbeitet (dynamische Variablen) und die
// zwei erlaubten Uebersteuerungen. MODUL-EBENE aus demselben Grund wie callLocaleOf
// darueber (G30). Der Waechter in convai.js prueft GENAU dieses Objekt, bevor es das Netz
// sieht.
function startCallBody({
  el,
  call,
  ownerName,
  firstName,
  time,
  locale,
  consultAllowed,
  lookupAllowed,
  agentPhoneNumberId,
  tenantToken,
}) {
  // EIN Bundle und EINE Grund-Zeile fuer beide Leser (s. dynamicVariables).
  const bundle = localeFor(locale.language);
  // P4a: das Buendel der OFFENLEGUNGSSPRACHE. Fallen beide zusammen - jeder Anruf ohne
  // Sprachwunsch im eigenen Sprachraum -, ist es DASSELBE Objekt und der Koerper bleibt
  // byte-identisch zum Bestand (test/fixtures/el-anrufstart-fremdziel.json).
  const offenlegung = localeFor(locale.disclosureLanguage);
  const openingLine = verifiedOpeningLine({ call, locale: bundle });
  // EIN Auftraggeber-Ausdruck fuer alle drei Leser (owner_name, callee_relation und die
  // uebersteuerte Eroeffnung) - drei Rechnungen desselben Defaults waeren drei Wahrheiten
  // (G5). Der Default spricht die Sprache des PFLICHTSATZES, in den er eingesetzt wird.
  const owner = auftraggeberAusdruck(ownerName, offenlegung);
  return {
    agent_id: el.agentId,
    // OUTBOUND-E5 (F3): die Registrierung der DID DES ANRUFENDEN TENANTS. Der Anrufkoerper
    // hat kein Absenderfeld (am Anbieter belegt) - DIESE Kennung bestimmt allein, welche
    // Nummer der Angerufene sieht. Vorher stand hier die EINE globale Env fuer ALLE Tenants;
    // ein Rueckruf landete dadurch beim Besitzer jener Nummer, nicht beim Auftraggeber.
    // Aufgeloest wird sie oben, EINMAL, rein (waehleAbsenderRegistrierung).
    agent_phone_number_id: agentPhoneNumberId,
    to_number: call.to,
    conversation_initiation_client_data: {
      dynamic_variables: dynamicVariables({
        call,
        owner,
        offenlegung,
        openingLine,
        time,
        consultAllowed,
        lookupAllowed,
        tenantToken,
      }),
      conversation_config_override: conversationConfigOverride({
        call,
        locale,
        offenlegung,
        firstName,
        owner,
        openingLine,
      }),
    },
  };
}

// Der vollstaendige Aufruf-Bausatz des Anrufstarts: Transport, Konto, Koerper - und die
// zwei Werte, die der Waechter in convai.js braucht. MODUL-EBENE aus demselben Grund wie
// startCallBody darueber (G30, haelt makeElevenLabsOutbound unter der Zeilengrenze); die
// Abhaengigkeiten reisen als EIN Objekt (F1) und sind exakt die von startCallBody.
//
// callId dient NUR dem Fehlerebene-Log der Weisse-Liste-Waeche, die diesen Koerper VOR dem
// Netzzugriff prueft. calleeIsOwner ist DASSELBE Feld DESSELBEN Datensatzes, aus dem auch
// die Uebersteuerung gebaut wird (conversationConfigOverride) - es gibt keine zweite
// Quelle, die abweichen koennte.
function startCallRequest(anfrage) {
  return {
    fetchImpl: fetch,
    account: anfrage.el,
    body: startCallBody(anfrage),
    callId: anfrage.call.id,
    calleeIsOwner: anfrage.call.calleeIsOwner === true,
    // P4a: die Offenlegungssprache aus der AUFLOESUNG (locale), nicht aus dem Koerper, den
    // der Waechter prueft - erst dadurch kann er eine falsch gebaute Eroeffnung ueberhaupt
    // sehen. Dieselbe Haltung wie calleeIsOwner eine Zeile darunter.
    disclosureLanguage: anfrage.locale.disclosureLanguage,
  };
}

// IEL-B4 (E7a/E17): Ende-Anker eines ueberbrueckten Inbound-Calls = Carrier-Ende, gekappt
// wie jedes Telnyx-Bein. Ohne Nachlauf-Marker liefert carrierEndMsOf nowMs (E17-Rest).
// nowMs ist der Taktbeginn (Spec E7a woertlich carrierEndMsOf(call, nowMs)): wird der Marker
// erst waehrend eines haengenden Abrufs gesetzt, landet der Anker um hoechstens die
// Abrufdauer zu frueh (Unterbuchung) - nur im Neustart-Fall, der Sweep bucht nach (L7).
function carrierEndeIso(call, nowMs) {
  return new Date(cappedEndedAtMs(call, carrierEndMsOf(call, nowMs), MAX_CALL_DURATION_CAP_S)).toISOString();
}

// IEL-B4 (E7a): der Buchungsanker eines ueberbrueckten Inbound-Calls ist unser Telnyx-Bein
// (answeredAt aus /voice/incoming) - er wird weder nachgezogen noch geloescht. keepAnchor
// ohne Grund: applyAnsweredAnchor schreibt/loggt nichts, providerErrorReasonFor liefert
// null (das Bein ist zustande gekommen).
const TRAEGER_ANKER_BLEIBT = keepAnchor(null);
const ankerFuerPolitik = (politik, anbieterAnker) => (politik.ankerNachziehen ? anbieterAnker : TRAEGER_ANKER_BLEIBT);

// IEL-B4 (E7c): Poll-Frist je Politik. Fehlt der Nachlauf-Marker, gibt es KEINE eigene
// Frist (E7f: Gespraech laeuft evtl. noch; Obergrenze = re-armierter Max-Dauer-Cap).
function pollFristAbgelaufen(call, nowMs, politik) {
  if (politik.fristAnker === FRIST_ANKER.NACHLAUF_START) return nachlaufFristAbgelaufen(call, nowMs);
  return classifyCallTime(callUnderProviderCap(call), nowMs, ELEVENLABS_PROVIDER_MAX_DURATION_S).expired;
}

function nachlaufFristAbgelaufen(call, nowMs) {
  if (!call.elNachlaufStartedAt) return false;
  return nowMs - Date.parse(call.elNachlaufStartedAt) >= INBOUND_NACHLAUF_FRIST_MS;
}

// IEL-B4: der EINE Terminal-Schreiber des Conversation-Abschlusses als Thunk - Anker-
// Lieferant UND persistEnd (zweiter Aufruf idempotent, setCallEndedAt nur aus 'active').
// IEL-B5: auch der Terminal-Schreiber von cancel_call (routes/api-calls.js).
export function endeSchreiberFuer({ store, callId, status, politik, nowMs }) {
  if (politik.endeAnker === ENDE_ANKER.CARRIER_ENDE)
    return () => store.setCallEndedAt(callId, status, carrierEndeIso(store.getCall(callId), nowMs));
  return () => store.endCallRecord(callId, status);
}

// Ende-Anker, wenn der Poll ohne Anbieter-Ergebnis aufgibt (Frist, 3x 401/404).
function endeOhneErgebnisIso({ call, nowMs, politik }) {
  if (politik.endeAnker === ENDE_ANKER.CARRIER_ENDE) return carrierEndeIso(call, nowMs);
  return new Date(cappedEndedAtMs(callUnderProviderCap(call), nowMs, ELEVENLABS_PROVIDER_MAX_DURATION_S)).toISOString();
}

// Owner-Auftrag 15.08.2026 (Aufgabe 2): der Zombie-Zweig der Poll-Obergrenze (s.
// pollConversationResult in makeElevenLabsOutbound). MODUL-EBENE statt Factory-Closure
// (haelt makeElevenLabsOutbound unter der Zeilengrenze, G30) - alle Abhaengigkeiten reisen
// als EIN Objekt (F1). Derselbe Terminierungs-Ablauf wie terminateActiveCall (telephony/
// call-lifecycle.js) fuer EINEN EL-Call, nur mit dem ANBIETER-Deckel als HARTER Obergrenze
// des gekappten Ende-Ankers (callUnderProviderCap, S1-A: das MINIMUM aus anrufeigener Frist
// und Anbieter-Deckel, nie die volle Plattform-Max-Dauer): endActiveCall (Factory-Funktion, s.u.)
// uebernimmt den Ergebnisabruf-dann-Loeschversuch bereits selbst (fail-soft) - erreicht er
// den Anbieter doch noch, holt er die ECHTEN Werte (Transkript/Zusammenfassung/
// Buchungsanker) nach, statt dass dieser Zweig sie sich ausdenkt. persistEnd laeuft VOR
// hangUp (terminateAndBillCall) - endActiveCall liest call.endedAt also bereits GEKAPPT
// (Muster dort dokumentiert).
// G5: der gemeinsame Beende-Kern fuer BEIDE Faelle, in denen der Poll OHNE ein
// Anbieter-Ergebnis aufgibt - die Poll-Obergrenze (finishExpiredPoll) und ein DAUERHAFTER
// Abruf-Fehler (finishOnPermanentError, Teil 1). Persistiert+haengt auf+bucht ueber
// denselben EINEN Terminierungspfad wie jeder andere Beender.
async function finishWithoutProviderResult({
  store,
  terminateAndBillCall,
  billThunk,
  finishCall,
  endActiveCall,
  endCarrierCall,
  callId,
  nowMs,
  failureReason,
}) {
  const call = store.getCall(callId);
  if (!call) return;
  const politik = nachlaufPolitikFuer(call);
  // OUTBOUND-E2: BEIDE Aufgeben-Faelle sind result-unknown, NICHT "gescheitert": der Anruf
  // kann gelaufen sein, wir haben nur kein Ergebnis abholen koennen.
  // OUTBOUND-E3b (Befund C-A): der Grund wird INNERHALB von persistEndWithReason
  // geschrieben, NICHT mehr als freie Anweisung davor (Reihenfolge-Riegel).
  const endedAtIso = endeOhneErgebnisIso({ call, nowMs, politik });
  // E7b: Inbound-EL beendet das Telnyx-Elternbein, nie per DELETE (nimmt den Datensatz mit).
  const beenden = politik.beendeVersuch === BEENDE_VERSUCH.TRAEGER ? endCarrierCall : endActiveCall;
  await terminateAndBillCall({
    persistEnd: persistEndWithReason({
      store,
      callId,
      reason: failureReason,
      endCall: () => store.setCallEndedAt(callId, CALL_FAILED, endedAtIso),
    }),
    hangUp: () => beenden(callId),
    bill: billThunk(finishCall, store, callId),
    callId,
  });
}

async function finishExpiredPoll(deps) {
  await finishWithoutProviderResult({ ...deps, failureReason: POLL_TIMEOUT_REASON });
}

// TEIL 1 (Owner-Auftrag 15.08.2026, Fortsetzung Aufgabe 2): der Poll gibt auf, wenn
// PERMANENT_ERROR_STREAK_LIMIT DAUERHAFTE Anbieter-Fehler IN FOLGE angefallen sind (401/404,
// s. PERMANENT_FETCH_STATUS UND TEIL 2 dort), statt endlos weiterzupollen - genau der
// selbstgebaute Defekt aus dem Modul-Kopf (ein danach noch armierter Poll bzw. der
// Boot-Re-Arm liefe sonst bis zur Poll-Obergrenze gegen dasselbe 404). Der Aufrufer
// (pollConversationResult) ruft diese Funktion erst NACH Erreichen der Schwelle - hier
// selbst gibt es keine Zaehlung mehr zu pruefen. applyAnsweredAnchor loescht den
// vorlaeufigen Verbindungs-Stempel (answeredAt=null, S1-1-Richtung "im Zweifel GAR NICHTS")
// und vermerkt den Grund - wir haben nie ein metadata.call_duration_secs gesehen, der
// provisorische Stempel darf nicht als Buchungsanker stehen bleiben.
// IEL-B4 (E7a): fuer einen ueberbrueckten Inbound-Call bleibt der Anker unseres Telnyx-Beins
// stehen (ankerFuerPolitik) - das Bein ist zustande gekommen, nur das Ergebnis fehlt.
async function finishOnPermanentError(deps) {
  const politik = nachlaufPolitikFuer(deps.store.getCall(deps.callId));
  applyAnsweredAnchor(deps.store, deps.callId, ankerFuerPolitik(politik, clearAnchor(ANSWERED_UNCLEAR_REASON_PERMANENT_ERROR)));
  await finishWithoutProviderResult({ ...deps, failureReason: pollProviderErrorReason(deps.providerStatus) });
}

// Ergebnis persistieren, DANN terminalisieren, DANN den Anker nachziehen, ERST DANACH
// buchen - so sieht die Buchungskette den fertigen Stand. hangUp bleibt null: es gibt
// kein eigenes Provider-Leg mehr aufzulegen, das Gespraech ist beim Anbieter bereits
// beendet. MODUL-EBENE aus demselben Grund wie finishWithoutProviderResult (G30, haelt
// makeElevenLabsOutbound unter der Zeilengrenze); die Abhaengigkeiten reisen als EIN
// Objekt (F1).
//
// DER ANKER STEHT HIER, NICHT IM persistEnd-THUNK UNTEN: ohne eigenes hangUp (hangUp:
// null) ruft terminateAndBillCall bill() synchron direkt nach persistEnd() - es gibt kein
// Zeitfenster, in das sich ein Zwischenschritt haengen liesse. billThunk laedt den Call
// FRISCH aus dem Store, der Anker muss also VOR dem Aufruf unten stehen. Der erste Aufruf
// des Terminal-Schreibers (endCall) liefert zugleich endedAt fuer answeredAnchorOutcome; der
// zweite Aufruf im persistEnd-Thunk ist idempotent (setCallEndedAt greift nur aus
// status==='active') und bleibt aus Symmetrie zu jedem anderen Terminierungspfad stehen.
// S2: ended kann null sein (der Store findet den Call nicht mehr) - answeredAnchorOutcome
// faengt das selbst ab (s. dort), hier wird nur noch weitergereicht.
//
// Regulaeres Ende: es gibt hier keinen Loeschversuch, der Anbieter-Datensatz bleibt
// abrufbar -> der Beleg kann in KV2-9 auf 'belegt' nachreifen.
//
// OUTBOUND-E2: finishCall liest call.failureReason beim Notification-Bau (telephony/
// call-finish.js) und billThunk laedt den Call FRISCH aus dem Store - steht der Grund
// noch nicht am Datensatz, bleibt der Nutzertext "<Ziel> (Status: failed)", also genau
// der Zustand, den diese Etappe abstellt.
// OUTBOUND-E3b (Befund C-A): der Grund wird INNERHALB von persistEndWithReason
// geschrieben, NICHT mehr als freie Anweisung davor (Reihenfolge-Riegel). Der ERSTE
// Aufruf des Terminal-Schreibers bleibt UNANGETASTET - er ist der Anker-Lieferant fuer
// answeredAnchorOutcome (PM-7/PM-14).
//
// IEL-B4 (E7a/E17): die Politik waehlt Terminal-Schreiber (Carrier-Ende statt jetzt) und
// Anker (Traeger-Anker bleibt). Zwischen der frischen Pruefung im Poll-Takt und dem
// Terminal-Schreiber liegt kein await (E18-2).
async function finishFromConversation({ store, terminateAndBillCall, billThunk, finishCall, callId, nowMs, conversation }) {
  const politik = nachlaufPolitikFuer(store.getCall(callId));
  persistProviderResult({ store, callId, conversation, belegNachreifbar: true, politik });
  const endCall = endeSchreiberFuer({ store, callId, status: endStatusOf(conversation), politik, nowMs });
  const ended = endCall();
  const anchor = ankerFuerPolitik(politik, answeredAnchorOutcome(ended?.endedAt, conversation));
  applyAnsweredAnchor(store, callId, anchor);
  await terminateAndBillCall({
    persistEnd: persistEndWithReason({ store, callId, reason: providerErrorReasonFor(anchor, conversation), endCall }),
    hangUp: null,
    bill: billThunk(finishCall, store, callId),
    callId,
  });
}

// IEL-B4 (E7d/E18-1): Start-Tor des Nachlaufs. Der Marker wird IMMER gesetzt (set-once);
// eine Schleife startet NUR bei changed:true UND ohne Register-Eintrag. Laeuft bereits eine
// (Boot-Re-Arm), uebernimmt sie Frist und Ende-Anker ab dem naechsten Takt (E7f).
// Vorbedingung GEBUNDEN prueft der einzige Aufrufer routes/voice.js#/voice/status.
function startInboundNachlauf({ store, laufendeInboundPolls, pollConversationResult, callId }) {
  const { call, changed } = store.markInboundElNachlaufStarted(callId, new Date().toISOString());
  if (!changed) return;
  // Runbook 11: genau eine Zeile je Call (set-once-Marker), PII-frei.
  console.log(`[el-inbound] nachlauf gestartet (call=${callId})`);
  if (laufendeInboundPolls.has(callId)) return;
  laufendeInboundPolls.add(callId);
  void pollConversationResult(callId, call.elevenlabsConversationId);
}

// IEL-B5 (E10): Ergebnis-Teil des Bruecken-Beende-Thunks (telephony/call-termination.js#
// hangUpForCall). Laeuft NACH persistEnd und NACH dem Traeger-Hangup - der Call ist terminal,
// eine laufende Poll-Schleife schliesst deshalb nicht mehr ab (E18-2); diese Funktion ist dann
// der einzige Transkript-Schreiber. Kein DELETE (E7b), Beleg nachreifbar. Fail-soft:
// fetchConversationSoft wirft nie; ohne Ergebnis bucht terminateAndBillCall ohne Transkript.
async function awaitAndPersistInboundElResult({ store, fetchConversationSoft, pollMs, callId }) {
  const conversationId = store.getCall(callId)?.elevenlabsConversationId;
  if (!conversationId) return;
  for (let versuch = 1; versuch <= EL_TERMINATION_RESULT_ATTEMPTS; versuch += 1) {
    const { conversation } = await fetchConversationSoft(conversationId, callId, EL_ABORT_PROVIDER_TIMEOUT_MS);
    if (anbieterErgebnisFertig(conversation)) {
      const politik = nachlaufPolitikFuer(store.getCall(callId));
      persistProviderResult({ store, callId, conversation, belegNachreifbar: true, politik });
      return;
    }
    if (versuch < EL_TERMINATION_RESULT_ATTEMPTS) await sleep(pollMs);
  }
  console.warn(`[el-inbound] Ergebnis beim Beenden nicht abrufbar (call=${callId})`);
}

// S1-1 Fix (Owner-Auftrag 15.08.2026, stiller Totalausfall): das Nachziehen des
// Buchungsankers ist an ALLEN Terminierungswegen woertlich dieselben drei Schritte (G5) -
// hier EINMAL statt dreimal dupliziert. MODUL-EBENE aus demselben Grund wie
// finishWithoutProviderResult daneben (G30, haelt makeElevenLabsOutbound unter der
// Zeilengrenze); der store reist als erstes Argument, wie bei jedem anderen Helfer hier.
//
// Der unklare Fall (anchor.unclearReason gesetzt) landete bisher NUR im Store und war damit
// STUMM: faellt metadata.call_duration_secs beim Anbieter weg oder wird umbenannt, traefe das
// JEDEN EL-Anruf, waehrend wir voll zahlen - und niemand saehe es, ohne gezielt in den
// Datensaetzen zu suchen. Fehlerebene-Log mit greifbarem, grep-faehigem Marker
// ("Buchungsanker ohne Anbieter-Dauer"), callId + Grund - KEINE Rufnummer (Regel 4/5,
// dieselbe Zurueckhaltung wie im Fehlerlog von fetchConversationOutcome). NICHT-Buchen bei
// Unklarheit bleibt die ausdrueckliche Auflage des Eigentuemers (unveraendert) - nur der
// Zustand wird laut, statt still zu bleiben.
//
// S1-B: JEDER Ausgang ohne Anbieter-Dauer traegt jetzt einen Grund und eine Log-Zeile - auch
// die belegte Nicht-Rufannahme (Dauer 0), die bisher als einzige stumm blieb, obwohl auch sie
// nichts bucht. EIN Marker fuer alle (greifbar per grep), der GRUND unterscheidet die Faelle -
// kein Sammelbegriff, der zwei Sachverhalte auf ein Label zieht. keepExistingAnchor: der
// vorhandene Anker bleibt stehen, statt auf null gezogen zu werden (laufendes Gespraech, s.
// answeredAnchorOutcome) - dieser eine Ausgang schreibt den Anker NICHT.
function applyAnsweredAnchor(store, callId, anchor) {
  if (!anchor.keepExistingAnchor) store.trueUpAnsweredAt(callId, anchor.answeredAtIso);
  if (!anchor.unclearReason) return;
  store.recordAnsweredUnclearReason(callId, anchor.unclearReason);
  console.error(`[el-outbound] Buchungsanker ohne Anbieter-Dauer (call=${callId}): ${anchor.unclearReason}`);
}

// MODUL-EBENE aus demselben Grund wie finishWithoutProviderResult (G30, haelt
// makeElevenLabsOutbound unter der Zeilengrenze). G5: der EINE fail-soft Ergebnisabruf,
// den sowohl der Poll-Takt (pollConversationResult) als auch der Beende-Versuch
// (endActiveCall) brauchen - EIN Fehlerpfad statt zwei fast-identischer catch-Bloecke.
// Liefert IMMER ein Objekt statt zu werfen: ein Schluckauf beim Anbieter darf weder ein
// laufendes Gespraech fuer beendet erklaeren noch einen Beende-Versuch verhindern.
// Secret-frei geloggt (err.message, nie Rumpf/Schluessel), mit der server-eigenen callId
// als Korrelation.
//
// TEIL 1 (Owner-Auftrag 15.08.2026): `permanent` klassifiziert den Fehlschlag fuer den
// EINEN Aufrufer, der ihn braucht (pollConversationResult) - `err.providerStatus` kommt
// aus convai.js#assertConvaiOk (der Fehler-RUMPF wird NIE gelesen, nur der Status). Kein
// providerStatus (Netzfehler/Timeout) -> PERMANENT_FETCH_STATUS.includes(undefined) ist
// false -> voruebergehend, dieselbe sicherere Seite wie jeder ungemessene Status.
// endActiveCall braucht die Klassifikation nicht - ein einmaliger Bestversuch ohne eigene
// Wiederholung kennt "dauerhaft vs. voruebergehend" nicht.
async function fetchConversationOutcome({ account, conversationId, callId, timeoutMs }) {
  try {
    const conversation = await fetchConversation({ fetchImpl: fetch, account, conversationId, timeoutMs });
    return { conversation, permanent: false, providerStatus: null };
  } catch (err) {
    console.error(`[el-outbound] Ergebnisabruf fehlgeschlagen (call=${callId}):`, err?.message);
    // providerStatus reist mit, damit der Aufgeben-Grund den ANBIETER-Status nennen kann
    // (result-unknown:poll-provider-401 vs -404) statt zwei Faelle auf ein Wort zu ziehen.
    return {
      conversation: null,
      permanent: PERMANENT_FETCH_STATUS.includes(err?.providerStatus),
      providerStatus: err?.providerStatus ?? null,
    };
  }
}

// MODUL-EBENE aus demselben Grund wie finishWithoutProviderResult/fetchConversationOutcome
// (G30, haelt makeElevenLabsOutbound unter der Zeilengrenze). Der Zaehler selbst (die Map)
// bleibt PER-INSTANZ Closure-Zustand IN makeElevenLabsOutbound (s. dort, "der Zaehler
// gehoert an den LAUFENDEN Poll") - diese Funktion bekommt ihn als Parameter gereicht statt
// ihn selbst zu besitzen: eine modul-globale Map wuerde Call-IDs ueber VERSCHIEDENE
// Fabrik-Instanzen (z.B. mehrere Tests im selben Prozess) hinweg teilen.
//
// Der GESAMTE Streak-Lebenszyklus EINES Takts an einer Stelle (G30: eine Aufgabe, "was
// bedeutet dieses Abrufergebnis fuer den Zaehler"): ein NICHT-dauerhafter Takt (Erfolg oder
// voruebergehender Fehler) loescht einen angefangenen Streak - "IN FOLGE" heisst ohne
// Unterbrechung, ein zwischenzeitlicher 5xx/Timeout oder ein brauchbares Ergebnis ist der
// Beleg, dass der Anbieter wieder erreichbar ist, und darf einen frueheren 401/404 nicht in
// die naechste Serie mitnehmen. Ein dauerhafter Takt erhoeht den Zaehler und meldet, ob die
// Schwelle ERREICHT ist (Ja/Nein-Antwort UND die Zaehlung als Nebeneffekt gehoeren zusammen -
// der Zaehler existiert fuer genau diese eine Entscheidung, keine zweite Stelle liest ihn).
// Bleibt die Schwelle offen, steht der Zaehler fuer den naechsten Takt bereit; ist sie
// erreicht, wird er geloescht - ein spaeterer, fehlgeschlagener Poll desselben Calls startet
// nach einem etwaigen Neuversuch bei null, nicht am alten Stand.
function permanentErrorStreakExceeded(permanentErrorStreaks, callId, permanent) {
  if (!permanent) {
    permanentErrorStreaks.delete(callId);
    return false;
  }
  const streak = (permanentErrorStreaks.get(callId) || 0) + 1;
  if (streak < PERMANENT_ERROR_STREAK_LIMIT) {
    permanentErrorStreaks.set(callId, streak);
    return false;
  }
  permanentErrorStreaks.delete(callId);
  return true;
}

// Boot-Re-Arm (Owner-Auftrag 15.08.2026, Aufgabe 2): das Gegenstueck zu
// rearmActiveCallTimers (telephony/call-lifecycle.js) fuer DIESEN Weg. MODUL-EBENE aus
// demselben Grund wie finishExpiredPoll oben. scheduleResultPoll ist ein reiner
// In-Prozess-setTimeout, dessen EINZIGER Ausloeser originateCall ist - ein Neustart/Deploy
// nimmt ihn mit, ein aktiver EL-Call bleibt fuer immer "active", Transkript/Zusammenfassung
// fallen aus und der Max-Dauer-Cap (call-lifecycle.js, laeuft unabhaengig weiter) bucht am
// Ende nur die volle Kappungsdauer statt der echten. Persistiert ist
// elevenlabsConversationId - das genuegt: jeder AKTIVE Call, der es traegt, ist ein EL-Call
// ohne laufende Poll-Schleife.
//
// pollConversationResult SELBST traegt die Obergrenze (s. dort) - dieser Re-Arm ruft NUR
// denselben Einstiegspunkt wie jeder normale Tick, KEINE zweite Zeit-Pruefung hier (G5): ein
// laengst abgelaufener Call terminiert sich beim ersten Aufruf selbst statt einen weiteren
// Poll auszuloesen; ein laufender bekommt seine Schleife sofort zurueck (ein direkter Aufruf
// statt scheduleResultPoll - ein Neustart darf die Ergebnis-Erkennung nicht zusaetzlich um
// einen vollen Takt verzoegern).
//
// IEL-B4 (E7f): ein Rueckfall-Call wird nie re-armiert (sein Budget-Gespraech schliesst ueber
// /voice/status ab); jede re-armierte Inbound-EL-Schleife steht im Register (E18-1).
function rearmActiveConversationPolls({ store, pollConversationResult, laufendeInboundPolls }) {
  const activeElCalls = store
    .load()
    .calls.filter((call) => call.elevenlabsConversationId && pollDarfWirken(call));
  for (const call of activeElCalls) {
    if (bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN) laufendeInboundPolls.add(call.id);
    void pollConversationResult(call.id, call.elevenlabsConversationId);
  }
  if (activeElCalls.length)
    console.log(`[el-outbound] Poll-Schleife re-armiert: ${activeElCalls.length} Anrufe`);
}

/**
 * @param {{store: object, config: object, terminateAndBillCall: Function,
 *   billThunk: Function, finishCall: Function}} deps
 *   terminateAndBillCall/billThunk/finishCall = der EINE Terminierungspfad
 *   (telephony/call-termination.js) und die EINE callFinish-Instanz des Prozesses
 *   (INV-7) - der Ergebnisweg beendet Anrufe ueber denselben Gateway wie jeder andere
 *   Beender, nicht ueber einen zweiten, buchungsfreien Weg.
 */
// consultAllowedForCall kommt HEREIN statt importiert zu werden, und das ist keine Stilfrage:
// src/consult/gate.js liest das MODUL src/config.js, und dieses bindet beim Laden den
// Datenpfad. Ein statischer Import haette jede Datei, die outbound.js laedt, an diesen
// Pfad gebunden, BEVOR ein Test sein DATA_DIR setzen kann - am 2026-08-17 gemessen: ein
// Testfall schrieb daraufhin in das echte data/store.json statt in sein Temp-Verzeichnis.
// Dieselbe Haltung wie bei config/store: was Zustand hat, kommt herein.
export function makeElevenLabsOutbound({
  store,
  config,
  terminateAndBillCall,
  billThunk,
  finishCall,
  // Signatur (call, profile) -> boolean, s. consult/gate.js#consultAllowedForCall: DAS
  // Praedikat, das auch der Rueckfrage-Webhook fragt - eine Stelle, zwei Aufrufer.
  consultAllowedForCall = ohneRueckfrageTor,
  // Thema B: das Recherche-Tor, aus demselben Grund HEREINGEREICHT wie
  // consultAllowedForCall (research/registry.js liest das MODUL src/config.js).
  // Signatur (call, resolveProfile) -> boolean, s. elevenLabsLookupAvailableFor.
  lookupAvailableFor = ohneRechercheTor,
  // OUTBOUND-E5 (F3): der Absender-Rueckfall-Zaehler (s. ohneMetrikMeldung oben fuer die
  // Begruendung, warum er hereingereicht statt importiert wird).
  metrics = ohneMetrikMeldung,
  // IEL-B4 (E7b): Beende-Versuch des Telnyx-Elternbeins fuer einen ueberbrueckten Inbound-Call
  // (DI wie endActiveCall - keine Import-Kante elevenlabs -> telephony). Signatur (callId).
  endCarrierCall,
}) {
  // Immer frisch gelesen (nicht beim Bauen eingefroren): Tests uebersteuern die Gruppe
  // zur Laufzeit, und der Abholtakt darf nicht an einer Kopie von vor dem Boot haengen.
  const settings = () => config.voice.elevenLabsOutbound;

  function scheduleResultPoll(callId, conversationId) {
    setTimeout(() => void pollConversationResult(callId, conversationId), settings().resultPollMs);
  }

  // Duenner Delegator (G30, haelt diese Funktion unter der Zeilengrenze): die eigentliche
  // Fail-Soft-/Fehlerklassen-Logik sitzt MODUL-EBENE in fetchConversationOutcome (s.
  // dort) - hier wird nur `settings()` (Closure-Zugriff auf config) eingespeist.
  // timeoutMs optional (S1-3): fehlt er (regulaerer Poll-Takt), greift
  // convai.js#fetchConversation eigener Default (REQUEST_TIMEOUT_MS); der Abbruch-Pfad
  // (endActiveCall, s.u.) uebergibt EL_ABORT_PROVIDER_TIMEOUT_MS.
  function fetchConversationSoft(conversationId, callId, timeoutMs) {
    return fetchConversationOutcome({ account: settings(), conversationId, callId, timeoutMs });
  }

  // Jeder Takt liest den Call FRISCH: ein zwischenzeitlich beendeter Anruf (Max-Dauer-Cap,
  // cancel_call) stoppt die Schleife, ohne dass jemand sie kuendigen muesste.
  //
  // OBERGRENZE (Owner-Auftrag 15.08.2026, Aufgabe 2): unabhaengig von der Fehlerklasse
  // (s.u.) gibt es eine ZWEITE, zeitbasierte Grenze - die bereits vorhandene
  // Zeit-Einstufung (classifyCallTime, store/state-ops.js) angewandt auf den besessenen
  // Anbieter-Deckel (ELEVENLABS_PROVIDER_MAX_DURATION_S, s. Modul-Kopf): der Anbieter
  // selbst beendet jedes Gespraech spaetestens dort - ein Call, der laenger laeuft, ist
  // beim Anbieter nachweislich schon vorbei, weiterpollen bringt nichts mehr. Der Deckel
  // wirkt als HARTE Obergrenze (callUnderProviderCap, S1-A) - ohne diese Kappung gewinnt
  // die anrufeigene Frist (bis 1800 s), und der Poll liefe bis dorthin weiter.
  //
  // FEHLERKLASSE (TEIL 1, Owner-Auftrag 15.08.2026, Fortsetzung Aufgabe 2):
  // fetchConversationSoft liefert seit heute KEIN blosses "geklappt oder nicht" mehr,
  // sondern unterscheidet DAUERHAFT (401/404, s. PERMANENT_FETCH_STATUS) von
  // VORUEBERGEHEND. Vorher behandelte dieser Takt JEDEN Abruffehler (404/429/5xx/Timeout)
  // gleich als "noch nicht fertig" - fuer 429/5xx/Timeout richtig, fuer 401/404 falsch:
  // ein 401 (unser Schluessel taugt nicht) oder 404 (das Gespraech ist beim Anbieter nicht
  // mehr da) kann durch Weiterpollen NIE zum Erfolg fuehren. Ohne diese Unterscheidung
  // wuerde ein liegen gebliebener Zombie bis zur Zeit-Obergrenze oben weiterpollen - und
  // nach einem Boot-Re-Arm (rearmActiveConversationPolls unten) sogar nach JEDEM Neustart
  // erneut, der genau beschriebene Defekt aus dem Modul-Kopf (eigener DELETE-Loeschversuch
  // hinterlaesst ein 404, gegen das ein liegen gebliebener Poll danach noch laeuft).
  //
  // WIEDERHOLUNG VOR DEM AUFGEBEN (TEIL 2, Owner-Auftrag 15.08.2026, Fortsetzung Aufgabe
  // 2): ein EINZELNER dauerhafter Fehler beendet den Poll NICHT mehr - erst
  // PERMANENT_ERROR_STREAK_LIMIT Stueck IN FOLGE (s. dort). Ist beim Anbieter ein frisch
  // gestartetes Gespraech per GET kurz nicht auffindbar (unbelegt, aber nicht widerlegt),
  // wuerde ein einzelnes 404 sonst ein LAUFENDES Kundengespraech mitten im Satz kappen -
  // das Risiko ist asymmetrisch (ein paar Abfragen mehr kosten Bruchteile eines Cents, ein
  // gekapptes Gespraech kostet den Kunden). permanentErrorStreaks (Map, Closure-Zustand
  // dieser Fabrik) zaehlt NUR fuer den LAUFENDEN Poll-Lauf - kein Store-Feld, weil ein
  // Neustart die Lage ohnehin neu bewerten muss (rearmActiveConversationPolls startet
  // jeden Poll frisch) und ein ueberlebender Zaehler einen laengst vergangenen Fehlschlag
  // in diese neue Bewertung hineintragen wuerde.
  const permanentErrorStreaks = new Map();
  // E18-1: Prozess-Register der laufenden Inbound-EL-Schleifen (Closure-Zustand wie
  // permanentErrorStreaks: je Fabrik-Instanz, nie modul-global). Eintrag: Start-Tor und
  // Boot-Re-Arm; Austrag: jeder Takt-Ausgang ohne Folgetakt (hier, EINE Stelle).
  const laufendeInboundPolls = new Set();

  // IEL-B4: pollConversationResult ist der Wrapper um EINEN Takt (pollTakt) - er haelt das
  // Register (E18-1) an genau einer Stelle aktuell, auch wenn der Takt wirft. Der Riegel
  // pollDarfWirken (E7e) steht am Taktbeginn und fuer Inbound-EL zusaetzlich frisch nach dem
  // Abruf (E18-2); die Frist haengt an der Politik (Anbieter-Deckel vs. Nachlauf-Marker).
  async function pollConversationResult(callId, conversationId) {
    let ausgang;
    try {
      ausgang = await pollTakt(callId, conversationId);
    } finally {
      if (ausgang !== FOLGETAKT_GEPLANT) laufendeInboundPolls.delete(callId);
    }
  }

  async function pollTakt(callId, conversationId) {
    const call = store.getCall(callId);
    if (!pollDarfWirken(call)) return;
    const politik = nachlaufPolitikFuer(call);
    const nowMs = Date.now();
    // G5: EIN Deps-Objekt fuer BEIDE Faelle, in denen der Poll ohne Anbieter-Ergebnis
    // aufgibt (Zeit-Obergrenze, dauerhafter Fehler) - haelt diese Funktion unter der
    // Zeilengrenze (G30).
    const finishDeps = { store, terminateAndBillCall, billThunk, finishCall, endActiveCall, endCarrierCall, callId, nowMs };
    if (pollFristAbgelaufen(call, nowMs, politik)) return finishExpiredPoll(finishDeps);
    const { conversation, permanent, providerStatus } = await fetchConversationSoft(conversationId, callId);
    // E18-2: nach dem await frisch - danach bis setCallEndedAt kein await.
    if (politik.frischPruefenNachAbruf && !pollDarfWirken(store.getCall(callId))) return;
    if (permanentErrorStreakExceeded(permanentErrorStreaks, callId, permanent))
      return finishOnPermanentError({ ...finishDeps, providerStatus });
    if (!anbieterErgebnisFertig(conversation)) {
      scheduleResultPoll(callId, conversationId);
      return FOLGETAKT_GEPLANT;
    }
    await finishFromConversation({ ...finishDeps, conversation });
  }

  // TEIL A/Owner-Auftrag 15.08.2026 (Beende-Versuch beim Anbieter): der hangUp-Thunk des
  // EL-Pfades, eingespeist ueber telephony/call-termination.js#elevenLabsHangUpAction
  // (Aufrufer: der Max-Dauer-Cap UND cancel_call, DI statt Import-Kante telephony->
  // elevenlabs). REIHENFOLGE BINDEND (Kern des Auftrags): der Ergebnisabruf wird ZUERST
  // geholt und persistiert (Transkript + der Buchungsanker aus metadata.call_duration_secs,
  // dieselben Store-Mutatoren wie finishFromConversation), ERST DANACH kommt der
  // Loeschversuch (convai.js#endConversation) - ein DELETE nimmt beim Anbieter vermutlich
  // den kompletten Datensatz mit (Commit 08fc253), und was wir vorher nicht gesichert
  // haben, ist danach weg. endedAt liest FRISCH aus dem Store: der Aufrufer
  // (terminateAndBillCall) hat persistEnd() bereits ausgefuehrt, BEVOR hangUp() (und damit
  // diese Funktion) laeuft.
  //
  // FAIL-SOFT auf jeder Stufe (Absolute Regel 1): ein gescheiterter Ergebnisabruf
  // ueberspringt nur die Persistenz (fetchConversationSoft, s.o.) und haelt den
  // Loeschversuch NICHT auf - ein verpasster Datensatz ist kein Grund, den Versuch
  // aufzugeben. endConversation selbst wirft nie (s. convai.js).
  //
  // S1-3/S1-C: BEIDE Anbieter-Aufrufe hier bekommen EL_ABORT_PROVIDER_TIMEOUT_MS statt des
  // convai.js-Defaults (s. Konstante oben) - der Ergebnisabruf UND der Loeschversuch. Der
  // Loeschversuch laeuft UNCONDITIONAL, auch wenn die Frist des Ergebnisabrufs ablaeuft
  // (fetchConversationSoft faengt den Abbruch fail-soft ab und liefert null); die beiden
  // Fristen addieren sich im schlimmsten Fall, deshalb muss die zweite genauso kurz sein wie
  // die erste - sonst haengt der Abbruch 10 s + 2 Minuten.
  async function endActiveCall(callId) {
    const call = store.getCall(callId);
    const conversationId = call?.elevenlabsConversationId;
    if (!conversationId) return;
    const { conversation } = await fetchConversationSoft(conversationId, callId, EL_ABORT_PROVIDER_TIMEOUT_MS);
    if (conversation) {
      // Kriterium (c): unmittelbar nach diesem Block laeuft endConversation, ein DELETE
      // beim Anbieter, das den Datensatz vermutlich mitnimmt (s. Kommentar oben). Der
      // Beleg entsteht also in derselben Form wie am regulaeren Ende - aber er ist
      // strukturell nicht nachreifbar. UNBEDINGT, nicht abhaengig vom Ausgang des DELETE:
      // die sichere Richtung ist "reift nicht" (nachbuchen ja, erstatten nein, 4.4);
      // schlaegt das DELETE fehl, kostet uns das hoechstens eine ungenutzte Reifung, nie
      // eine unbelegte Erstattung.
      const politik = nachlaufPolitikFuer(call);
      persistProviderResult({ store, callId, conversation, belegNachreifbar: false, politik });
      applyAnsweredAnchor(store, callId, ankerFuerPolitik(politik, answeredAnchorOutcome(call.endedAt, conversation)));
    }
    await endConversation({
      fetchImpl: fetch,
      account: settings(),
      conversationId,
      timeoutMs: EL_ABORT_PROVIDER_TIMEOUT_MS,
    });
  }

  /**
   * Startet den Anruf beim Anbieter und haengt den ziehenden Ergebnisweg an. EIN Argument:
   * Ziel, Anliegen, Mandat und Mandant stehen bereits am Record (eine Quelle, kein zweiter
   * Satz Parameter, der davon abweichen koennte).
   *
   * WIRFT bei jedem Fehlschlag - der Aufrufer faehrt dann seinen EINEN Fehlerpfad
   * (terminateAndBillCall + Reserve-Freigabe). Die Kennung wird ERST NACH der Antwort des
   * Anbieters persistiert: ein gescheiterter Start hinterlaesst keine halbe Bindung, an
   * die sich spaeter ein fremder Rueckfrage-Webhook haengen koennte.
   */
  async function originateCall(call) {
    const el = settings();
    assertConfigured(el);
    // OC-P2: firstName liegt bereits im Tenant-Kontext - kein zweiter Reader.
    const { ownerName, firstName } = store.tenantContext(call.tenantId);
    // Eigener Reader (store.tenantTimezone), NICHT tenantContext - genau wie im
    // Bestandsweg (src/claude.js): die Zeitzone gehoert nicht in die LLM-/MCP-View.
    const time = callTimeContext({
      tenantTimezone: store.tenantTimezone(call.tenantId),
      callee: call.to,
    });
    const locale = callLocaleOf({ store, config, call, ownerName });
    // Der Torzustand kommt aus DERSELBEN Torkette wie alles andere (consultAllowedForCall -
    // Master-Schalter, Kontext-Kanal, Per-Tenant-Recht), nicht aus dem MCP-Aufruf und
    // nicht aus einem zweiten Nachbau: dieselbe Funktion, die der Webhook fragt, bevor er
    // eine Rueckfrage annimmt (routes/webhooks-elevenlabs.js) - seit P1 einschliesslich der
    // Owner-Bedingung, die dort gefehlt hat. OC-P2: den eigenen Auftraggeber zu fragen,
    // waehrend man mit ihm telefoniert, ist sinnlos - der Prompt deckt den
    // unavailable-Zustand vollstaendig ab ("REACHING YOUR PRINCIPAL DURING THIS CALL"), es
    // braucht keinen neuen Prompt-Text. Das Recherche-Tor bleibt unberuehrt.
    const consultAllowed = consultAllowedForCall(call, store.resolveProfile(call.tenantId));
    // Thema B: der Torzustand der Recherche - DIESELBE Funktion, die der Webhook fragt
    // (research/registry.js#elevenLabsLookupAvailableFor, per DI verdrahtet), mit der
    // Fassaden-Profilaufloesung als Parameter.
    const lookupAllowed = lookupAvailableFor(call, store.resolveProfile);
    // OUTBOUND-E5 (F3): Absender-Registrierung waehlen + Rueckfall LAUT machen (Modul-Ebene
    // unten, G30 - haelt diese Funktion unter der Zeilengrenze).
    const agentPhoneNumberId = absenderFuerAnruf({ store, call, el, metrics }).agentPhoneNumberId;
    // OUT-05-EL (Trockenlege-Naht, Aufgabe 1): GENAU vor dem einzigen Netzzugriff dieses
    // Wegs abgezweigt - wie fakeVoice in telephony/registry.js den kompletten Telnyx-
    // Transport ersetzt, ersetzt dieser Zweig NUR den EINEN POST gegen api.elevenlabs.io.
    // Alle Gates/Berechnungen oberhalb (assertConfigured, Zeitkontext, Sprach-/Stimmwahl)
    // laufen unveraendert - der Fake unterscheidet sich einzig in der Herkunft der
    // conversation_id.
    // Alles, was in den Anfragekoerper eingeht, EINMAL benannt (G19).
    // SEC-P4: die Mandanten-Dimension dieses Anrufs - EINMAL abgeleitet, rein, netzfrei.
    // Aus DEMSELBEN Geheimnis, gegen das der Webhook den Header prueft (kein zweites).
    const tenantToken = tenantToolToken({
      secret: config.voice.elevenLabsToolToken,
      tenantId: call.tenantId,
    });
    const anfrage = { el, call, ownerName, firstName, time, locale, consultAllowed, lookupAllowed, agentPhoneNumberId, tenantToken };
    const { conversationId } = config.safety.fakeOriginateElevenlabs
      ? startResultOf(fakeSipTrunkOutboundCallResponse())
      : await startOutboundCall(startCallRequest(anfrage));
    if (!conversationId) throw new Error("ElevenLabs-Anrufstart lieferte keine conversation_id");
    // AL-P1/EL-BL1: set-once am Record. Es ist dieselbe Kennung, ueber die der
    // Rueckfrage-Webhook (routes/webhooks-elevenlabs.js) den laufenden Anruf bindet.
    store.recordElevenlabsConversationId(call.id, conversationId);
    // HIER WIRD KEIN JOIN-SCHLUESSEL MEHR GESCHRIEBEN (Korrektur vom 17.08.2026, an Anruf
    // 2 gemessen): die Antwort des Anrufstarts fuehrt unter dem Namen sip_call_id
    // ElevenLabs' call_sid ("SCL_...") und NICHT den Wert, der auf dem Telnyx-Beleg steht
    // ("otb_...") - Herleitung s. convai.js#startResultOf. Der Schluessel kommt
    // ausschliesslich aus dem Ergebnisabruf (persistProviderResult), und das ist keine
    // Nachlaessigkeit, sondern die einzige gemessene Quelle. Was das kostet, wenn nie ein
    // Ergebnis eintrifft, steht dort.
    //
    // DAS VERBINDUNGSSIGNAL DIESES WEGES, NICHT (mehr) der Buchungsanker (S1-2a, Kommentar
    // auf den heutigen Stand gebracht - Commit 08fc253 hat die Bedeutung getrennt).
    // answeredAt traegt zwei Sachverhalte: "die Verbindung steht" (isInCallConsult/
    // mapStatus - genau das setzt dieser Aufruf) und "ab hier wird bezahlt"
    // (voiceMinutesOf). markAnswered ruft sonst nur routes/voice.js, und auf der SIP-Trunk-
    // Strecke des Anbieters kommt kein /voice-Webhook - ohne diesen Stempel bliebe
    // isInCallConsult die ganze Laufzeit blind (askedAt >= answeredAt) und der
    // Rueckfrage-Kostenriegel (MAX_IN_CALL_CONSULTS_PER_CALL) wirkungslos.
    //
    // DER ECHTE BUCHUNGSANKER wird am Gespraechsende gegen den Anbieter-Datensatz
    // NACHGEZOGEN (answeredAnchorOutcome/applyAnsweredAnchor, trueUpAnsweredAt) - VOR jeder
    // Buchung ueberschreibt er diesen vorlaeufigen Stempel vollstaendig. Die Richtung ist
    // seit 08fc253 "im Zweifel GAR NICHTS", nicht mehr "im Zweifel mehr": call_duration_secs
    // = 0 (niemand hat abgenommen) oder unbrauchbar/fehlend (S1-1: der Fall wird jetzt LAUT
    // geloggt statt still) loeschen den Anker auf null, statt die vorlaeufige Rufannahme
    // stehen zu lassen. Gebucht wird ueber DIESELBE Kette wie auf jedem anderen Weg
    // (terminateAndBillCall -> finishCall -> reconcileVoiceBudget); es entsteht KEIN
    // zweiter Kostenweg und kein zweites Gate.
    //
    // WARUM DIESER STEMPEL SCHON HIER SITZT: der Anrufstart des Anbieters ist BLOCKIEREND
    // ueber die ganze Klingelphase und antwortet erst, wenn der SIP-INVITE seine
    // endgueltige Antwort hat (am 15.08.2026 gemessen, s. convai.js REQUEST_TIMEOUT_MS:
    // 40,3 s blosses Klingeln vor der Antwort) - fuer das reine Verbindungssignal ist
    // "jetzt" (set-once, store/state-ops.js) nah genug an der Rufannahme; den WIRKLICHEN
    // Zeitpunkt liefert erst der Ergebnis-Abruf (s.o.), an dem sich die Buchung orientiert.
    store.markAnswered(call.id);
    scheduleResultPoll(call.id, conversationId);
  }

  return {
    originateCall,
    endActiveCall,
    rearmActiveConversationPolls: () => rearmActiveConversationPolls({ store, pollConversationResult, laufendeInboundPolls }),
    // IEL-B4/B5 (E7d): Aufrufer routes/voice.js#/voice/status bei GEBUNDEN.
    startInboundNachlauf: (callId) => startInboundNachlauf({ store, laufendeInboundPolls, pollConversationResult, callId }),
    // IEL-B5 (E10): Aufrufer telephony/call-termination.js#hangUpForCall (Cap, Geld-Wache, cancel_call).
    awaitAndPersistInboundElResult: (callId) =>
      awaitAndPersistInboundElResult({ store, fetchConversationSoft, pollMs: settings().resultPollMs, callId }),
  };
}
