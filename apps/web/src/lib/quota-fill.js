// Anzeige-Fuellbreite des Minuten-Fortschrittsbalkens (Dashboard, BillingIsland).
// Loest quotaUsedPercent (lib/subscribe.js) als einzigen Abnehmer-Wert des Balkens
// ab -- Owner-Feedback 2026-08-26: die Kontingent-Zeile zaehlte sichtbar herunter,
// der Balken ruehrte sich nicht. Ursache war die Ganzzahl-Rundung dort: auf einem
// 120-Minuten-Kontingent wird jede Nutzung unter 0,5 % (= 36 Sekunden) zu 0 %,
// und 1-2 Minuten bleiben ein unsichtbarer Pixelstreifen.
//
// Eigenes kleines Modul statt Umbau in subscribe.js: die Fuellbreite ist eine
// reine ANZEIGE-Groesse des Balkens (inkl. Sichtbarkeitsboden), keine Rechen-
// groesse -- und subscribe.js traegt noch eingefrorene Lint-Altlast, deren
// Aufraeumen ein eigener Umbau waere (eslint-suppressions, "wer anfasst,
// raeumt auf").
//
// Verhalten:
//   - eine Nachkommastelle statt ganzer Prozent, damit der Balken jede Minute
//     mitgeht, die die Kontingent-Zeile anzeigt,
//   - Sichtbarkeitsboden: jede angebrochene Nutzung zeigt mindestens
//     FILL_MIN_VISIBLE_PERCENT, ohne Verbrauch bleibt der Balken exakt leer,
//   - geklemmt auf [0,100] (Verteidigung gegen inkonsistente Server-Werte,
//     z.B. remainingMinutes > includedMinutes),
//   - kein Kontingent -> 0 (der Aufrufer rendert den Balken ohnehin nur, wenn
//     quotaLine(...) einen Text liefert).

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;
// Aufloesung: eine Nachkommastelle (Zehntel-Prozent).
const TENTHS_PER_PERCENT = 10;
// Sichtbarkeitsboden: unterhalb dieser Fuellung ist ein 8-px-Balken auf
// Desktop-Breite praktisch nicht wahrnehmbar.
const FILL_MIN_VISIBLE_PERCENT = 2;

export function quotaFillPercent(quota) {
  if (!quota || !quota.includedMinutes) return PERCENT_MIN;
  const usedMinutes = quota.includedMinutes - quota.remainingMinutes;
  const usedShare = usedMinutes / quota.includedMinutes;
  const tenths = Math.round(usedShare * PERCENT_MAX * TENTHS_PER_PERCENT);
  const percent = tenths / TENTHS_PER_PERCENT;
  const clamped = Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, percent));
  if (clamped === PERCENT_MIN) return PERCENT_MIN;
  return Math.max(FILL_MIN_VISIBLE_PERCENT, clamped);
}
