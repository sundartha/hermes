import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const SCHLUESSEL_TRENNER = "|";
const FINGERABDRUCK_LAENGE = 16;
const LEERRAUM = /\s+/g;
const POSIX_TRENNER = "/";

export const BESTAND_OPTION = {
  type: "object",
  properties: { bestand: { type: "string" } },
  additionalProperties: false,
};

const geleseneBestaende = new Map();

export function normalisierterText(text) {
  return text.trim().replace(LEERRAUM, " ");
}

export function fingerabdruck(text) {
  const hash = createHash("sha256").update(normalisierterText(text)).digest("hex");
  return hash.slice(0, FINGERABDRUCK_LAENGE);
}

export function befundSchluessel(pfad, text) {
  return `${pfad}${SCHLUESSEL_TRENNER}${fingerabdruck(text)}`;
}

export function pfadAusSchluessel(schluessel) {
  return schluessel.slice(0, schluessel.lastIndexOf(SCHLUESSEL_TRENNER));
}

export function pfadInDerWurzel(wurzel, datei) {
  return relative(wurzel, datei).split(sep).join(POSIX_TRENNER);
}

function nachDateiGezaehlt(befunde) {
  const nachDatei = new Map();
  for (const schluessel of befunde) {
    const datei = pfadAusSchluessel(schluessel);
    const zaehler = nachDatei.get(datei) ?? new Map();
    zaehler.set(schluessel, (zaehler.get(schluessel) ?? 0) + 1);
    nachDatei.set(datei, zaehler);
  }
  return nachDatei;
}

function gelesenerBestand(pfad) {
  if (!geleseneBestaende.has(pfad)) {
    const befunde = existsSync(pfad) ? JSON.parse(readFileSync(pfad, "utf8")).befunde : [];
    geleseneBestaende.set(pfad, nachDateiGezaehlt(befunde));
  }
  return geleseneBestaende.get(pfad);
}

export function bestandDerDatei(context) {
  const [{ bestand } = {}] = context.options;
  const datei = pfadInDerWurzel(context.cwd, context.filename);
  const nachDatei = bestand === undefined ? new Map() : gelesenerBestand(resolve(context.cwd, bestand));
  const uebrig = new Map(nachDatei.get(datei) ?? []);
  return {
    datei,
    eingefroren(schluessel) {
      const anzahl = uebrig.get(schluessel) ?? 0;
      uebrig.set(schluessel, anzahl - 1);
      return anzahl > 0;
    },
  };
}
