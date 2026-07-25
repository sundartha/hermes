// Telefonie-Ports: Vertraege fuer Provider-unabhaengige Telefonie. P0 hat genau
// einen Adapter (Twilio). Reine JSDoc-Typdefs, keine Laufzeit-Logik.

/**
 * @typedef {Object} OriginateParams
 * @property {string} from           - Absender-Nummer (E.164), aktive Store-Nummer des Tenants
 * @property {string} to             - Zielnummer (E.164, bereits gegated)
 * @property {string} url            - TwiML-Webhook-URL (/voice/outbound?callId=...)
 * @property {string} statusCallback - Status-Callback-URL (/voice/status?callId=...)
 * @property {string[]} statusCallbackEvent - z.B. ["answered","completed"]
 * @property {string} method         - HTTP-Methode fuer die Webhooks ("POST")
 * @property {number} timeLimit      - Max-Gespraechsdauer in Sekunden
 */

/**
 * @typedef {Object} OriginateResult
 * @property {string} sid - Provider-seitige Call-ID (Twilio CallSid)
 */

/**
 * @typedef {Object} CallControlOriginateParams
 *   Origination ueber Telnyx Call Control (AI-Assistant-Pfad, P4) statt TeXML. Call Control
 *   buendelt die Event-Webhooks in EINER webhook_url (kein getrenntes url/statusCallback).
 * @property {string} from         - Absender-Nummer (E.164), aktive Store-Nummer des Tenants
 * @property {string} to           - Zielnummer (E.164, bereits gegated)
 * @property {string} [webhookUrl] - Call-Control-Event-Webhook (call.answered/speak.ended/hangup, P4.5)
 * @property {string} [method]     - HTTP-Methode fuer den Webhook ("POST")
 * @property {number} [timeLimit]  - Max-Gespraechsdauer in Sek. (Defense-in-Depth; harter Timer bleibt server.js)
 */

/**
 * @typedef {Object} CallControlResult
 * @property {string} callControlId - Call-Control-ID (data.call_control_id). EIGENES Feld,
 *   NICHT sid ueberladen: Boot-Recovery (P6) adressiert den Hangup ueber diese ID-Form.
 */

/**
 * @typedef {Object} StartAssistantParams
 * @property {string} callControlId    - Ziel-Call (aus originateViaCallControl)
 * @property {string} assistantId      - Telnyx-AI-Assistant-Referenz (Caller/P5/P7 liefert sie)
 * @property {string} [language]       - NEUTRALE Gespraechssprache (call.language: "de"|"fr"|"en",
 *   Werte aus src/i18n/locales.js) - KEIN Provider-String. Der Adapter mappt sie intern auf den
 *   STT-Sprach-Hint (afix-p2/R2). Fehlt der Wert, sendet der Adapter KEIN transcription-Feld ->
 *   Body byte-identisch zum Bestand. Nur der Ingest-Pfad reicht call.language durch; der
 *   Inbound-Pfad bleibt in dieser Phase BYTE-IDENTISCH (STT-Sprach-Hint dort folgt in P6).
 */

/**
 * @typedef {Object} InboundRequest
 * @property {Object<string,string>} headers - Request-Header (lowercase keys, z.B. x-twilio-signature)
 * @property {Buffer} rawBody  - unveraenderter Roh-Body; fuer Twilio-HMAC ungenutzt,
 *                               fuer die Telnyx-Ed25519-Pruefung (signiert ueber
 *                               `${telnyx-timestamp}|${rawBody}`) noetig
 * @property {string} url      - vollstaendige signierte URL (publicUrl + originalUrl)
 * @property {Object<string,string>} params - geparste Form-Params (req.body) fuer den HMAC
 */

/**
 * @typedef {Object} InboundSignatureVerifier
 * @property {(req: InboundRequest) => boolean} verifyInboundSignature
 *   Prueft die Provider-Signatur eines Inbound-Webhooks. FAIL-CLOSED: bei
 *   fehlender/falscher Signatur oder fehlender Config -> false (wirft nie). Die
 *   registry waehlt den Adapter HEADER-basiert (nicht ueber provider/To), weil die
 *   Signatur die erste fail-closed-Stufe ist und VOR dem To-Routing laeuft.
 *   Twilio: HMAC-SHA1 ueber url + sortierte params (rawBody ungenutzt).
 *   Telnyx: Ed25519 ueber `${telnyx-timestamp}|${rawBody}` (base64) + Replay-Fenster.
 */

