import { spawnSync } from "node:child_process";

const ZUGANGSDATEN_IN_ADRESSE = /:\/\/[^@/\s]+@/g;
const MAX_GRUND_ZEICHEN = 200;

export function befehl(programm, argumente, eingabe) {
  const lauf = spawnSync(programm, argumente, { encoding: "utf8", input: eingabe });
  if (lauf.error) throw new Error(`${programm} ließ sich nicht starten: ${lauf.error.message}`);
  return lauf;
}

export function bereinigt(text) {
  return text.replace(ZUGANGSDATEN_IN_ADRESSE, "://***@").trim().slice(0, MAX_GRUND_ZEICHEN);
}

export function git(argumente, eingabe) {
  const lauf = befehl("git", argumente, eingabe);
  if (lauf.status !== 0) {
    const zeilen = lauf.stderr.split("\n").filter((zeile) => zeile.trim() !== "");
    throw new Error(`git ${argumente[0]} ist gescheitert: ${bereinigt(zeilen.at(-1) ?? "")}`);
  }
  return lauf.stdout;
}
