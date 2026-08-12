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

// Gemeinsamer Transport-Aufbau fuer sendMail UND die Boot-Sonde (probeSmtpBoot) - EINE
// Quelle fuer TLS-Erzwingung/Auth-Wiring statt zweier Kopien (G5). Jeder Aufrufer erhaelt
// eine EIGENE Transporter-Instanz (kein geteilter Zustand): die Sonde verbindet sich nur
// zum Verify, sendMail nur zum Versand - keiner beeinflusst den anderen.
function buildTransporter(config, _nodemailer) {
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

// ---- Boot-Sonde (smtp-boot-probe) --------------------------------------------------
// Der Versand ist bewusst fail-soft (s. Modulkopf): schlaegt er fehl, bleibt er nur am
// Tenant vermerkt und der Sweep wiederholt ihn - lautlos. Sind die Zugangsdaten falsch
// oder die Absenderadresse beim Anbieter nicht verifiziert, scheitert JEDER Versuch
// lautlos; der Betreiber merkt es sonst erst, wenn sich ein Kunde beschwert. Diese Sonde
// schliesst genau die Luecke: EINE Zeile beim Start, die den Zustand meldet (Muster
// AL-P16/boot.js: eine Zeile, unkonditional - kein Gesamturteil, keine Wiederholung).
//
// Reiner Verbindungstest: transporter.verify() authentifiziert sich beim Anbieter,
// verschickt aber KEINE Mail.
//
// NEBENLAEUFIG und JEDEN Fehler fangend, per Konstruktion (eigener try/catch HIER, nicht
// erst beim Aufrufer - zweite Linie beim Aufrufer zusaetzlich, Muster runSweepTick in
// boot.js): ein nicht erreichbarer oder langsam antwortender Mailserver darf den Start
// nie verzoegern oder verhindern - der Dienst telefoniert live.
//
// Log-Inhalt (Regel 4): Host, Port und Absenderadresse sind Betriebsdaten der Firma, kein
// Secret - duerfen erscheinen. Das SMTP-Passwort NIE, auch nicht verkuerzt. Vom Fehler nur
// err.code/err.name - NIE err.message (das kann Nutzername/Zieladresse tragen, s. der
// gleiche Grundsatz in attemptCancellationMailConfirm/cancellation-mail.js).
export async function probeSmtpBoot(
  config,
  { _nodemailer = nodemailer, log = console.log, logError = console.error } = {},
) {
  const { smtpHost, smtpPort, mailFrom } = config.mail;
  if (!smtpHost) {
    log(
      "[smtp] nicht konfiguriert (SMTP_HOST fehlt) - Kuendigungsbestaetigungen bleiben " +
        "offen vermerkt, ein spaeterer Sweep versucht sie erneut.",
    );
    return;
  }
  const info = `host=${smtpHost}:${smtpPort}, from=${mailFrom || "fehlt"}`;
  try {
    await buildTransporter(config, _nodemailer).verify();
    log(`[smtp] konfiguriert (${info}) - Verbindung/Anmeldung ok`);
  } catch (err) {
    logError(
      `[smtp] konfiguriert (${info}) - Verbindung/Anmeldung fehlgeschlagen ` +
        `(code=${err?.code ?? "?"}, name=${err?.name ?? "?"})`,
    );
  }
}
