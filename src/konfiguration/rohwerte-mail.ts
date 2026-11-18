import type { umgebungMit } from "./umgebung.ts";

export function rohwerteMail(
  env: {
    BREVO_API_KEY?: string | undefined;
    SMTP_HOST?: string | undefined;
    SMTP_PORT?: string | undefined;
    SMTP_USER?: string | undefined;
    SMTP_PASSWORD?: string | undefined;
    MAIL_FROM?: string | undefined;
    PLATFORM_ALERT_MAIL_TO?: string | undefined;
  },
  { numEnv }: Pick<ReturnType<typeof umgebungMit>, "numEnv">,
): {
  brevoApiKey: string;
  smtpHost: string;
  smtpPort: number | undefined;
  smtpUser: string;
  smtpPassword: string;
  mailFrom: string;
  platformAlertMailTo: string;
} {
  return {
    brevoApiKey: env.BREVO_API_KEY ?? "",
    smtpHost: env.SMTP_HOST ?? "",
    smtpPort: numEnv("SMTP_PORT", env.SMTP_PORT, { fallback: 465, min: 1 }),
    smtpUser: env.SMTP_USER ?? "",
    smtpPassword: env.SMTP_PASSWORD ?? "",
    mailFrom: env.MAIL_FROM ?? "",
    platformAlertMailTo: env.PLATFORM_ALERT_MAIL_TO ?? "",
  };
}
