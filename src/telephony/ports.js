// Telefonie-Ports: Vertraege fuer Provider-unabhaengige Telefonie. P0 hat genau
// einen Adapter (Twilio). Reine JSDoc-Typdefs, keine Laufzeit-Logik.

/**
 * @typedef {Object} OriginateParams
 * @property {string} from           - Anrufer-Nummer (E.164), heute config.twilioNumber
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
 * @typedef {Object} InboundRequest
 * @property {Object<string,string>} headers - Request-Header (lowercase keys, z.B. x-twilio-signature)
 * @property {Buffer} rawBody  - unveraenderter Roh-Body; fuer Twilio-HMAC ungenutzt,
 *                               fuer kuenftige Ed25519-Pruefung (Telnyx) noetig
 * @property {string} url      - vollstaendige signierte URL (publicUrl + originalUrl)
 * @property {Object<string,string>} params - geparste Form-Params (req.body) fuer den HMAC
 */

/**
 * @typedef {Object} InboundSignatureVerifier
 * @property {(req: InboundRequest) => boolean} verifyInboundSignature
 *   Prueft die Provider-Signatur eines Inbound-Webhooks. FAIL-CLOSED: bei
 *   fehlender/falscher Signatur oder fehlender Config -> false (wirft nie).
 *   Twilio: HMAC-SHA1 ueber url + sortierte params (rawBody ungenutzt).
 */

/**
 * @typedef {Object} VoiceControl
 * @property {(params: OriginateParams) => Promise<OriginateResult>} originateCall
 *   Startet einen Outbound-Call. Heute: calls.create(...).
 * @property {(providerCallSid: string) => Promise<void>} endCall
 *   Beendet einen laufenden Call. Heute: calls(sid).update({status:"completed"}).
 */

/**
 * @typedef {Object} SmsParams
 * @property {string} from - Absender-Nummer (E.164), heute config.twilioNumber
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
export {};
