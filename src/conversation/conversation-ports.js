// Gespraechsfuehrungs-Port: der Vertrag "fuehre ein Gespraech", den es bisher nicht gibt.
// Reine JSDoc-Typdefs, keine Laufzeit-Logik (Muster telephony/ports.js).
//
// ORT (Nachfassrunde, Gegner-Review): liegt bewusst NICHT unter src/telephony/, obwohl das
// Vorbild (ports.js) von dort stammt. telephony/ buendelt laut CLAUDE.md ausschliesslich
// Carrier-Abstraktionen (Leitung, SMS, Nummern, Medien) - dieser Vertrag beschreibt aber
// einen KI-Gespraechsdienst (eine fremde KI fuehrt das Gespraech; Telnyx traegt nur noch
// die Leitung). src/conversation/ ist deshalb der eigene, zutreffende Ort.
// telephony/ports.js bleibt unangetastet - dieser Port haengt sich an einen bereits
// stehenden Call (VoiceControl) an, ersetzt ihn nicht.
//
// GENAU EIN Adapter ist vorgesehen, kein Mehrfach-Provider-Betrieb. Der Schnitt existiert,
// damit (a) die Sicherheits-Pruefkette an dieser Naht haengen bleibt statt in
// anbieter-spezifischem Code zu wandern, und (b) ein spaeterer dritter Anbieter kein
// Umbau mehr ist. Dieser Port bildet NICHT den MCP-Vertrag (await_call_event,
// answer_consult, place_call, get_call_result, ...) neu ab und darf ihn nicht formen - er
// sitzt DARUNTER. Wie ConsultRequest/ConsultAnswer auf answer_consult abgebildet werden,
// ist Sache der Verdrahtung, nicht dieses Vertrags.
//
// RICHTUNG ist der Kern dieses Vertrags, deshalb ZWEI Typdefs statt einer:
// - ConversationControl: Hermes befiehlt dem Laufwerk (Gespraech starten/beenden).
// - ConversationCallbacks: das Laufwerk meldet sich BEI Hermes (Rueckfrage/Ergebnis) -
//   ueber einen eingehenden Webhook, NICHT ueber einen Rueckruf-Kanal (der ist tot,
//   s. consult/ports.js). Aufrufer dieser Methoden ist die (adapter-seitige, hier NICHT
//   definierte) Webhook-Route - sie reicht ein eingehendes Ereignis GENAU EINMAL an die
//   passende Methode durch. Ein Entwurf, der alle vier Methoden als "Aufrufe, die Hermes
//   taetigt" hinschreibt, verwischt genau diese Richtung - deshalb die Trennung in zwei
//   Typdefs statt einer gemeinsamen.
//
// VOKABULAR (Befund 6, Nachfassrunde): dieser Vertrag sprach zuvor von "FollowUp" - das
// uebrige Repo kennt fuer genau dieselbe Sache ausschliesslich "Consult" (consult/ports.js,
// gate.js, question.js, delivery.js). Umgestellt auf das bestehende Vokabular; "Rueckfrage"
// bleibt die deutsche Glosse dafuer, wie im Rest des Repos.

/**
 * @typedef {Object} StartConversationParams
 *   Befehl Hermes -> Laufwerk: eine KI-gefuehrte Unterhaltung auf einem BEREITS stehenden,
 *   abgenommenen Anruf beginnen. Wird ausschliesslich NACH bestandener Sicherheits-
 *   Pruefkette aufgerufen - der Port fuehrt selbst keine Gates aus, er ist die Stelle, an
 *   der sie vor dem Adapter-Aufruf haengen bleiben (statt in anbieter-spezifischem Code).
 * @property {string} callId             - der stehende Anruf (Origination lief bereits ueber
 *   telephony/ports.js - dieser Port haengt sich DARAN, ersetzt sie nicht)
 * @property {string} objective          - Auftrag/Anliegen, das die Gespraechsfuehrung
 *   verfolgen soll (fachlicher Text, kein Provider-Prompt-Format)
 * @property {string} disclosureSentence - der fest verdrahtete Offenlegungssatz (Absolute
 *   Regel 2 aus CLAUDE.md); MUSS als allererstes gesprochen werden - kein Ermessen des
 *   Laufwerks, keine Moeglichkeit, ihn zu unterdruecken
 * @property {string} [language]         - neutrale Gespraechssprache (Werte aus
 *   src/i18n/locales.js), kein Provider-String
 */

