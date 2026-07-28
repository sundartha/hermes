// Guards der Checkout-/Geld-Endpunkte (je EINE Quelle, G5).

// EINE Quelle (G5) fuer das PAYMENT_ENABLED-404-Gate: ohne PAYMENT_ENABLED existiert der
// Geld-/Metering-Endpunkt nach aussen nicht (fail-closed, Absolute Regel 1 - Gate wird NICHT
// aufgeweicht, nur die Wiederholung entfernt). true = aktiv (Aufrufer faehrt fort); sonst
// sendet 404 und gibt false zurueck. message defaultet auf den an 5 Stellen identischen Text;
// der Metering-Flush ueberschreibt ihn mit seinem eigenen (byte-identisch erhalten).
export function requirePaymentEnabled(res, config, message = "payment disabled (PAYMENT_ENABLED)") {
  if (config.billing.paymentEnabled) return true;
  res.status(404).json({ error: message });
  return false;
}

// Sprachneutraler Fehlercode fuer "Server kennt seine oeffentliche Basis-URL nicht"
// (Server-Fehlkonfiguration, kein Kundenfehler). Bewusst OHNE Env-Variablennamen: eine
// Kunden-Antwort transportiert einen stabilen Code, keine Interna (WEB-10). Vokabelform
// wie plan_unconfigured/billing_unavailable in denselben Handlern.
export const ERROR_SERVER_UNCONFIGURED = "server_unconfigured";

// EINE Quelle (G5) fuer den PUBLIC_URL-Guard der beiden Checkout-Handler
// (routes/api-billing.js + self-service-routes.js): ohne oeffentliche Basis-URL gibt es
// keine gueltige success/cancel-Rueckkehradresse -> KEIN Stripe-Call (fail-closed).
// true = konfiguriert (Aufrufer faehrt fort); sonst sendet 500 und gibt false zurueck -
// derselbe Vertrag wie requirePaymentEnabled darueber.
export function requirePublicUrl(res, config) {
  if (config.server.publicUrl) return true;
  res.status(500).json({ error: ERROR_SERVER_UNCONFIGURED });
  return false;
}
