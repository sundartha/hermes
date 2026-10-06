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

export function nachlaufPolitikFuer(call) {
  return bridgeStateOf(call) === BRIDGE_STATE.KEIN_EL_INBOUND ? HEUTIGE_POLITIK : INBOUND_EL_POLITIK;
}

export function pollDarfWirken(call) {
  return call?.status === "active" && bridgeStateOf(call) !== BRIDGE_STATE.RUECKFALL;
}
