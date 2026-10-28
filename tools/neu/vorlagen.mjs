import { readFileSync } from "node:fs";

import { camel, pascal, snake } from "./namen.mjs";

const VORLAGEN = new URL("vorlagen/", import.meta.url);

export function fuelle(vorlage, name, extra = {}) {
  const werte = {
    KEBAB: name,
    PASCAL: pascal(name),
    CAMEL: camel(name),
    SNAKE: snake(name),
    ...extra,
  };
  const text = readFileSync(new URL(`${vorlage}.vorlage`, VORLAGEN), "utf8");
  return text.replace(/%%([A-Z]+)%%/g, (stelle, schluessel) => werte[schluessel] ?? stelle);
}
