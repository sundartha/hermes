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

const BETTERSTACK_FRIST_MS = 5000;
const MELDEZEILE_MAX_CHARS = 1000;

function fehlerKennung(err) {
  return err?.code ? `${err?.name} ${err.code}` : `${err?.name}`;
}

function logNichtZugestellt(anlass, schluessel, grund) {
  console.error(`[${anlass}] Better-Stack-Meldung ${schluessel} nicht zugestellt: ${grund}`);
}

async function sendeBetterStackMeldung({ adresse, anlass, schluessel, status, meldezeile }) {
  if (!adresse) return;
  try {
    const res = await fetch(new URL(adresse), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incident: { id: schluessel, status },
        text: String(meldezeile).slice(0, MELDEZEILE_MAX_CHARS),
      }),
      signal: AbortSignal.timeout(BETTERSTACK_FRIST_MS),
    });
    if (res.ok) return;
    logNichtZugestellt(anlass, schluessel, `HTTP ${res.status}`);
  } catch (err) {
    logNichtZugestellt(anlass, schluessel, fehlerKennung(err));
  }
}

export function sendBootstrapAlertSms({ config, prefix, detail, logTag }) {
  void sendeBetterStackMeldung({
    adresse: config.billing.betterstackAlertUrl,
    anlass: logTag,
    schluessel: `${logTag}:${new Date().toISOString()}`,
    status: "alert",
    meldezeile: prefix + detail,
  });
}
