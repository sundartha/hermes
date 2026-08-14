// SMTP-Mailversand (312k-Phase 5: Kuendigungsbestaetigung nach § 312k BGB). Im Stil von
// workos-management.js: alles injiziert (DIP-Seam), kein globaler Zustand, EIN schlanker
// Adapter hinter dem Port (mail/ports.js). Versand ueber das vorhandene eigene Postfach per
// SMTP (Zoho EU, s. .env.example) - KEIN neuer Dienstleister, KEIN drittes SDK ausser
// nodemailer.
//
// HTTP-Fortsetzung (312k-Phase 5): Render sperrt auf kostenlosen Web-Diensten den
// ausgehenden Verkehr auf allen SMTP-Ports (25/465/587) - dieser Adapter funktioniert dort
// NICHT (die Boot-Sonde meldet ETIMEDOUT). Der aktive Kanal ist deshalb standardmaessig
// Brevo per HTTP (brevo-mail.js, Port 443). Dieser SMTP-Adapter bleibt trotzdem bestehen -
// NICHT entfernen: sobald der Dienst auf einen bezahlten Plan wechselt, ist er wieder die
// einfachere Wahl (nur SMTP_* setzen, BREVO_API_KEY leer lassen, s. wiring/web-login.js
// selectMailer).
//
// TLS ist ERZWUNGEN (kein unverschluesselter Versand): Port 465 -> implizites TLS von der
// ersten Verbindung an (secure); jeder andere Port -> STARTTLS ist PFLICHT (requireTLS) statt
// optional - ein Server, der kein STARTTLS anbietet, laesst den Versand fail-soft scheitern
// (attemptCancellationMailConfirm faengt das ab), NIE einen Klartext-Fallback.
//
// Niemals das SMTP-Passwort oder die Empfaenger-Adresse loggen (Regel 4 - eine
// Email-Adresse ist personenbezogen).
import nodemailer from "nodemailer";

// Gemeinsamer Transport-Aufbau fuer sendMail UND den SMTP-Zweig der Boot-Sonde
// (probeMailBoot, mail-boot-probe.js) - EINE Quelle fuer TLS-Erzwingung/Auth-Wiring statt
// zweier Kopien (G5). Exportiert, weil mail-boot-probe.js ihn fuer den reinen
// Verbindungstest (verify(), verschickt KEINE Mail) braucht. Jeder Aufrufer erhaelt eine
// EIGENE Transporter-Instanz (kein geteilter Zustand): die Sonde verbindet sich nur zum
// Verify, sendMail nur zum Versand - keiner beeinflusst den anderen.
export function buildTransporter(config, _nodemailer) {
  const port = config.mail.smtpPort;
  return _nodemailer.createTransport({
    host: config.mail.smtpHost,
    port,
    secure: port === 465, // implizites TLS ab der ersten Verbindung (Zoho-Default 465)
    requireTLS: port !== 465, // STARTTLS ist Pflicht, nie optional - kein Klartext-Fallback
    auth: { user: config.mail.smtpUser, pass: config.mail.smtpPassword },
  });
}

export function makeSmtpMailer(config, { _nodemailer = nodemailer } = {}) {
  const transporter = buildTransporter(config, _nodemailer);

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

// Die Boot-Sonde (frueher probeSmtpBoot) lebt jetzt in mail-boot-probe.js (probeMailBoot) -
// sie prueft seit der HTTP-Fortsetzung nicht mehr NUR SMTP, sondern zuerst, welcher Kanal
// (Brevo/HTTP oder SMTP) ueberhaupt aktiv ist, und verzweigt erst dann. buildTransporter
// oben ist der wiederverwendete SMTP-Baustein, den sie fuer den SMTP-Zweig importiert.
