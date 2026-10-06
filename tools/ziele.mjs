import { cwd } from "node:process";
import { parseArgs } from "node:util";

const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const BEFEHLE = new Map([
  ["vorpruefen", ["./ziele/vorpruefen.mjs", "befehl"]],
  ["waehlen", ["./ziele/waehlen.mjs", "befehl"]],
  ["ergebnis", ["./ziele/ergebnis.mjs", "befehl"]],
]);
const WORKFLOWS = new Set(["aufraeumen", "auswertung"]);
const AUFRUF = [
  `Aufruf: node tools/ziele.mjs <${[...BEFEHLE.keys()].join("|")}> --ordner <ordner>`,
  "        node tools/ziele.mjs ergebnis --ordner <ordner> --workflow <aufraeumen|auswertung>",
].join("\n");

function aufruf() {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      options: { ordner: { type: "string" }, workflow: { type: "string" } },
    });
    const [name, ...rest] = positionals;
    const ohneWorkflow = name === "ergebnis" && !WORKFLOWS.has(values.workflow ?? "");
    if (!BEFEHLE.has(name ?? "") || rest.length > 0 || values.ordner === undefined || ohneWorkflow) return null;
    return { name, optionen: values };
  } catch {
    return null;
  }
}

const gewaehlt = aufruf();
if (gewaehlt === null) {
  console.error(AUFRUF);
  process.exitCode = EXIT_AUFRUF;
} else {
  try {
    const [modul, funktion] = BEFEHLE.get(gewaehlt.name);
    const geladen = await import(modul);
    process.exitCode = await geladen[funktion](gewaehlt.optionen, cwd());
  } catch (fehler) {
    console.error(`Abbruch: ${fehler.message}`);
    process.exitCode = EXIT_ABBRUCH;
  }
}