/**
 * @typedef {Object} VoiceCostRecordsParams
 * @property {string} legId     - provider-seitige Leg-Referenz des Calls
 * @property {string} startedAt - ISO-Zeitstempel Call-Beginn (Fensteruntergrenze)
 * @property {string} endedAt   - ISO-Zeitstempel Call-Ende (Fensterobergrenze)
 */

/**
 * @typedef {Object} VoiceCostRecord
 * @property {string} recordType     - Provider-Kostenart (sip-trunking, text-to-speech, ...)
 * @property {number} costMicroCents - GANZZAHL Mikro-Cents in der Provider-Waehrung.
 *   NICHT EUR: die Umrechnung ist ausdruecklich NICHT Teil dieses Ports (D5).
 * @property {string} currency       - Provider-Waehrung des Records (ISO-4217, Grossschreibung)
 * @property {number|null} billedSec - abgerechnete Sekunden; null = nicht auslesbar
 * @property {number|null} ttsCharacters - ElevenLabs-Zeichen (number_of_characters) des
 *   Belegs; null = kein ElevenLabs-text-to-speech-Beleg oder nicht auslesbar. NIE 0 als
 *   Ersatz fuer "unbekannt".
 * @property {string} legId          - Leg-Referenz, gegen die der Record aufgeloest wurde
 */

/**
 * @typedef {Object} VoiceCostRecordsResult
 * @property {boolean} ok
 * @property {VoiceCostRecord[]} [records] - nur bei ok:true; leere Liste = "nichts gefunden"
 * @property {string} [reason]             - nur bei ok:false; PII-frei, fuer Logs
 */

/**
 * @typedef {Object} VoiceCostRecordPoolParams
 * @property {string} [since] - ISO-Untergrenze des Einzugs. AB KE-P3 WIRKSAM: bindet
 *   ausschliesslich die Seitenschleife (Abbruch, sobald eine GANZE Seite aelter ist),
 *   NIE die Query (ein geratener Zeitfilter liefert HTTP 200 mit 0 Treffern) und NIE den
 *   Pool-Inhalt. Fehlt/unbrauchbar -> keine Schranke: mehr Anfragen, nie weniger Belege.
 *   Gesetzt wird er seit KE-P5 vom Sweep: aeltester endedAt der Kandidaten minus Marge.
 * @property {{reserveSlot: () => Promise<void>, waitForWindowReset: (hintMs?: number|null) => Promise<void>}} [throttle]
 *   Drossel am gemessenen Minutenfenster des Providers (40 Anfragen je FIXER UTC-Minute,
 *   Reset auf :00). Default ist die prozessweite Drossel des Adapters mit echter Uhr und
 *   echtem Timer; PRODUKTIVE Aufrufer setzen den Parameter NIE. Er existiert, damit ein
 *   Test die Uhr injizieren kann, statt eine reale Minute zu warten.
 */

/**
 * @typedef {Object} VoiceCostRecordPool
 * @property {boolean} ok
 * @property {object[]} [raw]     - nur bei ok:true; ROHE Provider-Belege, KEINEM Call zugeordnet
 * @property {boolean} [complete] - nur bei ok:true; false = die Menge ist nachweislich
 *   unvollstaendig (erreichbar ab KE-P3, Seitenobergrenze). Fuer den Verbraucher dasselbe
 *   wie ok:false - aus einer Untermenge laesst sich keine Rueckerstattung beweisen.
 * @property {string} [reason]    - nur bei ok:false; PII-frei, fuer Logs
 * @property {number} requests - HTTP-Anfragen dieses Abrufs (inkl. der einen 429-Wiederholung).
 *   IMMER gesetzt, auch bei ok:false - der Abruf hat das Kontingent auch dann verbraucht.
 * @property {number} pages    - eingesammelte Seiten (<= requests).
 */

