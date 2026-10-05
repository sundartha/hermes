import { spawnSync } from "node:child_process";

const MAX_AUSGABE = 268_435_456;
const ERFOLG = [0];
const KEIN_TREFFER = 1;

function ausgabe(args, erlaubt) {
  const ergebnis = spawnSync("git", args, { encoding: "utf8", maxBuffer: MAX_AUSGABE });
  if (!erlaubt.includes(ergebnis.status)) throw new Error(`git ${args.join(" ")}: ${ergebnis.stderr.trim()}`);
  return ergebnis.status === 0 ? ergebnis.stdout : "";
}

export function git(args) {
  return ausgabe(args, ERFOLG);
}

export function treffer(args) {
  return ausgabe(["grep", ...args], [...ERFOLG, KEIN_TREFFER]);
}

export function inBasis(basis, datei) {
  const ergebnis = spawnSync("git", ["show", `${basis}:${datei}`], { encoding: "utf8", maxBuffer: MAX_AUSGABE });
  return ergebnis.status === 0 ? ergebnis.stdout : undefined;
}
