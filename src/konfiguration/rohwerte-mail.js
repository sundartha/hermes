export function mailRohwerte(umgebung) {
  const { env, numEnv } = umgebung;
  return {
    brevoApiKey: env.BREVO_API_KEY || "",
    smtpHost: env.SMTP_HOST || "",
    smtpPort: numEnv("SMTP_PORT", env.SMTP_PORT, { fallback: 465, min: 1 }),
    smtpUser: env.SMTP_USER || "",
    smtpPassword: env.SMTP_PASSWORD || "",
    mailFrom: env.MAIL_FROM || "",
    platformAlertMailTo: env.PLATFORM_ALERT_MAIL_TO || "",
  };
}
