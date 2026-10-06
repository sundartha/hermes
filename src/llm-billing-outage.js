import { isProviderBillingError } from "./llm.js";
import { latchBillingBlockedProvider } from "./llm/registry.js";
import { formatLogLine } from "./utils/log-line.js";

const BILLING_ALARM_KIND = "ALARM_LLM_BILLING";
const PROVIDER_SWITCH_KIND = "LLM_PROVIDER_SWITCH";
const BILLING_ALARM_ACTION =
  "KI-Guthaben beim Anbieter aufgebraucht - sofort aufladen, sonst antwortet KEIN Anruf mehr";
const PROVIDER_SWITCH_ACTION =
  "Ausweich-Anbieter uebernimmt - Primaerkonto aufladen, sonst laeuft der Verkehr dauerhaft ueber den anderen Preis";

function logProviderSwitch(logPrefix, payload, latch) {
  console.error(
    formatLogLine(logPrefix, PROVIDER_SWITCH_KIND, {
      ...payload,
      blockedProvider: latch.blockedProvider,
      nextProvider: latch.nextProvider,
      cooldownMs: latch.cooldownMs,
      handlung: PROVIDER_SWITCH_ACTION,
    }),
  );
}

export function noteLlmBillingOutage(err, { logPrefix, payload }) {
  if (!isProviderBillingError(err)) return false;
  console.error(formatLogLine(logPrefix, BILLING_ALARM_KIND, { ...payload, handlung: BILLING_ALARM_ACTION }));
  const latch = latchBillingBlockedProvider(Date.now());
  if (latch?.freshlyLatched) logProviderSwitch(logPrefix, payload, latch);
  return true;
}
