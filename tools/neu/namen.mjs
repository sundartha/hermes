import { EXIT_AUFRUF, NeuFehler } from "./fehler.mjs";

const NAME_MUSTER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TRENNER = "-";
const ERSTES = 0;
const REST = 1;

function grossgeschrieben(teil) {
  return teil[ERSTES].toUpperCase() + teil.slice(REST);
}

export function pruefeName(name) {
  if (!NAME_MUSTER.test(name)) {
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
  return name.replaceAll(TRENNER, "_");
}
