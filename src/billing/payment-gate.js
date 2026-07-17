// EINE Quelle (G5) fuer das PAYMENT_ENABLED-404-Gate: ohne PAYMENT_ENABLED existiert der
// Geld-/Metering-Endpunkt nach aussen nicht (fail-closed, Absolute Regel 1 - Gate wird NICHT
// aufgeweicht, nur die Wiederholung entfernt). true = aktiv (Aufrufer faehrt fort); sonst
// sendet 404 und gibt false zurueck. message defaultet auf den an 5 Stellen identischen Text;
// der Metering-Flush ueberschreibt ihn mit seinem eigenen (byte-identisch erhalten).
export function requirePaymentEnabled(res, config, message = "payment disabled (PAYMENT_ENABLED)") {
  if (config.paymentEnabled) return true;
  res.status(404).json({ error: message });
  return false;
}
