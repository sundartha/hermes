// FW2: die EINE Stelle, an der ein Guthaben-Ausfall alarmiert UND vermerkt wird (G5/S2 -
// keine zweite Kopie der Log-Zeile). Der Aufrufweg (routes/voice.js)
// benutzen sie.
import { isProviderBillingError } from "./llm.js";
import { latchBillingBlockedProvider } from "./llm/registry.js";
import { formatLogLine } from "./utils/log-line.js";

// Bestandstoken, unveraendert (GQ-P4/A4, Owner-Entscheidung 2026-08-04): der Bezahl-/
// Guthaben-Fall ist KEIN gewoehnlicher Turn-Fehler - er legt den Agenten fuer JEDEN Anruf
// gleichzeitig still. Eigener, eindeutig greppbarer Kanal (console.error) und die
// HANDLUNG im Payload: eine Zeile, die nur "Fehler" sagt, hat den Vorfall am 04.08. genau
// nicht sichtbar gemacht (P8). BEWUSST KEINE Alarm-SMS - sie kostet Geld und kann in eine
// Schleife geraten; die Alarmregel haengt der Betreiber ausserhalb des Repos an dieses
// Token. PII-frei: der Payload traegt nur, was der Aufrufer hereinreicht (callId/turnSeq).
const BILLING_ALARM_KIND = "ALARM_LLM_BILLING";
const PROVIDER_SWITCH_KIND = "LLM_PROVIDER_SWITCH";
const BILLING_ALARM_ACTION =
  "KI-Guthaben beim Anbieter aufgebraucht - sofort aufladen, sonst antwortet KEIN Anruf mehr";
const PROVIDER_SWITCH_ACTION =
  "Ausweich-Anbieter uebernimmt - Primaerkonto aufladen, sonst laeuft der Verkehr dauerhaft ueber den anderen Preis";

// Genau EINE Wechsel-Zeile je Latch-Setzung (freshlyLatched, s. billing-latch.js) - ein
// zweiter Guthaben-Fehler waehrend des Cooldowns latcht erneut denselben Zustand und
// meldet keinen zweiten Wechsel.
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

/**
 * Klassifiziert den Fehler und vermerkt einen Guthaben-Ausfall (Alarm-Zeile + Latch).
 * @param {*} err
 * @param {{ logPrefix: string, payload: object }} kanal - PII-/secret-frei (nur
 *   callId/turnSeq o.ae.)
 * @returns {boolean} war es ein Guthaben-Fall
 */
export function noteLlmBillingOutage(err, { logPrefix, payload }) {
  if (!isProviderBillingError(err)) return false;
  console.error(formatLogLine(logPrefix, BILLING_ALARM_KIND, { ...payload, handlung: BILLING_ALARM_ACTION }));
  const latch = latchBillingBlockedProvider(Date.now()); // null = kein Fallback konfiguriert
  if (latch?.freshlyLatched) logProviderSwitch(logPrefix, payload, latch);
  return true;
}
