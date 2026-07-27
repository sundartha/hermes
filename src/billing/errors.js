// Port-Level-Fehlertypen des Billing-Seams (P9: Klassifikation nach Aufrufer-Sicht,
// nicht nach Provider-Herkunft). Der Adapter (stripe.js) wirft, die Checkout-
// Orchestrierung (card-setup.js) faengt per instanceof - beide haengen nur an
// diesem Modul, nie aneinander (DIP).

// Geworfen, wenn der Provider die uebergebene Customer-Referenz nicht (mehr) kennt
// (Stripe: HTTP 400 resource_missing mit param=customer). Traegt dieselbe Diagnose-
// Message wie der generische Fehlerpfad (op + HTTP-Status + Provider-Detail; KEINE
// Secrets - sk_/Bearer liegen nur im Request-Header). Muster: LlmUnavailableError.
export class CustomerMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = "CustomerMissingError";
  }
}

// PAY-19: geworfen, wenn die Bank fuer eine off-session-Belastung eine Authentifizierung
// verlangt (Stripe: HTTP 402 card_error mit code=authentication_required, 3-D Secure).
// Das ist KEINE gewoehnliche Ablehnung - die Karte ist gueltig, es fehlt nur die Zustimmung
// des Karteninhabers. Stripe liefert dabei KEIN next_action, es gibt also kein Ziel zum
// Weiterleiten: der Ausweg ist eine NEUE on-session-Bestaetigung (Checkout mit dem Kunden
// davor), NICHT ein Retry derselben off-session-Belastung. Traegt dieselbe Diagnose-Message
// wie der generische Fehlerpfad (KEINE Secrets, KEIN Provider-Rohkoerper). Muster:
// CustomerMissingError / LlmUnavailableError.
export class PaymentAuthenticationRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaymentAuthenticationRequiredError";
  }
}