/**
 * @typedef {Object} StartConversationResult
 * @property {boolean} ok
 * @property {string} [reason] - nur bei ok:false; PII-frei, fuer Logs. ok:false heisst: der
 *   Befehl wurde abgelehnt oder kam nie an - das Gespraech ist NIE zustande gekommen.
 *   ok:true heisst NUR "angenommen", NICHT "die Gegenstelle hat ein Wort gehoert": ein
 *   Laufwerk kann ok:true liefern und die Verbindung bleibt trotzdem stumm. Dieser Fall ist
 *   ueber dieses Ergebnis ALLEIN nicht erkennbar - siehe ConversationOutcome.connected
 *   weiter unten, das genau diesen Fall (Befund 2) spaeter, beim Abschluss, trennt.
 */

/**
 * @typedef {Object} EndConversationParams
 *   Befehl Hermes -> Laufwerk: eine laufende Unterhaltung sofort beenden. MUSS idempotent
 *   sein - ein zweiter, auch ein GLEICHZEITIGER Aufruf auf einer bereits beendeten oder
 *   parallel beendeten Unterhaltung ist KEIN Fehler (Race zwischen Hermes-seitigem Timer
 *   und dem natuerlichen Ende des Laufwerks).
 * @property {string} callId
 * @property {string} reason - fachlicher Abbruchgrund, KEIN Provider-Enum, z.B. "max_dauer"
 *   (Absolute Regel 1), "sicherheitsabbruch" (Kill-Switch/Denylist), "auftraggeber_abbruch",
 *   "kein_lebenszeichen" (Laufwerk verstummt - s. Anmerkung unterhalb der beiden Typdefs)
 */

/**
 * @typedef {Object} ConversationControl
 *   Ausgehende Befehle Hermes -> Laufwerk.
 * @property {(params: StartConversationParams) => Promise<StartConversationResult>} startConversation
 *   Startet die Gespraechsfuehrung. WIRFT NIE fuer erwartbare Ablehnungen (die werden
 *   ok:false) - nur fuer echte Transportfehler.
 * @property {(params: EndConversationParams) => Promise<void>} endConversation
 *   Beendet die Gespraechsfuehrung. Die Leitung selbst gehoert weiterhin
 *   telephony/ports.js (VoiceControl.endCall/endCallViaCallControl) - dieser Aufruf endet
 *   NUR die KI-Fuehrung. Ein Fehlschlag hier darf den Leitungsabbau nicht verhindern
 *   (Defense-in-Depth: der Kill-Switch/die Max-Dauer muss auch wirken, wenn das Laufwerk
 *   nicht mehr antwortet).
 *   BEFUND 3 (Blocker, Nachfassrunde): haengt zum Zeitpunkt dieses Aufrufs noch eine ueber
 *   onConsultRaised gestellte Rueckfrage offen (keine Antwort ist eingetroffen), MUSS dieser
 *   Aufruf sie abschliessen statt sie haengen zu lassen - das Laufwerk wartet ab hier NICHT
 *   LAENGER auf eine Antwort und meldet stattdessen ueber onOutcomeDelivered ein Ergebnis
 *   mit achieved:null, dessen summary den uebergebenen reason erkennbar traegt. Ohne diese
 *   Zusage koennte ein echter Adapter die Leitung serverseitig offenhalten (er wartet ja
 *   noch auf die Antwort), obwohl Hermes den Anruf schon als beendet fuehrt.
 */

// FEHLERFALL "Laufwerk verstummt waehrend eines Gespraechs": dieser Vertrag hat ABSICHTLICH
// KEINE Puls-/Heartbeat-Methode - ein verstummtes Laufwerk kann seine eigene Stille nicht
// melden. Die Grenze ist deshalb eine Hermes-eigene Wanduhr-Frist (Absolute Regel 1, Muster
// CONSULT_WAIT_MS/CONSULT_OPEN_MS in consult/in-call.js): bleiben ueber diese Frist hinweg
// BEIDE Kanaele leer - keine ConversationCallbacks-Meldung UND keine Aktivitaet auf der
// zugrunde liegenden Leitung (telephony/ports.js: WebhookEvents.parseLifecycleEvent) - ruft
// Hermes von sich aus endConversation({callId, reason: "kein_lebenszeichen"}) auf. Das ist
// Defense-in-Depth, keine Kooperation des Laufwerks vorausgesetzt.

