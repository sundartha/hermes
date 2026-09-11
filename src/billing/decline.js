// GP-P1 (PLAN-GELDPFAD.md 2, "Ablehnungsgrund des Holds"): der Grund einer Anbieter-
// Ablehnung wird EINMAL erhoben und ZWEIMAL geliefert - als getyptes Feld am Fehler
// (Steuerung) und als Text-Anhang an der Meldung (Menschendiagnose). Zwei Transportwege
// fuer dieselbe Information sind bewusst redundant (Pre-Mortem 6): waere der Text der
// einzige Weg, wuerde ein spaeterer Wortlaut-Edit eine stille Steuerung kippen.
//
// WARUM EIN EIGENES MODUL: der Feldname des getypten Felds ist der Vertrag, den GP-P4
// liest. Er steht hier EINMAL (Schreiber unten); jede andere Stelle bekommt ihn ueber
// diese Funktionen, nicht als kopierte Zeichenkette (G5).
//
// EINGABE ist der GEPARSTE Stripe-Fehlerkoerper - dieselbe Form wie isAlreadyCapturedError
// und billingErrorFor in stripe.js (G11). Das Feld am Fehler heisst dagegen bewusst
// anbieter-neutral: der Aufrufer unterscheidet Ablehnungsklassen, nicht Anbieter.

// G5: die Enum-Form ist nicht decline-spezifisch - GP-P2 prueft den Zahlungsmethoden-
// Typ mit derselben Verengung (provider-enum.js).
import { enumOrNull } from "./provider-enum.js";

// Genau drei Felder, feste Enums, NIE Freitext, NIE verschachtelte Objekte: error.
// payment_method / billing_details / payment_intent tragen Name, E-Mail und Anschrift des
// Kunden (belegt im Vorfall vom 11.09.2026). Schluessel = Feld der schmalen Sicht,
// Wert = Stripe-Feldname, der zugleich das Etikett im Diagnose-Text ist (EINE Quelle).
const DECLINE_FIELDS = Object.freeze({
  code: "code",
  declineCode: "decline_code",
  type: "type",
});

// Erhebt den Ablehnungsgrund GENAU EINMAL aus dem Fehlerkoerper: das Enum-Trio
// code/decline_code/type, sonst nichts. Liefert IMMER alle drei Felder (fehlend/kein
// Enum -> null), nie undefined - der Aufrufer muss nie auf Feld-Abwesenheit pruefen.
export function declineOf(errorBody) {
  const err = (errorBody && errorBody.error) || {};
  const sicht = {};
  for (const [feld, stripeName] of Object.entries(DECLINE_FIELDS))
    sicht[feld] = enumOrNull(err[stripeName]);
  return Object.freeze(sicht);
}

// Menschenlesbarer Diagnose-Text aus einer bereits erhobenen Sicht (declineOf-Ergebnis):
// "code=x decline_code=y type=z", jedes leere Feld faellt weg. "" wenn nichts vorliegt.
// In zwei Schritten (G36, Demeter-Kette): der Zwischenwert haelt die Kette flach.
export function declineDetail(decline) {
  const gesetzteFelder = Object.entries(DECLINE_FIELDS).filter(([feld]) => decline[feld]);
  return gesetzteFelder.map(([feld, stripeName]) => `${stripeName}=${decline[feld]}`).join(" ");
}

// Nebeneffekt im Namen (N7): haengt das getypte Feld an den uebergebenen Fehler und gibt
// ihn zurueck, damit der Aufrufer in einem Ausdruck werfen kann. Object.assign statt einer
// direkten Property-Zuweisung (P6/no-param-reassign: Parameter-Properties duerfen nicht
// direkt mutiert werden) - der beobachtbare Effekt (err traegt providerDecline danach) ist
// derselbe. Der Feldname ist NICHT 'code' - 'code' liest mcp-tools.js als Lokalisierungs-
// Schluessel, und ein Fehler mit unbekanntem code bekaeme dort stillschweigend einen
// anderen Text.
export function attachProviderDecline(err, decline) {
  return Object.assign(err, { providerDecline: decline });
}
