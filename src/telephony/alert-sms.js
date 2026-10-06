import { findActiveNumber } from "../store/views.js";
import { BOOTSTRAP_TENANT_ID, PLATFORM_NUMBER_PURPOSE } from "../store/defaults.js";
import { openPlatformBindingByPurpose } from "../store/state-ops.js";

export function resolveBootstrapAlertSender(store) {
  const sender = findActiveNumber(store.load(), BOOTSTRAP_TENANT_ID);
  if (sender) return sender;
  console.warn("[alert-sms] Plattform-Alarm: keine aktive Bootstrap-Nummer, KEINE SMS");
  return null;
}

export function platformAlertSender(store) {
  const binding = openPlatformBindingByPurpose(store.load(), PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER);
  if (binding?.e164) return { provider: binding.provider, e164: binding.e164 };
  console.warn("[alert-sms] Ausfall-Melder: keine gebundene Alarm-Absendernummer, KEINE SMS");
  return null;
}

export function sendFailSoftAlertSms({ messaging, to, body, resolveSender, onError }) {
  try {
    if (!to) return;
    const sender = resolveSender();
    if (!sender) return;
    messaging(sender.provider)
      .sendSms({ from: sender.e164, to, body })
      .catch(onError);
  } catch (e) {
    onError(e);
  }
}

export function sendBootstrapAlertSms({ messaging, config, store, prefix, detail, logTag }) {
  sendFailSoftAlertSms({
    messaging,
    to: config.billing.platformAlertSmsTo,
    body: prefix + detail,
    resolveSender: () => resolveBootstrapAlertSender(store),
    onError: (e) => console.error(`[${logTag}] Alarm-SMS fehlgeschlagen:`, e.message),
  });
}
