import { readFileSync } from "node:fs";

const KONFIG_QUELLE = new URL("../src/config.js", import.meta.url);
const FESTER_ZUGRIFF = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
const UNSICHTBARER_ZUGRIFF = /process\.env\[|=\s*process\.env\s*[;,]/;

export function namenAusQuelltext(quelltext) {
  if (UNSICHTBARER_ZUGRIFF.test(quelltext)) {
    throw new Error("config.js liest die Umgebung nicht mehr nur als process.env.NAME; die Namen sind nicht mehr ermittelbar");
  }
  return new Set([...quelltext.matchAll(FESTER_ZUGRIFF)].map((treffer) => treffer[1]));
}

export function konfigurationsNamen() {
  return namenAusQuelltext(readFileSync(KONFIG_QUELLE, "utf8"));
}