/**
 * @typedef {Object} VoiceControl
 * @property {(params: OriginateParams) => Promise<OriginateResult>} originateCall
 *   Startet einen Outbound-Call (TeXML). Heute: calls.create(...).
 * @property {(providerCallSid: string) => Promise<void>} endCall
 *   Beendet einen laufenden Call (TeXML). Heute: calls(sid).update({status:"completed"}).
 * @property {(params: CallControlOriginateParams) => Promise<CallControlResult>} [originateViaCallControl]
 *   Call-Control-Variante der Origination (AI-Assistant-Pfad, P4). Aktuell NUR Telnyx
 *   implementiert (wie NumberProvisioning); Twilio hat kein Call-Control-Pendant. Liefert callControlId.
 * @property {(callControlId: string) => Promise<void>} [endCallViaCallControl]
 *   Call-Control-Hangup (POST /v2/calls/{id}/actions/hangup). ZUSAETZLICH zu endCall (TeXML,
 *   unveraendert). Telnyx-only.
 * @property {(params: StartAssistantParams) => Promise<void>} [startAssistant]
 *   Haengt den Telnyx-AI-Assistant an den Call-Control-Call an (ai_assistant_start). Telnyx-only.
 * @property {(params: {callControlId: string, text: string, voiceProfile: string, useAssistantVoice?: boolean}) => Promise<void>} [speak]
 *   Deterministischer Call-Control-Speak-Node (Disclosure vor ai_assistant_start, P4.5). Telnyx-only.
 *   useAssistantVoice (optional, Default false): SEMANTISCHER Wunsch "sprich mit derselben
 *   Stimme, die der AI-Assistant danach benutzt, sofern der Adapter sie kennt" - KEIN
 *   Provider-String; das Mapping auf die Provider-Payload lebt adapter-intern. Fehlt der
 *   Parameter (Inbound-Pfad), ist das Verhalten byte-identisch zum Bestand.
 * @property {(params?: VoiceCostRecordPoolParams) => Promise<VoiceCostRecordPool>} [fetchCostRecordPool]
 *   Roh-Belege EINES Sweeps (Provider-CDR), gedacht fuer EINEN Aufruf je Sweep VOR der
 *   Kandidatenschleife: der Abruf ist schleifeninvariant (nur filter[record_type] +
 *   page[size] + page[number]), die Zuordnung nicht. Je Typ wird aufsteigend geblaettert,
 *   bis die letzte Seite erreicht, das Fenster verlassen oder die Seitenobergrenze
 *   getroffen ist; letzteres liefert complete:false. Telnyx-only wie
 *   originateViaCallControl; fehlt die Methode, faellt der Aufrufer auf "kein Abgleich"
 *   zurueck (konservativer Fall).
 *   Der Abruf ist gedrosselt und kann deshalb bis zur naechsten vollen Minute blockieren.
 *   WIRFT NIE. ok:false heisst "nicht gemessen" und NIEMALS "Kosten = 0".
 * @property {(pool: VoiceCostRecordPool, params: VoiceCostRecordsParams) => VoiceCostRecordsResult} [assignCostRecords]
 *   Ordnet die Belege EINES Pools genau EINEM Call zu - SYNCHRON und ohne Netz (PM-5).
 *   Gehoert mit fetchCostRecordPool zusammen: ein Adapter implementiert beide oder keine.
 *   WIRFT NIE; leere Record-Liste bei ok:true heisst "nichts zugeordnet", nie "0 Kosten".
 */

/**
 * @typedef {Object} SmsParams
 * @property {string} from - Absender-Nummer (E.164), aktive Store-Nummer des Tenants
 * @property {string} to   - Empfaenger-Nummer (E.164)
 * @property {string} body - Nachrichtentext (bereits auf 1500 Zeichen gekuerzt)
 */

/**
 * @typedef {Object} Messaging
 * @property {(params: SmsParams) => Promise<void>} sendSms
 *   Sendet eine SMS. Heute: messages.create(...).
 */

/**
 * @typedef {Object} VoiceRenderer
 * @property {(directives: object[]) => string} renderDirectives
 *   Uebersetzt eine Liste neutraler Direktiven (directives.js) in einen
 *   Provider-Antwort-Body (Twilio: TwiML). Der einzige Ort mit Provider-Markup.
 */

/**
 * @typedef {Object} AvailableNumber
 * @property {string} e164 - verfuegbare Rufnummer (E.164)
 */

/**
 * @typedef {Object} OrderResult
 * @property {string} e164             - die bestellte Rufnummer (E.164)
 * @property {string} providerNumberId - provider-seitige Nummern-ID (release)
 */

