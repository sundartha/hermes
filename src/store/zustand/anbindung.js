import * as anrufpause from "./anrufpause.js";
import * as nummern from "./nummern.js";

export function zustandsFunktionen(speicher) {
  const lesend = (funktion) => (...argumente) => funktion(speicher.load(), ...argumente);
  const schreibend = (funktion) => (...argumente) => {
    const { ergebnis, geaendert } = funktion(speicher.load(), ...argumente);
    if (geaendert) speicher.save();
    return ergebnis;
  };
  return {
    anrufpauseAktiv: lesend(anrufpause.anrufpauseAktiv),
    registrierungAnhaengen: schreibend(nummern.registrierungAnhaengen),
  };
}
