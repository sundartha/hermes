import { EXIT_AUFRUF, NeuFehler } from "./fehler.mjs";

const ANFANG = /^[a-z]/;
const TEIL = /^[a-z0-9]+$/;
const TRENNER = "-";
const RESERVIERT = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof var void while with yield".split(
    " ",
  ),
);
const ERSTES = 0;
const REST = 1;

function grossgeschrieben(teil) {
  return teil[ERSTES].toUpperCase() + teil.slice(REST);
}

export function pruefeName(name) {
  if (!ANFANG.test(name) || !name.split(TRENNER).every((teil) => TEIL.test(teil))) {
    throw new NeuFehler(
      EXIT_AUFRUF,
      `Name ${JSON.stringify(name)} ist ungültig: erlaubt sind a-z, 0-9 und Bindestrich, beginnend mit einem Buchstaben.`,
    );
  }
  return name;
}

export function pascal(name) {
  return name.split(TRENNER).map(grossgeschrieben).join("");
}

export function camel(name) {
  const [erstes, ...rest] = name.split(TRENNER);
  return [erstes, ...rest.map(grossgeschrieben)].join("");
}

export function snake(name) {
  return name.split(TRENNER).join("_");
}

export function pruefeFunktionsname(name) {
  const funktion = camel(name);
  if (RESERVIERT.has(funktion)) {
    throw new NeuFehler(
      EXIT_AUFRUF,
      `Name ${JSON.stringify(name)} ergibt den Funktionsnamen ${funktion}, ein reserviertes Wort; wähle einen anderen Namen.`,
    );
  }
}
