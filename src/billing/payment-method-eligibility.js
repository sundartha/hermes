// GP-P2 (PLAN-GELDPFAD.md 2): eine hinterlegte Zahlungsmethode ist nicht automatisch
// eine HOLD-faehige. Der Vorfall vom 11.09.2026: ein payment_method vom Typ 'link'
// trug die Abo-Zahlung (4,99 EUR) und lehnte sechs Sekunden spaeter den 92-Cent-Hold ab.
// Stripe listet fuer getrennte Autorisierung und Erfassung Karten, Affirm, Afterpay,
// Cash App Pay, Klarna und PayPal - 'link' steht dort nicht (Wallet ueber Karten,
// US-Bankkonten und BNPL; ein Bankkonto traegt nie einen Hold).
//
// ALLOWLIST, NIE DENYLIST (Pre-Mortem 1): "wenn type==='link', ablehnen" laesst jeden
// kuenftigen Wallet-Typ durch und meldet den Fix trotzdem als erledigt. Hier gilt der
// Umkehrschluss - was nicht dasteht, faellt durch. Falsch-negativ (ein neuer, wirklich
// hold-faehiger Typ wird zunaechst abgelehnt) ist billiger als falsch-positiv (ein
// zahlender Kunde ohne Nummer).
//
// WARUM NUR 'card': unser Hold ist ein off_session-PaymentIntent mit capture_method=
// manual und confirm=true (stripe.js placeHold). Die uebrigen von Stripe genannten
// Methoden verlangen eine Kunden-Interaktion und koennen unbeaufsichtigt gar nicht
// bestaetigt werden. Owner-Entscheidung 2026-09-11, Frage 4: nur Karte. Wallet-Karten
// (Apple/Google Pay) kommen bei Stripe als type='card' an und passieren damit regulaer.
// Ein weiterer Eintrag ist eine bewusste, getestete Entscheidung - kein Einzeiler.
export const PAYMENT_METHOD_TYPE_CARD = "card";

const HOLD_CAPABLE_PAYMENT_METHOD_TYPES = Object.freeze([PAYMENT_METHOD_TYPE_CARD]);

// Reines Praedikat, keine Nebeneffekte, kein Store, kein IO. null/undefined/unbekannt ->
// false (fail-closed, Owner-Entscheidung 2026-09-11, Frage 5: Unbekannt gilt als
// ungeeignet). EINZIGE Stelle im Repo, die ueber Eignung entscheidet (G5).
export function isHoldCapablePaymentMethodType(paymentMethodType) {
  return HOLD_CAPABLE_PAYMENT_METHOD_TYPES.includes(paymentMethodType);
}