/**
 * @typedef {Object} ConsultRequest
 *   Meldung Laufwerk -> Hermes (eingehender Webhook): der Agent will den Auftraggeber etwas
 *   fragen. Fachlicher Nachfolger der TURN-SCHLEIFEN-Aufhaengung aus consult/in-call.js -
 *   dieselbe Rueckfrage, neu ausgeloest.
 * @property {string} callId
 * @property {string} requestId - Kennung DIESER KONKRETEN Rueckfrage, vom Laufwerk vergeben
 *   und stabil fuer ihren gesamten Lebenszyklus. PFLICHT (Befund 1, Blocker): ohne sie kann
 *   eine Implementierung eine eintreffende Antwort nicht der richtigen von mehreren offenen
 *   Rueckfragen zuordnen - s. die Anmerkung zu onConsultRaised, wo genau dieser Fehler
 *   beschrieben ist. NACHFASSRUNDE (V1): mehrere Rueckfragen KOENNEN gleichzeitig offen sein
 *   und in ANDERER Reihenfolge beantwortet werden, als sie gestellt wurden - die Zuordnung
 *   MUSS ueber requestId laufen, NIE ueber die Reihenfolge, in der Antworten eintreffen
 *   (eine Implementierung, die nach Ankunftsreihenfolge zuordnet statt nach requestId zu
 *   suchen, verletzt diesen Vertrag, auch wenn requestId brav mitgeschickt wird).
 * @property {string} question - UNGEPRUEFTER Fragetext des Laufwerks. Sanitisierung
 *   (Zitat-Riegel, Laengenbegrenzung) ist Aufgabe von consult/question.js und wird HIER
 *   NICHT VERDOPPELT - eine Implementierung von onConsultRaised ruft sanitizeConsultQuestion
 *   auf, bevor sie ueberhaupt eine Rueckfrage eroeffnet.
 * @property {string[]} transcriptSoFar - PFLICHT (Befund 4, Blocker), NIE ein leeres Array:
 *   der bisherige Gespraechsverlauf dieses Anrufs, eine Zeile je bisherige Aeusserung, in
 *   chronologischer Reihenfolge. Grund fuer die Pflicht: sanitizeConsultQuestion (consult/
 *   question.js) prueft ueber containsVerbatimQuote, ob die Frage woertlich aus dem
 *   Transkript zitiert - bei LEEREM Transkript-Array liefert diese Pruefung sofort false
 *   (fail-OPEN, ohne Fehler, ohne Warnung). Bei DIESEM Anbieter liegt das vollstaendige
 *   Transkript erst NACH dem Anruf vor, nicht live wie beim heute produktiven Pfad - ohne
 *   dieses Feld haette der Zitat-Riegel an dieser Naht also NIE Eingabe und waere lautlos
 *   wirkungslos, ohne dass irgendetwas rot wird. NICHT src/consult/question.js aendern, um
 *   das zu kompensieren - es laeuft dort korrekt, weil das Transkript dort live gefuellt
 *   ist; die Kompensation gehoert hierher, an die Anfrage. NACHFASSRUNDE (V5): ein leeres
 *   Array ist KATEGORISCH ausgeschlossen, nicht nur "meistens gefuellt" - StartConversation-
 *   Params.disclosureSentence MUSS als allererstes gesprochen werden (Absolute Regel 2),
 *   BEVOR ueberhaupt eine Rueckfrage entstehen kann; transcriptSoFar enthaelt deshalb IMMER
 *   mindestens diese eine Zeile. Es gibt keinen legitimen Fall "noch kein Wort gefallen" -
 *   ein Adapter, der hier ein leeres Array liefert, verletzt den Vertrag, unabhaengig vom
 *   Zeitpunkt der ersten Rueckfrage. Eine Implementierung von onConsultRaised reicht dieses
 *   Feld unveraendert als transcript-Argument an sanitizeConsultQuestion durch.
 */

