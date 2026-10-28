import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ESLint } from "eslint";

import { reineQuellauslagerung } from "./mutationspruefung/quellauslagerung.mjs";

async function gleicheRegeln(eslint, { root, hilfe }, neu) {
  const [vorher, nachher] = await Promise.all([hilfe, neu].map((pfad) => eslint.calculateConfigForFile(join(root, pfad))));
  return isDeepStrictEqual(vorher.rules, nachher.rules);
}

export async function auslagerungsHerkunft({ von, bis }, root) {
  const auslagerung = await reineQuellauslagerung({ von, bis }, root);
  if (auslagerung === null) return new Map();
  const eslint = new ESLint({ cwd: root });
  const gleich = await Promise.all(auslagerung.neue.map((neu) => gleicheRegeln(eslint, { root, hilfe: auslagerung.hilfe }, neu)));
  return new Map(auslagerung.neue.filter((_neu, stelle) => gleich[stelle]).map((neu) => [neu, auslagerung.hilfe]));
}
