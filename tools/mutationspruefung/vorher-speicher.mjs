import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { arch, pid, platform, version } from "node:process";
import { dirname, join } from "node:path";

import { gemeinsamerOrdner, git } from "../auftrag/git.mjs";

const ABLAGE = join("hermes", "testumbau-vorher");
export const SCHLUESSEL_ANZEIGE = 12;
const GELOESCHT = "fehlt";
const NUL = "\0";
export const HERKUNFT_CI = "ci";
const PFADE_AUS_DEM_NEUEN_STAND = [
  "tools",
  "stryker.config.json",
  "package.json",
  "package-lock.json",
  "src/utils/object.js",
  "test/testbaenke-run.mjs",
  "test/i18n-catalog-run.mjs",
  "test/abnahme-ausgewandert.json",
];
export const INSTALLIERTE_MODULE = "node_modules/.package-lock.json";

export function werkzeugEingaben(root) {
  const liste = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...PFADE_AUS_DEM_NEUEN_STAND], { cwd: root });
  return [...new Set([...liste.split(NUL).filter(Boolean), INSTALLIERTE_MODULE])].sort();
}

function inhaltsHash(root, pfad) {
  const datei = join(root, pfad);
  const art = lstatSync(datei, { throwIfNoEntry: false });
  if (art === undefined) return GELOESCHT;
  if (!art.isFile()) return null;
  return createHash("sha256").update(readFileSync(datei)).digest("hex");
}

export function werkzeugStand(root) {
  const werkzeug = werkzeugEingaben(root).map((pfad) => [pfad, inhaltsHash(root, pfad)]);
  if (werkzeug.some(([, hash]) => hash === null)) return null;
  return { werkzeug, node: version, plattform: `${platform}-${arch}` };
}

export function vorherSchluessel(basis, geaendert, root) {
  const stand = werkzeugStand(root);
  if (stand === null) return null;
  const teile = {
    basis: git(["rev-parse", `${basis}:`], { cwd: root }).trim(),
    geaendert: [...geaendert].sort(),
    ...stand,
  };
  return createHash("sha256").update(JSON.stringify(teile)).digest("hex");
}

function ablage(root, schluessel) {
  return gemeinsamerOrdner(root, ABLAGE, `${schluessel}.json`);
}

function schreibeAb(datei, ergebnis) {
  mkdirSync(dirname(datei), { recursive: true });
  const zwischen = `${datei}.${pid}.neu`;
  writeFileSync(zwischen, `${JSON.stringify(ergebnis)}\n`);
  renameSync(zwischen, datei);
}

function herkunftsText({ herkunft }) {
  if (herkunft?.art !== HERKUNFT_CI) return "";
  return `, gerechnet in der CI: Lauf ${herkunft.lauf} auf ${herkunft.plattform}, Kopf ${herkunft.kopf.slice(0, SCHLUESSEL_ANZEIGE)}`;
}

export async function mitVorherSpeicher({ basis, geaendert, root }, rechne) {
  const schluessel = vorherSchluessel(basis, geaendert, root);
  if (schluessel === null) {
    console.log("Vorher-Speicher aus: eine Eingabe des Werkzeugs ist keine gewöhnliche Datei und lässt sich nicht in den Schlüssel nehmen.");
    return rechne();
  }
  const datei = ablage(root, schluessel);
  if (existsSync(datei)) {
    const gespeichert = JSON.parse(readFileSync(datei, "utf8"));
    console.log(
      `Vorher-Seite aus dem Speicher (Schlüssel ${schluessel.slice(0, SCHLUESSEL_ANZEIGE)}${herkunftsText(gespeichert)}).`,
    );
    return gespeichert;
  }
  const ergebnis = await rechne();
  schreibeAb(datei, ergebnis);
  return ergebnis;
}

export function legeVorherAb({ basis, geaendert, root }, ergebnis) {
  const schluessel = vorherSchluessel(basis, geaendert, root);
  if (schluessel === null) throw new Error("eine Eingabe des Werkzeugs ist keine gewöhnliche Datei; der Vorher-Speicher ist aus");
  const datei = ablage(root, schluessel);
  if (existsSync(datei)) return { schluessel, neu: false };
  schreibeAb(datei, ergebnis);
  return { schluessel, neu: true };
}
