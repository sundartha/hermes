import { createHash } from "node:crypto";
import { anfrage } from "../utils/anfrage.js";
import { findActiveNumber } from "../store/views.js";
import { BOOTSTRAP_TENANT_ID } from "../begriffe/mandant.js";
import { PLATFORM_NUMBER_PURPOSE } from "../begriffe/nummern-vergabe.js";
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
const MELDEZEILE_MAX_ZEICHEN = 1000;
const KURZ_HASH_ZEICHEN = 8;

function logNichtZugestellt(anlass, schluessel, grund) {
  console.error(`[${anlass}] Better-Stack-Meldung ${schluessel} nicht zugestellt: ${grund}`);
}

async function sendeBetterStackMeldung({ adresse, anlass, schluessel, status, meldezeile }) {
  if (!adresse) return;
  try {
    const res = await anfrage(adresse, {
      fristMs: BETTERSTACK_FRIST_MS,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incident: { id: schluessel, status },
        text: meldezeile.slice(0, MELDEZEILE_MAX_ZEICHEN),
      }),
    });
    if (!res.ok) logNichtZugestellt(anlass, schluessel, `HTTP ${res.status}`);
  } catch (err) {
    logNichtZugestellt(anlass, schluessel, err?.name);
  }
}

function einmalSchluessel(logTag, meldezeile) {
  const kurzHash = createHash("sha256").update(meldezeile).digest("hex").slice(0, KURZ_HASH_ZEICHEN);
  return `${logTag}:${new Date().toISOString()}:${kurzHash}`;
}

export function sendBootstrapAlertSms({ config, prefix, detail, logTag }) {
  const meldezeile = prefix + detail;
  void sendeBetterStackMeldung({
    adresse: config.billing.betterstackAlertUrl,
    anlass: logTag,
    schluessel: einmalSchluessel(logTag, meldezeile),
    status: "alert",
    meldezeile,
  });
}
