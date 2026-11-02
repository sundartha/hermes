import { parseArgs } from "node:util";

import { EXIT_ABBRUCH, vorpruefenUndPushen } from "./vorpruefung/ablauf.mjs";

const AUFRUF = "Aufruf: node tools/vorpruefung.mjs --branch paket/<name> --erwartet <sha auf upstream oder neu>";

function optionen() {
  try {
    return parseArgs({ options: { branch: { type: "string" }, erwartet: { type: "string" } } }).values;
  } catch {
    return null;
  }
}

const werte = optionen();
if (werte === null || werte.branch === undefined || werte.erwartet === undefined) {
  console.error(AUFRUF);
  process.exitCode = EXIT_ABBRUCH;
} else {
  const { exitCode, zeilen } = await vorpruefenUndPushen({ root: process.cwd(), branch: werte.branch, erwartet: werte.erwartet });
  for (const zeile of zeilen) (exitCode === 0 ? console.log : console.error)(zeile);
  process.exitCode = exitCode;
}
