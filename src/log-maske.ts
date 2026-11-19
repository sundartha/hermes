import { hashEmail, maskNumbersInText } from "./util.ts";
import { maskRestrictedText } from "./restricted-data.ts";

const VERBORGEN = "***";
const GEHEIMNIS_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)$/i;
const GEHEIMNIS_MINDESTLAENGE = 16;
const HERZSCHLAG_ADRESSE_NAME = "HERZSCHLAG_URL";
const LOG_GEHEIMNIS =
  /\b((?:x-hermes-tool-token|xi-api-key|x-api-key|authorization)["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token)\s+)?|bearer\s+|whsec_)[^\s"'`,;{}[\]]+/gi;
const EMAIL_ADRESSE = /(?<![\w.%+-])[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LOG_MASKE = Symbol("logMaske");

type Eintrag = [name: string, wert: string];
type Schreiber = ((this: unknown, stueck: unknown, ...rest: unknown[]) => unknown) & { [LOG_MASKE]?: true };

const geheimnisWerte = new Set<string>();

function istGeheimnis([name, wert]: Eintrag): boolean {
  if (name === HERZSCHLAG_ADRESSE_NAME) return wert.length > 0;
  return GEHEIMNIS_NAME.test(name) && wert.length >= GEHEIMNIS_MINDESTLAENGE;
}

export function merkeLogGeheimnisse(umgebung: Readonly<Record<string, string>>): void {
  const werte = Object.entries(umgebung).filter(istGeheimnis).map(([, wert]) => wert);
  for (const wert of werte.sort((links, rechts) => rechts.length - links.length)) geheimnisWerte.add(wert);
}

export function merkeLogGeheimnis(wert: string | undefined): void {
  if (wert) geheimnisWerte.add(wert);
}

export function maskiereLogText(text: string): string {
  const ohneGeheimnisse = [...geheimnisWerte].reduce((rest, wert) => rest.replaceAll(wert, VERBORGEN), text);
  const ohneToken = maskRestrictedText(ohneGeheimnisse.replace(LOG_GEHEIMNIS, `$1${VERBORGEN}`));
  return maskNumbersInText(ohneToken.replace(EMAIL_ADRESSE, (adresse: string) => `${VERBORGEN}@${hashEmail(adresse)}`));
}

export function mitLogMaske(schreibe: Schreiber, innen: (schreiber: Schreiber) => Schreiber = (schreiber) => schreiber): Schreiber {
  if (schreibe[LOG_MASKE]) return schreibe;
  const darunter = innen(schreibe);
  const gefiltert: Schreiber = function (this: unknown, stueck: unknown, ...rest: unknown[]) {
    return darunter.call(this, typeof stueck === "string" ? maskiereLogText(stueck) : stueck, ...rest);
  };
  gefiltert[LOG_MASKE] = true;
  return gefiltert;
}
