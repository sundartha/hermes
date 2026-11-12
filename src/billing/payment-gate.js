import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "../utils/http.ts";

export function requirePaymentEnabled(res, config, message = "payment disabled (PAYMENT_ENABLED)") {
  if (config.billing.paymentEnabled) return true;
  res.status(HTTP_NOT_FOUND).json({ error: message });
  return false;
}

export const ERROR_SERVER_UNCONFIGURED = "server_unconfigured";

export function requirePublicUrl(res, config) {
  if (config.server.publicUrl) return true;
  res.status(HTTP_SERVER_ERROR).json({ error: ERROR_SERVER_UNCONFIGURED });
  return false;
}
