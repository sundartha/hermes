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
