// SMTP-Mailversand (312k-Phase 5: Kuendigungsbestaetigung nach § 312k BGB). Im Stil von
// workos-management.js: alles injiziert (DIP-Seam), kein globaler Zustand, EIN schlanker
// Adapter hinter dem Port (mail/ports.js). Versand ueber das vorhandene eigene Postfach per
// SMTP (Zoho EU, s. .env.example) - KEIN neuer Dienstleister, KEIN drittes SDK ausser
// nodemailer.
//
// TLS ist ERZWUNGEN (kein unverschluesselter Versand): Port 465 -> implizites TLS von der
// ersten Verbindung an (secure); jeder andere Port -> STARTTLS ist PFLICHT (requireTLS) statt
// optional - ein Server, der kein STARTTLS anbietet, laesst den Versand fail-soft scheitern
// (attemptCancellationMailConfirm faengt das ab), NIE einen Klartext-Fallback.
//
// Niemals das SMTP-Passwort oder die Empfaenger-Adresse loggen (Regel 4 - eine
// Email-Adresse ist personenbezogen).
import nodemailer from "nodemailer";

export function makeSmtpMailer(config, { _nodemailer = nodemailer } = {}) {
  const port = config.mail.smtpPort;
  const transporter = _nodemailer.createTransport({
    host: config.mail.smtpHost,
    port,
    secure: port === 465, // implizites TLS ab der ersten Verbindung (Zoho-Default 465)
    requireTLS: port !== 465, // STARTTLS ist Pflicht, nie optional - kein Klartext-Fallback
    auth: { user: config.mail.smtpUser, pass: config.mail.smtpPassword },
  });

  return {
    // Verschickt EINE Text-Mail. Wirft bei einem Provider-/Netzwerkfehler unveraendert
    // weiter (der Aufrufer, attemptCancellationMailConfirm, ist selbst fail-soft) - NIE
    // hier schon einen Fehler verschlucken (sonst gaelte eine gescheiterte Bestaetigung
    // faelschlich als erledigt).
    async sendMail({ to, subject, text }) {
      await transporter.sendMail({ from: config.mail.mailFrom, to, subject, text });
    },
  };
}