/**
 * @typedef {Object} ConsultAnswer
 *   Ergebnis von ConversationCallbacks.onConsultRaised - die Antwort, die auf demselben Weg
 *   zurueck ans Laufwerk geht (der Webhook-Aufruf ist ein Frage-Antwort-Zyklus, kein
 *   Feuer-und-Vergessen).
 * @property {"answered"|"rejected"|"timeout"} kind - Ergebnis-Diskriminator mit fester Menge
 *   (Befund 5, Blocker/G26). Eine fruehere Fassung vermischte "Gate/Sanitisierung hat
 *   abgelehnt" und "niemand hat rechtzeitig geantwortet" in einem einzigen answered:false,
 *   unterschieden nur ueber einen freien Textstring - fuer das Produkt zwei verschiedene
 *   Lagen, die eine Struktur braucht statt Freitext. "answered": die Rueckfrage wurde
 *   beantwortet, facts enthaelt die Fakten. "rejected": Gate (consult/gate.js) oder
 *   Sanitisierung (consult/question.js) hat die Rueckfrage VOR dem Warten abgelehnt - sie
 *   wurde nie gestellt. "timeout": das Antwortfenster ist ohne Antwort verstrichen -
 *   Zeitablauf ist ein GUELTIGES Ergebnis (Muster ConsultDelivery.waitForEvent), kein Fehler.
 * @property {string[]} facts - bei kind:"answered" die Antwort-Fakten (Vokabular aus
 *   consult/in-call.js:acceptConsultAnswer); bei "rejected"/"timeout" ein LEERES Array, NIE
 *   undefined - der Aufrufer darf facts unabhaengig vom Ausgang immer iterieren.
 * @property {string} [reason] - nur bei kind!=="answered"; PII-frei, fuer Logs; ergaenzt den
 *   Diskriminator um ein Detail (z.B. der konkrete Gate-Grund), ersetzt ihn nicht.
 * @property {{consultId: string, holdMs: number, deliveredAfterMs: number|null,
 *   ackedAfterMs: number|null}|null} [abortTrace] - nur beim GESTAFFELTEN Abbruch (P2-Stufe
 *   0/1/2) gesetzt, sonst null: die inhaltsfreie Spur des gescheiterten Halts (P3). Reine
 *   Kennungen und Millisekunden - NIE Gespraechsinhalt. Sie ist Telemetrie FUER HERMES und
 *   geht NICHT an das Laufwerk zurueck; null in den Spannen heisst "diese Stufe wurde nie
 *   erreicht", nicht "0 ms".
 */

/**
 * @typedef {Object} ConversationOutcome
 *   Meldung Laufwerk -> Hermes (eingehender Webhook): die Unterhaltung ist aus Sicht des
 *   Laufwerks abgeschlossen.
 * @property {string} callId
 * @property {boolean} connected - eigenes Signal (Befund 2, Blocker). Ohne dieses Feld liess
 *   sich "es kam NIE ein Gespraech zustande" (niemand hat abgenommen, besetzt, Anrufbeant-
 *   worter/Ansage hat abgewiesen) nicht von "das Gespraech kam zustande, blieb aber ergebnis-
 *   los" trennen - genau die Trennung, die telephony/failure-reason.js auf der Telnyx-Seite
 *   bereits zieht (und dort gerade erst nachgebessert wurde). true: es gab ein Gespraech,
 *   achieved/summary werten es aus. false: es kam NIE zu einem Gespraech - achieved ist in
 *   diesem Fall IMMER null (nichts zu bewerten), summary beschreibt nur den technischen
 *   Ausgang.
 * @property {string} [neverConnectedReason] - NUR wenn connected:false; lesbarer, fachlicher
 *   Grund aus DEMSELBEN Vokabular wie telephony/failure-reason.js ("no-answer"|"busy"|
 *   "canceled") - kein zweites System.
 * @property {boolean|null} achieved - hat die Gespraechsfuehrung den Auftrag erfuellt?
 *   null = unbekannt/nicht auswertbar (u.a. IMMER bei connected:false) - NIE als false lesen.
 * @property {string} summary - kurze Ergebniszusammenfassung (fachlicher Text)
 */

