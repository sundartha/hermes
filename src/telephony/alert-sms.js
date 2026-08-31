// Fail-soft-Versand einer Plattform-Alarm-SMS an den Betreiber (EINE Quelle, G5).
// Zwei Verbraucher mit unterschiedlicher Absender-Herkunft, aber identischem Rumpf:
// emitPlatformSpendWarning (src/telephony/outbound-gates.js, Absender aus dem Call-Kontext)
// und der Drift-Waechter (src/billing/cost-truing.js, Absender per Store-Lookup).
//
// SAFETY-KERN, absolut fail-soft - ein Fehler auf diesem Pfad darf NIE den Aufrufer
// abbrechen (er darf weder einen Anruf kosten noch einen Sweep beenden):
//   (1) der komplette Rumpf liegt in try/catch - das faengt auch ein SYNCHRONES Werfen
//       von messaging() (z.B. unbekannter Provider, pick() ist fail-closed);
//   (2) sendSms wird NICHT awaitet und traegt sofort ein .catch (kein Lock-Halten, keine
//       Verzoegerung, kein unhandled rejection);
//   (3) jeder Fehler geht ausschliesslich an onError.
//
// Der SMS-Versand ist ECHT und KOSTENPFLICHTIG. Dieser Baustein kennt KEINE Entprellung -
// die Kostenklemme sitzt beim Aufrufer (dort, wo der Befund entsteht und wo bekannt ist,
// worauf entprellt wird).
//
// REIHENFOLGE ist Teil des Vertrags: erst der Empfaenger-Riegel, DANN resolveSender().
// Ohne konfigurierten Empfaenger ist der Alarmkanal abgeschaltet - dann darf die
// Absender-Aufloesung weder laufen noch (ueber ihren eigenen Log-Pfad) eine Warnung
// erzeugen, die nach einem Defekt aussieht.
//
// PII: das Ziel (to) wird NIE geloggt - weder hier noch von den Aufrufern.

import { findActiveNumber } from "../store/views.js";
import { BOOTSTRAP_TENANT_ID, PLATFORM_NUMBER_PURPOSE } from "../store/defaults.js";
import { openPlatformBindingByPurpose } from "../store/state-ops.js";

// Absender-Aufloesung fuer eine store-basierte Plattform-Alarm-SMS (EINE Quelle, G5):
// die aktive Nummer des BOOTSTRAP-Tenants - die eigene Betreiber-Nummer, NIE die DID
// eines Kunden. Zwei Verbraucher teilen sie: der Drift-Waechter (LCT P5) und die
// ElevenLabs-Kontingent-Warnung (LCT P7). Keine Nummer -> null (fail-closed, KEINE SMS)
// plus EINE WARN-Zeile. Die Warnung ist keine Falschmeldung: sendFailSoftAlertSms ruft
// resolveSender laut Vertrag NUR nach dem Empfaenger-Riegel - ein fehlender Absender bei
// aktivem Alarmkanal ist echt meldenswert. findActiveNumber liefert undefined, wenn nichts
// passt; hier auf null normalisiert (sendFailSoftAlertSms prueft auf falsy).
export function resolveBootstrapAlertSender(store) {
  const sender = findActiveNumber(store.load(), BOOTSTRAP_TENANT_ID);
  if (sender) return sender;
  console.warn("[alert-sms] Plattform-Alarm: keine aktive Bootstrap-Nummer, KEINE SMS");
  return null;
}

// OUTBOUND-E3b (PM-17): der Alarm-Absender des systematischen-Ausfall-Melders (telephony/
// outage-report.js) kommt aus der beim Boot ABGELEITETEN Plattform-Bindung
// (alert_sms_sender, src/boot.js#derivePlatformNumberBindings), NICHT aus einer erneuten
// Laufzeit-Suche. Grund: resolveBootstrapAlertSender oben nimmt die erste AKTIVE
// Bootstrap-Nummer - genau der Mechanismus, den der Erase-Weg am 24.08.2026 still
// mitgenommen hat (tasks/befund-outbound-ausfall-2026-08-27.md). Die Bindung ueberlebt
// dieselbe Freigabe (eigene Tabelle, dreifacher Freigabe-Riegel, PLAN-OUTBOUND-
// RESILIENZ.md E-1). Keine offene Bindung -> null (fail-closed, KEINE SMS) plus EINE
// WARN-Zeile - LAUT, nie ein stilles null (PM-17).
export function platformAlertSender(store) {
  const binding = openPlatformBindingByPurpose(store.load(), PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER);
  if (binding?.e164) return { provider: binding.provider, e164: binding.e164 };
  console.warn("[alert-sms] Ausfall-Melder: keine gebundene Alarm-Absendernummer, KEINE SMS");
  return null;
}

// sender = { provider, e164 } (Form von findActiveNumber, src/store/views.js).
// resolveSender liefert null, wenn kein zulaessiger Absender feststeht -> KEINE SMS
// (fail-closed gegen einen Alarm mit fremder Absendernummer).
export function sendFailSoftAlertSms({ messaging, to, body, resolveSender, onError }) {
  try {
    if (!to) return; // leer = Alarm-SMS abgeschaltet (nur Audit beim Aufrufer)
    const sender = resolveSender();
    if (!sender) return;
    messaging(sender.provider)
      .sendSms({ from: sender.e164, to, body })
      .catch(onError); // Fehler wird geschluckt+geloggt, NIE hochgereicht
  } catch (e) {
    onError(e); // synchroner Wurf (z.B. unbekannter Provider in messaging())
  }
}

// Kompletter store-basierter Bootstrap-Alarm-Versand (EINE Quelle, G5): setzt Empfaenger
// (config.billing.platformAlertSmsTo), Body (prefix + detail), den geteilten Bootstrap-
// Absender und den Fehler-Log in EINER Stelle zusammen und reicht sie an den fail-soft-
// Baustein weiter. Zwei Verbraucher teilen ihn: der Drift-Waechter (LCT P5,
// src/billing/cost-truing.js) und die ElevenLabs-Kontingent-Warnung (LCT P7, src/server.js) -
// beide bauten zuvor denselben Aufruf-Rumpf doppelt. logTag unterscheidet die Log-Zeile.
// EIN Options-Argument (F1). Der Versand ist fail-soft: alle Riegel liegen in
// sendFailSoftAlertSms, ein Fehler bricht den Aufrufer NIE ab. Ziel (to) wird NIE geloggt.
export function sendBootstrapAlertSms({ messaging, config, store, prefix, detail, logTag }) {
  sendFailSoftAlertSms({
    messaging,
    to: config.billing.platformAlertSmsTo,
    body: prefix + detail,
    resolveSender: () => resolveBootstrapAlertSender(store),
    onError: (e) => console.error(`[${logTag}] Alarm-SMS fehlgeschlagen:`, e.message),
  });
}
