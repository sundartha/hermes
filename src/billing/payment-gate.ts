import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "../utils/http.ts";

interface Antwort {
  status: (code: number) => { json: (koerper: unknown) => unknown };
}

export function requirePaymentEnabled(
  res: Antwort,
  config: { billing: { paymentEnabled: boolean } },
  message = "payment disabled (PAYMENT_ENABLED)",
): boolean {
  if (config.billing.paymentEnabled) return true;
  res.status(HTTP_NOT_FOUND).json({ error: message });
  return false;
}

export const ERROR_SERVER_UNCONFIGURED = "server_unconfigured";

export function requirePublicUrl(res: Antwort, config: { server: { publicUrl: string | null | undefined } }): boolean {
  if (config.server.publicUrl) return true;
  res.status(HTTP_SERVER_ERROR).json({ error: ERROR_SERVER_UNCONFIGURED });
  return false;
}
