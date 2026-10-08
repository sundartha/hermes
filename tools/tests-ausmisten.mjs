import { parseArgs } from "node:util";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const AUFRUF = [
  "Aufruf: node tools/tests-ausmisten.mjs",
  "planen --aus <ordner>",
  "| basis --plan-daten <ordner> --paket <nr> --aus <ordner>",
  "| branch --plan-daten <ordner> --basis-daten <ordner> --paket <nr> --aus <ordner>",
  "| melden [--pr]",
].join(" ");
const PFLICHT = {
  planen: ["aus"],
  basis: ["plan-daten", "paket", "aus"],
  branch: ["plan-daten", "basis-daten", "paket", "aus"],
  melden: [],
};

async function befehle() {
  return import("./tests-ausmisten/befehle.mjs");
}

const BEFEHLE = new Map(
  Object.entries({
    planen: async (werte) => (await befehle()).planen({ aus: werte.aus }),
    basis: async (werte) =>
      (await befehle()).basis({
        aus: werte.aus,
        planDaten: werte["plan-daten"],
        paket: werte.paket,
      }),
    branch: async (werte) =>
      (await befehle()).branch({
        aus: werte.aus,
        planDaten: werte["plan-daten"],
        basisDaten: werte["basis-daten"],
        paket: werte.paket,
      }),
    melden: async ({ pr }) => (await import("./tests-ausmisten/melden.mjs")).melden({ pr }),
  }),
);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      aus: { type: "string" },
      "plan-daten": { type: "string" },
      "basis-daten": { type: "string" },
      paket: { type: "string" },
      pr: { type: "boolean", default: false },
    },
  });
  const [name] = positionals;
  const bekannt = BEFEHLE.has(name) && positionals.length === 1;
  if (!bekannt || PFLICHT[name].some((option) => values[option] === undefined)) {
    console.error(AUFRUF);
    return EXIT_ROT;
  }
  const ausgang = await BEFEHLE.get(name)(values);
  return typeof ausgang === "number" ? ausgang : EXIT_GRUEN;
}

try {
  process.exitCode = await main();
} catch (fehler) {
  console.error(`Tests ausmisten: Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ROT;
}
