import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
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

export function gezaehlt(eintraege) {
  const anzahl = new Map();
  for (const eintrag of eintraege) anzahl.set(eintrag, (anzahl.get(eintrag) ?? 0) + 1);
  return anzahl;
}

export function kontingent(anzahl) {
  const uebrig = new Map(anzahl);
  return (schluessel) => {
    const frei = uebrig.get(schluessel) ?? 0;
    uebrig.set(schluessel, frei - 1);
    return frei > 0;
  };
}

function nachDateiGezaehlt(befunde) {
  const nachDatei = Map.groupBy(befunde, pfadAusSchluessel);
  return new Map([...nachDatei].map(([datei, schluessel]) => [datei, gezaehlt(schluessel)]));
}

function dateiStand(pfad) {
  if (!existsSync(pfad)) return undefined;
  const { mtimeMs, size } = statSync(pfad);
  return `${mtimeMs}${SCHLUESSEL_TRENNER}${size}`;
}

function gelesenerBestand(pfad) {
  const stand = dateiStand(pfad);
  const gelesen = geleseneBestaende.get(pfad);
  if (gelesen !== undefined && gelesen.stand === stand) return gelesen.nachDatei;
  const befunde = stand === undefined ? [] : JSON.parse(readFileSync(pfad, "utf8")).befunde;
  const nachDatei = nachDateiGezaehlt(befunde);
  geleseneBestaende.set(pfad, { stand, nachDatei });
  return nachDatei;
}

export function bestandDerDatei(context) {
  const [{ bestand } = {}] = context.options;
  const datei = pfadInDerWurzel(context.cwd, context.filename);
  const nachDatei = bestand === undefined ? new Map() : gelesenerBestand(resolve(context.cwd, bestand));
  return { datei, eingefroren: kontingent(nachDatei.get(datei) ?? []) };
}
