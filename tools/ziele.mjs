import { cwd } from "node:process";
import { parseArgs } from "node:util";

const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const BEFEHLE = new Map([
  ["vorpruefen", () => import("./ziele/vorpruefen.mjs").then((modul) => modul.befehl)],
  ["waehlen", () => import("./ziele/waehlen.mjs").then((modul) => modul.befehl)],
  ["fixen", () => import("./ziele/fixer.mjs").then((modul) => modul.befehl)],
  ["agent", () => import("./ziele/agentenlauf.mjs").then((modul) => modul.befehl)],
  ["pruefen", () => import("./ziele/pruefen.mjs").then((modul) => modul.befehl)],
  ["commit", () => import("./ziele/pr.mjs").then((modul) => modul.committe)],
  ["pr", () => import("./ziele/pr.mjs").then((modul) => modul.oeffnePr)],
  ["ergebnis", () => import("./ziele/ergebnis.mjs").then((modul) => modul.befehl)],
  ["zaehlen", () => import("./ziele/auswertung.mjs").then((modul) => modul.zaehlen)],
  ["vorschlagen", () => import("./ziele/auswertung.mjs").then((modul) => modul.vorschlagen)],
  ["system-issue", () => import("./ziele/auswertung.mjs").then((modul) => modul.systemIssue)],
]);
const WORKFLOWS = new Set(["aufraeumen", "auswertung"]);
const BEFEHLSNAMEN = [...BEFEHLE.keys()].join("|");
const AUFRUF = [
  ["Aufruf: node tools/ziele.mjs", "<" + BEFEHLSNAMEN + ">", "--ordner <ordner>"].join(" "),
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
    const befehl = await BEFEHLE.get(gewaehlt.name)();
    process.exitCode = await befehl(gewaehlt.optionen, cwd());
  } catch (fehler) {
    console.error(`Abbruch: ${fehler.message}`);
    process.exitCode = EXIT_ABBRUCH;
  }
}
