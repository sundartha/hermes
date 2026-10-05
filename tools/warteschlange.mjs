import { cwd } from "node:process";
import { parseArgs } from "node:util";

import { eingrenzen } from "./warteschlange/eingrenzen.mjs";
import { gleicherStand, prNummer } from "./warteschlange/gleicher-stand.mjs";
import { melden } from "./warteschlange/melden.mjs";
import { prueferStatus } from "./warteschlange/pruefer-status.mjs";
import { wackeligeIssues } from "./warteschlange/wackelig-issues.mjs";
import { zuruecknehmen } from "./warteschlange/zuruecknehmen.mjs";

const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const UNTERBEFEHLE = new Map([
  ["pr-nummer", { pflicht: ["ref"], start: (werte) => prNummer(werte) }],
  ["gleicher-stand", { pflicht: ["ref", "basis"], start: (werte, ort) => gleicherStand(werte, ort) }],
  ["wackelig", { pflicht: ["ordner"], start: (werte, ort) => wackeligeIssues(werte, ort) }],
  ["pruefer-status", { pflicht: [], start: (werte, ort) => prueferStatus(werte, ort) }],
  ["zuruecknehmen", { pflicht: ["ordner"], start: (werte, ort) => zuruecknehmen(werte, ort) }],
  ["eingrenzen", { pflicht: ["ergebnis", "ordner"], start: (werte, ort) => eingrenzen(werte, ort) }],
  ["melden", { pflicht: [], start: (werte, ort) => melden(werte, ort) }],
]);
const OPTIONEN = ["ref", "basis", "ordner", "ergebnis"];

function hilfe() {
  const zeilen = [...UNTERBEFEHLE].map(
    ([name, { pflicht }]) =>
      `  node tools/warteschlange.mjs ${name}${pflicht.map((option) => ` --${option} <wert>`).join("")}`,
  );
  return ["Aufruf:", ...zeilen].join("\n");
}

function auswahl() {
  let gelesen;
  try {
    gelesen = parseArgs({
      allowPositionals: true,
      options: Object.fromEntries(OPTIONEN.map((option) => [option, { type: "string" }])),
    });
  } catch {
    return null;
  }
  const [name, ...rest] = gelesen.positionals;
  const befehl = UNTERBEFEHLE.get(name ?? "");
  if (befehl === undefined || rest.length > 0) return null;
  const vollstaendig = befehl.pflicht.every((option) => gelesen.values[option] !== undefined);
  return vollstaendig ? { befehl, werte: gelesen.values } : null;
}

const gewaehlt = auswahl();
if (gewaehlt === null) {
  console.error(hilfe());
  process.exitCode = EXIT_AUFRUF;
} else {
  try {
    process.exitCode = await gewaehlt.befehl.start(gewaehlt.werte, cwd());
  } catch (fehler) {
    console.error(`Warteschlange: Abbruch: ${fehler.message}`);
    process.exitCode = EXIT_ABBRUCH;
  }
}
