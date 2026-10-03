import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";

const BLOCKNAME = "zeitglieder-in-tests";
const BASIS = "tools/basis/zeitglieder-bestand.json";

async function regelnAusKonfiguration(wurzel) {
  const adresse = pathToFileURL(path.join(wurzel, "eslint.config.js")).href;
  const { default: konfiguration } = await import(adresse);
  return konfiguration.find(({ name }) => name === BLOCKNAME).rules;
}

async function zaehleJeDatei(wurzel, dateien) {
  const rules = await regelnAusKonfiguration(wurzel);
  const eslint = new ESLint({
    cwd: wurzel,
    overrideConfigFile: true,
    overrideConfig: { files: ["**/*.js", "**/*.mjs", "**/*.cjs"], rules },
  });
  const ergebnisse = await eslint.lintFiles(dateien);
  const regeln = new Set(Object.keys(rules));
  return new Map(
    ergebnisse.map(({ filePath, messages }) => [
      path.relative(wurzel, filePath),
      messages.filter(({ ruleId }) => regeln.has(ruleId)).length,
    ]),
  );
}

function befundFuer(datei, eingefroren, gezaehlt) {
  if (gezaehlt === undefined || gezaehlt === 0) {
    return `${BASIS}: ${datei} hat keine direkten Zeitglieder mehr, Eintrag entfernen`;
  }
  if (gezaehlt > eingefroren) {
    return `${datei}: ${gezaehlt} direkte Zeitglieder, eingefroren sind ${eingefroren}. Neue Wartezeit nur über echtWarten(ms).`;
  }
  if (gezaehlt < eingefroren) {
    return `${BASIS}: ${datei} hat nur noch ${gezaehlt} direkte Zeitglieder, Eintrag auf ${gezaehlt} senken`;
  }
  return null;
}

export async function zeitgliederBefunde(wurzel, bestand) {
  const vorhanden = Object.keys(bestand).filter((datei) => existsSync(path.join(wurzel, datei)));
  const gezaehlt = vorhanden.length > 0 ? await zaehleJeDatei(wurzel, vorhanden) : new Map();
  return Object.entries(bestand)
    .map(([datei, eingefroren]) => befundFuer(datei, eingefroren, gezaehlt.get(datei)))
    .filter(Boolean);
}