/**
 * @typedef {Object} ConversationCallbacks
 *   Eingehende Meldungen Laufwerk -> Hermes. Aufrufer ist NICHT Hermes selbst, sondern die
 *   (adapter-seitige) Webhook-Route, die einen eingehenden Aufruf des Laufwerks genau
 *   einmal an die passende Methode durchreicht - Muster WebhookEvents (Port 5) in
 *   telephony/ports.js, mit einem Unterschied: WebhookEvents ist rein (Parsing ohne IO),
 *   diese beiden Methoden sind es NICHT - sie sprechen den Consult-Zustand an bzw.
 *   schreiben den Gespraechsabschluss fest.
 *
 *   BEFUND (kein Nachbau, nur Vermerk): consultAllowedFor (consult/gate.js) ist
 *   unveraendert wiederverwendbar - reine Schnittmenge aus Schalter/Kontext-Kanal/Tenant-
 *   Freigabe, ohne Turn-Kopplung. consultAvailableFor (consult/in-call.js) dagegen bindet
 *   zusaetzliche TURN-SCHLEIFEN-Fakten ein (consultClientIsPolling, die Alleinstellung
 *   "genau ein Werkzeug je Runde"), die es in einer Webhook-Aufhaengung so nicht mehr gibt.
 *   Eine Implementierung von onConsultRaised setzt sich deshalb NEU aus denselben
 *   Bausteinen zusammen (gate.js + question.js + delivery.js), statt consultAvailableFor
 *   pauschal zu uebernehmen.
 * @property {(request: ConsultRequest) => Promise<ConsultAnswer>} onConsultRaised
 *   Haelt offen, bis der Auftraggeber geantwortet hat oder das Fenster verstreicht.
 *   BEFUND 1 (Blocker, Nachfassrunde): eine fruehere Fassung dieses Kommentars behauptete
 *   hier "dieselbe Wartemechanik wie ConsultDelivery" - das ist als Bauanleitung FALSCH.
 *   ConsultDelivery.waitForEvent stoppt einzig auf store.pendingConsult(callId,
 *   afterEventId), und das erkennt IRGENDEINE neu entstandene, unbeantwortete Rueckfrage -
 *   nicht zwingend GENAU DIE, die dieser Aufruf selbst eroeffnet hat. Als alleiniges
 *   Stop-Praedikat uebernommen, wuerde die Wartemechanik sofort auf die eigene, gerade erst
 *   gestellte Frage ansprechen, statt auf eine tatsaechliche Antwort zu warten -
 *   pendingConsult() ALLEIN ist hier das FALSCHE Praedikat. Eine Implementierung MUSS die
 *   eintreffende Antwort ueber request.requestId der KONKRETEN Anfrage zuordnen (z.B. indem
 *   sie den fuer diese Anfrage angelegten Consult-Eintrag ueber seine eigene Kennung
 *   wiedererkennt), nicht darueber, dass irgendeine Frage offen ist. Ansonsten gilt weiter:
 *   angestossen vom Webhook statt von der eigenen Turn-Schleife (Zustand, Gate und
 *   Sanitisierung bleiben, wo sie sind). WIRFT NIE - eine nicht zulaessige oder abgelaufene
 *   Rueckfrage ist kind:"rejected"/"timeout", kein Reject.
 * @property {(outcome: ConversationOutcome) => Promise<void>} onOutcomeDelivered
 *   Uebernimmt das Ergebnis und schliesst das Gespraech aus Store-Sicht ab (call.status
 *   verlaesst "active"). Genau dieser Uebergang ist es, den
 *   ConsultDelivery.waitForEvent bereits als "done" erkennt (call.status !== "active") -
 *   kein neues Ereignisvokabular noetig, der bestehende Kanal traegt das Ergebnis
 *   unveraendert weiter. Trifft nie ein (Laufwerk haengt vorher auf) -> der Anruf gilt
 *   trotzdem als beendet, nur ohne strukturiertes Ergebnis (Fallback: Bestandsverhalten
 *   vor diesem Port).
 */
export {};
