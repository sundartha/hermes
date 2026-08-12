// Mail-Port (312k-Phase 5): Provider-unabhaengiger Vertrag fuer den Versand einer
// EINZELNEN Text-Mail. Reine JSDoc-Typdefs, Muster billing/ports.js. Heute gibt es im
// System KEINEN Mailversand (nur SMS ueber die Telefonieanbieter) - dieser Port ist der
// erste. Domaenensprache: KEIN Provider-/Bibliotheks-Objekt (kein nodemailer-Info-Objekt)
// verlaesst den Adapter.

/**
 * @typedef {Object} SendMailParams
 * @property {string} to       - Empfaenger-Adresse (aus account.email, NIE aus einem
 *   Request-Body - kein Spoofing, s. billing/cancellation-mail.js)
 * @property {string} subject  - Betreffzeile (schlichter Text, kein HTML)
 * @property {string} text     - Nachrichtentext (Klartext, keine HTML-Gestaltung noetig -
 *   Textform nach § 312k verlangt keine Gestaltung)
 */

/**
 * @typedef {Object} MailPort
 * @property {(params: SendMailParams) => Promise<void>} sendMail
 *   Verschickt EINE Text-Mail. Wirft bei einem Provider-/Netzwerkfehler (der Aufrufer
 *   faengt fail-soft, s. billing/cancellation-mail.js attemptCancellationMailConfirm) -
 *   NIE einen leeren Erfolg vortaeuschen.
 */
export {};
