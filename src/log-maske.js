import { hashEmail, maskNumbersInText } from "./util.js";
import { maskRestrictedText } from "./restricted-data.js";

const VERBORGEN = "***";
const GEHEIMNIS_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)$/i;
const GEHEIMNIS_MINDESTLAENGE = 16;
const LOG_GEHEIMNIS =
  /\b((?:x-hermes-tool-token|xi-api-key|x-api-key|authorization)["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token)\s+)?|bearer\s+|whsec_)[^\s"'`,;{}[\]]+/gi;
const EMAIL_ADRESSE = /(?<![\w.%+-])[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LOG_MASKE = Symbol("logMaske");

const geheimnisWerte = new Set();

function istGeheimnis([name, wert]) {
  return GEHEIMNIS_NAME.test(name) && wert.length >= GEHEIMNIS_MINDESTLAENGE;
}

export function merkeLogGeheimnisse(umgebung) {
  const werte = Object.entries(umgebung).filter(istGeheimnis).map(([, wert]) => wert);
  for (const wert of werte.sort((links, rechts) => rechts.length - links.length)) geheimnisWerte.add(wert);
}

export function maskiereLogText(text) {
  const ohneGeheimnisse = [...geheimnisWerte].reduce((rest, wert) => rest.replaceAll(wert, VERBORGEN), text);
  const ohneToken = maskRestrictedText(ohneGeheimnisse.replace(LOG_GEHEIMNIS, `$1${VERBORGEN}`));
  return maskNumbersInText(ohneToken.replace(EMAIL_ADRESSE, (adresse) => `${VERBORGEN}@${hashEmail(adresse)}`));
}

export function mitLogMaske(schreibe) {
  if (schreibe[LOG_MASKE]) return schreibe;
  const gefiltert = function (stueck, ...rest) {
    return schreibe.call(this, typeof stueck === "string" ? maskiereLogText(stueck) : stueck, ...rest);
  };
  gefiltert[LOG_MASKE] = true;
  return gefiltert;
}
