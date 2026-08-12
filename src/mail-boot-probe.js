// mail-boot-probe (312k-Phase 5, HTTP-Fortsetzung): Nachfolger von probeSmtpBoot
// (frueher smtp-mail.js). Der Versand ist bewusst fail-soft (s. brevo-mail.js/
// smtp-mail.js-Kopf): schlaegt er fehl, bleibt er nur am Tenant vermerkt und der Sweep
// wiederholt ihn - lautlos. Sind die Zugangsdaten falsch oder die Absenderadresse beim
// Anbieter nicht verifiziert, scheitert JEDER Versuch lautlos; der Betreiber merkt es
// sonst erst, wenn sich ein Kunde beschwert. Diese Sonde schliesst genau die Luecke: EINE
// Zeile beim Start, die den Zustand meldet (Muster AL-P16/boot.js: eine Zeile,
// unkonditional - kein Gesamturteil, keine Wiederholung).
//
// NEU seit der HTTP-Fortsetzung: es gibt jetzt ZWEI moegliche Kanaele (Brevo/HTTP,
// SMTP), mit derselben Rangfolge wie die Mailer-Auswahl (wiring/web-login.js
// selectMailer) - Brevo VOR SMTP. Die Sonde bildet dieselbe Rangfolge NUR fuer die
// Diagnose nach, sie konstruiert KEINEN Mailer und verschickt KEINE Mail:
//   - Brevo-Schluessel gesetzt -> GET /v3/account (verifyBrevoAccount, brevo-mail.js)
//   - sonst SMTP-Host gesetzt -> transporter.verify() (buildTransporter, smtp-mail.js)
//   - sonst -> "nicht konfiguriert"
//
// NEBENLAEUFIG und JEDEN Fehler fangend, per Konstruktion (eigener try/catch HIER, nicht
// erst beim Aufrufer - zweite Linie beim Aufrufer zusaetzlich, Muster runSweepTick in
// boot.js): ein nicht erreichbarer oder langsam antwortender Mail-Anbieter darf den Start
// nie verzoegern oder verhindern - der Dienst telefoniert live.
//
// Log-Inhalt (Regel 4): Host/Port (SMTP) bzw. "Brevo (HTTP)" und die Absenderadresse sind
// Betriebsdaten der Firma, kein Secret - duerfen erscheinen. Weder das SMTP-Passwort noch
// der Brevo-API-Key NIE, auch nicht verkuerzt. Vom Fehler nur err.code/err.name - NIE
// err.message (das kann Nutzername/Zieladresse/Anbieterdetails tragen, s. der gleiche
// Grundsatz in attemptCancellationMailConfirm/cancellation-mail.js).
import nodemailer from "nodemailer";
import { buildTransporter } from "./smtp-mail.js";
import { verifyBrevoAccount } from "./brevo-mail.js";

export async function probeMailBoot(
  config,
  { _nodemailer = nodemailer, _fetch = fetch, log = console.log, logError = console.error } = {},
) {
  const { brevoApiKey, smtpHost, smtpPort, mailFrom } = config.mail;

  if (brevoApiKey) {
    const info = `from=${mailFrom || "fehlt"}`;
    try {
      await verifyBrevoAccount(config, { _fetch });
      log(`[mail] Brevo (HTTP) konfiguriert (${info}) - Verbindung/Anmeldung ok`);
    } catch (err) {
      logError(
        `[mail] Brevo (HTTP) konfiguriert (${info}) - Verbindung/Anmeldung fehlgeschlagen ` +
          `(code=${err?.code ?? "?"}, name=${err?.name ?? "?"})`,
      );
    }
    return;
  }

  if (smtpHost) {
    const info = `host=${smtpHost}:${smtpPort}, from=${mailFrom || "fehlt"}`;
    try {
      await buildTransporter(config, _nodemailer).verify();
      log(`[mail] SMTP konfiguriert (${info}) - Verbindung/Anmeldung ok`);
    } catch (err) {
      logError(
        `[mail] SMTP konfiguriert (${info}) - Verbindung/Anmeldung fehlgeschlagen ` +
          `(code=${err?.code ?? "?"}, name=${err?.name ?? "?"})`,
      );
    }
    return;
  }

  log(
    "[mail] nicht konfiguriert (weder BREVO_API_KEY noch SMTP_HOST gesetzt) - " +
      "Kuendigungsbestaetigungen bleiben offen vermerkt, ein spaeterer Sweep versucht sie erneut.",
  );
}
