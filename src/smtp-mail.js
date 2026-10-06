import nodemailer from "nodemailer";

export function buildTransporter(config, _nodemailer) {
  const port = config.mail.smtpPort;
  return _nodemailer.createTransport({
    host: config.mail.smtpHost,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: config.mail.smtpUser, pass: config.mail.smtpPassword },
  });
}

export function makeSmtpMailer(config, { _nodemailer = nodemailer } = {}) {
  const transporter = buildTransporter(config, _nodemailer);

  return {
    async sendMail({ to, subject, text }) {
      await transporter.sendMail({ from: config.mail.mailFrom, to, subject, text });
    },
  };
}
