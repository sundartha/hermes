// IEL-B4 (E6/E7/E18): WIE der ziehende Ergebnisweg (elevenlabs/outbound.js) einen Call
// nachbereitet - als REINE Ableitung aus dem persistierten Datensatz. Zwei Politiken:
// jeder Call ohne EL-Inbound-Profil bekommt exakt das heutige Verhalten (in der Praxis
// erreichen nur Outbound-EL-Calls den Poll); ein ueberbrueckter Inbound-Call (Profil
// telnyx_inbound_el_convai) wird nachbereitet, OHNE unser abgerechnetes Telnyx-Bein
// anzutasten: Start-Anker bleibt (E7a), keine Anbieter-Zusammenfassung und kein
// next_steps-Item (E6 - summarizeCall laeuft auf dem EL-Transkript), Beende-Versuch
// ueber das Traeger-Bein statt DELETE (E7b), Frist ab dem Nachlauf-Marker statt
// Anbieter-Deckel (E7c), Ende-Anker = Carrier-Ende (E17), frische Pruefung nach jedem
// Abruf (E18-2). Das Profil ist set-once -> die Politik eines Calls wechselt nie.
import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";

export const BEENDE_VERSUCH = Object.freeze({ EL: "el", TRAEGER: "traeger" });
export const FRIST_ANKER = Object.freeze({ ANBIETER_CAP: "anbieter_cap", NACHLAUF_START: "nachlauf_start" });
export const ENDE_ANKER = Object.freeze({ JETZT: "jetzt", CARRIER_ENDE: "carrier_ende" });

const HEUTIGE_POLITIK = Object.freeze({
  ankerNachziehen: true,
  anbieterZusammenfassung: true,
  naechsteSchritteAlsAufgabe: true,
  beendeVersuch: BEENDE_VERSUCH.EL,
  fristAnker: FRIST_ANKER.ANBIETER_CAP,
  endeAnker: ENDE_ANKER.JETZT,
  frischPruefenNachAbruf: false,
});

const INBOUND_EL_POLITIK = Object.freeze({
  ankerNachziehen: false,
  anbieterZusammenfassung: false,
  naechsteSchritteAlsAufgabe: false,
  beendeVersuch: BEENDE_VERSUCH.TRAEGER,
  fristAnker: FRIST_ANKER.NACHLAUF_START,
  endeAnker: ENDE_ANKER.CARRIER_ENDE,
  frischPruefenNachAbruf: true,
});

// null/undefined -> heutige Politik (bridgeStateOf liest optional) - ein verschwundener
// Call faellt auf das Bestandsverhalten, das seinen Fall schon selbst abfaengt.
export function nachlaufPolitikFuer(call) {
  return bridgeStateOf(call) === BRIDGE_STATE.KEIN_EL_INBOUND ? HEUTIGE_POLITIK : INBOUND_EL_POLITIK;
}

// E7(e)/E18(2): darf ein Poll-Takt noch wirken (Frist-Abschluss, Abschluss, Folgetakt)?
// EINE Formulierung fuer Taktbeginn, frische Pruefung nach dem Abruf und Boot-Re-Arm (G5).
// Fuer jeden Call ohne EL-Inbound-Profil identisch zu "status === 'active'".
export function pollDarfWirken(call) {
  return call?.status === "active" && bridgeStateOf(call) !== BRIDGE_STATE.RUECKFALL;
}
