import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { arch, pid, platform, version } from "node:process";
import { dirname, join } from "node:path";

import { gemeinsamerOrdner, git, offenePfade } from "../auftrag/git.mjs";

const ABLAGE = join("hermes", "testumbau-vorher");
const SCHLUESSEL_ANZEIGE = 12;
const GELOESCHT = "fehlt";

function ungespeicherteDateien(root, geaendert) {
  const erlaubt = new Set(geaendert);
  const offen = offenePfade(root);
  return offen.every((pfad) => erlaubt.has(pfad)) ? offen : null;
}

function inhaltsHash(root, pfad) {
  const datei = join(root, pfad);
  const art = lstatSync(datei, { throwIfNoEntry: false });
  if (art === undefined) return GELOESCHT;
  if (!art.isFile()) return null;
  return createHash("sha256").update(readFileSync(datei)).digest("hex");
}

export function vorherSchluessel(basis, geaendert, root) {
  const offen = ungespeicherteDateien(root, geaendert);
  if (offen === null) return null;
  const ungespeichert = offen.map((pfad) => [pfad, inhaltsHash(root, pfad)]);
  if (ungespeichert.some(([, hash]) => hash === null)) return null;
  const teile = {
    basis: git(["rev-parse", `${basis}:`], { cwd: root }).trim(),
    geaendert: [...geaendert].sort(),
    kopf: git(["rev-parse", "HEAD^{tree}"], { cwd: root }).trim(),
    ungespeichert,
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
    console.log(
      "Vorher-Speicher aus: ungespeicherte Änderungen lassen sich nicht in den Schlüssel nehmen.",
    );
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
