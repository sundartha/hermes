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
 *   Body byte-identisch zum Bestand. Ingest- UND Inbound-Pfad reichen call.language beide durch.
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
 *   (Nummernkauf) - deshalb gedeckelt durch config.maxNumbers (Kosten-Notbremse,
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
export {};
