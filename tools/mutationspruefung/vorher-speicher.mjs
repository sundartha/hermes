import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { arch, pid, platform, version } from "node:process";
import { dirname, join } from "node:path";

import { gemeinsamerOrdner, git } from "../auftrag/git.mjs";

const ABLAGE = join("hermes", "testumbau-vorher");
const SCHLUESSEL_ANZEIGE = 12;
const GELOESCHT = "fehlt";
const NUL = "\0";
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
const INSTALLIERTE_MODULE = "node_modules/.package-lock.json";

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

export function vorherSchluessel(basis, geaendert, root) {
  const werkzeug = werkzeugEingaben(root).map((pfad) => [pfad, inhaltsHash(root, pfad)]);
  if (werkzeug.some(([, hash]) => hash === null)) return null;
  const teile = {
    basis: git(["rev-parse", `${basis}:`], { cwd: root }).trim(),
    geaendert: [...geaendert].sort(),
    werkzeug,
    node: version,
    plattform: `${platform}-${arch}`,
  };
  return createHash("sha256").update(JSON.stringify(teile)).digest("hex");
}

function ablage(root, schluessel) {
  return gemeinsamerOrdner(root, ABLAGE, `${schluessel}.json`);
}

export async function mitVorherSpeicher({ basis, geaendert, root }, rechne) {
  const schluessel = vorherSchluessel(basis, geaendert, root);
  if (schluessel === null) {
    console.log("Vorher-Speicher aus: eine Eingabe des Werkzeugs ist keine gewöhnliche Datei und lässt sich nicht in den Schlüssel nehmen.");
    return rechne();
  }
  const datei = ablage(root, schluessel);
  if (existsSync(datei)) {
    console.log(
      `Vorher-Seite aus dem Speicher (Schlüssel ${schluessel.slice(0, SCHLUESSEL_ANZEIGE)}).`,
    );
    return JSON.parse(readFileSync(datei, "utf8"));
  }
  const ergebnis = await rechne();
  mkdirSync(dirname(datei), { recursive: true });
  const zwischen = `${datei}.${pid}.neu`;
  writeFileSync(zwischen, `${JSON.stringify(ergebnis)}\n`);
  renameSync(zwischen, datei);
  return ergebnis;
}