/**
 * @typedef {Object} NumberProvisioning
 *   Port 3 (Onboarding/Provisioning-Pfad, NICHT Hot-Path). Loest ECHTES Geld aus
 *   (Nummernkauf) - deshalb gedeckelt durch config.provisioning.maxNumbers (Kosten-Notbremse,
 *   ersetzt das uebersprungene Stripe-Schloss) und nur ueber die Onboarding-Route
 *   hinter Auth + Gates erreichbar. Alle Methoden werfen MIT Kontext (P8), aber NIE
 *   mit dem API-Key (Regel 4).
 * @property {(params: {countryCode: string, type?: string, limit?: number}) => Promise<AvailableNumber[]>} searchNumbers
 *   Sucht kaufbare Rufnummern beim Provider (Anzeige/Auswahl vor dem Kauf).
 * @property {(params: {e164: string, connectionId?: string, idempotencyKey?: string}) => Promise<OrderResult>} orderNumber
 *   Kauft eine voll routbare Nummer: connectionId wird im Order-Body gesetzt (Voice-Routing
 *   in EINEM Schritt). Idempotency-Key (number-id-basiert) -> Retry kauft nie doppelt.
 * @property {(providerNumberId: string) => Promise<void>} releaseNumber
 *   Gibt eine Nummer beim Provider frei (Rollback bei Fehlern; kein bezahlter Orphan).
 */

/**
 * @typedef {Object} MediaFrame
 *   Neutrales Media-Stream-Frame (Port 4). KEIN Provider-Feld (kein streamSid/
 *   stream_id) im Vertrag - streamRef ist die neutrale Stream-Referenz.
 * @property {"start"|"media"|"stop"|"other"} event
 * @property {string} [streamRef]       - neutrale Stream-Referenz (Twilio: streamSid; Telnyx: stream_id)
 * @property {string} [callId]          - Call-ID aus den start-Parametern (Anti-Hijack-Lookup)
 * @property {string} [streamToken]     - stream_token aus den start-Parametern (safeEqual-Pruefung)
 * @property {string} [providerCallRef] - provider-seitige Call-Referenz (-> call.twilioSid/endCall)
 * @property {string} [payload]         - Audio-Payload (G.711 u-law base64), nur bei event=media
 */

/**
 * @typedef {Object} MediaTransport
 *   Port 4 (Aufrufer: bridge.js, HEIKLE STELLE). Kapselt die provider-spezifische
 *   WS-Frame-Schicht des Realtime-Streams; die OpenAI-Seite der Bridge bleibt
 *   provider-agnostisch. Reine Funktionen (kein IO, kein State) - unit-testbar.
 * @property {(msg: object) => MediaFrame} parseMediaFrame
 *   Roh-WS-Nachricht (JSON.parse't) -> neutrales MediaFrame. Unbekannte Events -> event:"other".
 * @property {(params: {payload: string, streamRef?: string}) => object} buildMediaFrame
 *   Neutrale Audio-Payload -> Provider-WS-Objekt (KI-Audio raus). Twilio braucht streamRef, Telnyx nicht.
 * @property {(params: {streamRef?: string}) => object} clearPlayback
 *   Barge-in: Provider-WS-Objekt, das die gepufferte Wiedergabe verwirft
 *   ({event:"clear"} bei beiden Providern; Twilio mit streamSid, Telnyx ohne).
 */

/**
 * @typedef {Object} WebhookEvents
 *   Port 5 (Webhook-Parsing, VOR den Safety-Gates - reines Parsing, keine Gate-Logik).
 *   Kapselt das provider-spezifische Auslesen von Turn-/Status-/Speak-Webhook-Bodies;
 *   server.js bleibt provider-agnostisch. Reine Funktionen (kein IO, kein State) -
 *   unit-testbar.
 * @property {(body: object) => string} parseSpeechResult
 *   Erkanntes Speech-Ergebnis aus dem /voice/turn-Body (getrimmt). Kein Treffer -> "".
 * @property {(body: object) => {status: string, diagnostics: object}} parseLifecycleEvent
 *   Call-Lifecycle-Status aus dem /voice/status-Body. diagnostics ist PII-frei (nur
 *   Zahlen + sanitisierte Tokens); leer ({}) wenn der Provider keine liefert.
 * @property {(body: object) => {outcome: string, reason: string|null}} parseSpeakOutcome
 *   Erkennt ein server-seitiges TTS-Speak-Command-Event (SPEAK_OUTCOME-Enum aus
 *   telephony/adapters/telnyx/speak-events.js, EINE Quelle des Enums). NONE, wenn der
 *   Provider solche Events nicht kennt oder der Body keins ist.
 * @property {(body: object) => string} parseAnsweredBy
 *   Ergebnis der Anrufbeantworter-Erkennung aus dem /voice/outbound-Body (ANSWERED_BY-Enum
 *   aus telephony/answered-by.js). Fehlendes/unbekanntes Feld -> UNKNOWN (fail-open).
 */
export {};
