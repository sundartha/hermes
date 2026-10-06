import { createHash } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";

const NUL = "\0";
const NAME_STATUS = /([A-Z])\d*\0([^\0]+)\0/g;

export function schreibePatch(root, datei) {
  mkdirSync(dirname(datei), { recursive: true });
  gitAusgabe(["add", "-A"], root);
  const patch = gitAusgabe(["diff", "--cached", "--binary", "--no-renames", "HEAD"], root);
  writeFileSync(datei, patch);
  return patch;
}

export function patchPruefsumme(text) {
  return createHash("sha256").update(text).digest("hex");
}

function apply(root, datei, ziel) {
  if (statSync(datei).size === 0) return false;
  gitAusgabe(["apply", ziel, "--whitespace=nowarn", datei], root);
  return true;
}

export function wendeAn(root, datei) {
  return apply(root, datei, "--index");
}

export function merkeVor(root, datei) {
  return apply(root, datei, "--cached");
}

function nameStatus(root, argumente) {
  const ausgabe = gitAusgabe(["diff", "--name-status", "--no-renames", "-z", ...argumente], root);
  return [...ausgabe.matchAll(NAME_STATUS)].map(([, status, pfad]) => ({ status, path: pfad }));
}

export function geaenderteGegen(root, basis) {
  return nameStatus(root, [basis, "HEAD"]);
}

export function vorgemerkteAenderungen(root) {
  return nameStatus(root, ["--cached", "HEAD"]);
}

export function arbeitsbaumAenderungen(root) {
  return gitAusgabe(["diff", "--name-only", "-z"], root).split(NUL).filter(Boolean);
}
