import { readFileSync } from "node:fs";

import { zweckBlock } from "./auftrag/zweck.mjs";

const ZUORDNUNG = JSON.parse(readFileSync(new URL("./zweck/zuordnung/lint-regeln.json", import.meta.url), "utf8"));
export const NAMENSREGEL = "hermes/wort-nur-in";
const NAMENSENDE = ":";
const OHNE_REGEL_ID = "null";
const OHNE_REGEL_NAME = "ohne Regel";
export const OHNE_REGEL = { SYNTAX: "syntax", ABSCHALTKOMMENTAR: "abschaltkommentar" };

function ohneRegel(ruleId) {
  return ruleId === null || ruleId === undefined || ruleId === OHNE_REGEL_ID;
}

function nachMeldung(ruleId, message) {
  const teile = Object.entries(ZUORDNUNG.meldungen[ruleId] ?? {});
  return teile.find(([teil]) => message.includes(teil))?.[1];
}

function nachName(message) {
  const name = message.slice(0, message.indexOf(NAMENSENDE));
  return ZUORDNUNG.namen[NAMENSREGEL][name];
}

export function lintZweckId({ ruleId, message = "", fatal = false }) {
  if (ohneRegel(ruleId)) return ZUORDNUNG.ohneRegel[fatal ? OHNE_REGEL.SYNTAX : OHNE_REGEL.ABSCHALTKOMMENTAR];
  if (ruleId === NAMENSREGEL) return nachName(message);
  return ZUORDNUNG.regeln[ruleId] ?? nachMeldung(ruleId, message);
}

function regelName(ruleId) {
  return ohneRegel(ruleId) ? OHNE_REGEL_NAME : ruleId;
}

export function lintGruppen(befunde) {
  const gruppen = new Map();
  for (const befund of befunde) {
    const id = lintZweckId(befund);
    if (id === undefined) continue;
    if (!gruppen.has(id)) gruppen.set(id, new Set());
    gruppen.get(id).add(regelName(befund.ruleId));
  }
  return [...gruppen].map(([id, regeln]) => ({ id, regeln: [...regeln] }));
}

export function lintZweckZeilen(befunde) {
  return lintGruppen(befunde).flatMap(({ id, regeln }) => [`Zu ${regeln.join(", ")} (${id}):`, ...zweckBlock(id)]);
}
