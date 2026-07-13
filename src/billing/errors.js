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
