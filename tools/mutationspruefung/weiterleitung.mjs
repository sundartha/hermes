import { readFileSync } from "node:fs";

import { gelesen } from "../syntaxbaum.mjs";
import { laufzeitText, umschreibbareQuelle } from "../umbenennung.mjs";

const QUELLDATEI = /^src\/.+\.[cm]?[jt]s$/;
const MODUL = { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: {} };
const WEITERREICHUNG = new Set(["ExportAllDeclaration", "ExportNamedDeclaration"]);

function weitergereichteQuellen(datei) {
  const text = laufzeitText(datei, readFileSync(datei, "utf8"));
  const baum = text === undefined ? undefined : gelesen(text, MODUL);
  if (baum === undefined) return null;
  const quellen = baum.body.filter(({ type, source }) => WEITERREICHUNG.has(type) && source !== null).map(umschreibbareQuelle);
  return quellen.includes(undefined) ? null : new Set(quellen.map(({ value }) => value));
}

export function weitergeleitet(datei, abhaengigkeiten) {
  const quellen = weitergereichteQuellen(datei);
  return abhaengigkeiten
    .filter(({ module, resolved }) => QUELLDATEI.test(resolved) && (quellen === null || quellen.has(module)))
    .map(({ resolved }) => resolved);
}
