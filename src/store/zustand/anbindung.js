import * as anrufpause from "./anrufpause.js";

export function zustandsFunktionen(speicher) {
  const lesend = (funktion) => (...argumente) => funktion(speicher.load(), ...argumente);
  return {
    anrufpauseAktiv: lesend(anrufpause.anrufpauseAktiv),
  };
}
