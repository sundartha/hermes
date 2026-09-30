import { cwd } from "node:process";
import { parseArgs } from "node:util";

import { ROLLEN, grenzen, pruefe, rot } from "./auftrag/befehle.mjs";

const EXIT_AUFRUF = 2;
const AUFRUF = [
  "Aufruf: node tools/auftrag.mjs pruefe <phasendatei>",
  "        node tools/auftrag.mjs rot <phasendatei> <auftrag>",
  "        node tools/auftrag.mjs grenzen <phasendatei> <auftrag> --rolle <test|bau> --basis <commit>",
].join("\n");

const BEFEHLE = {
  pruefe: { argumente: 1, fuehreAus: ([phasendatei], root) => pruefe(phasendatei, root) },
  rot: { argumente: 2, fuehreAus: ([phasendatei, kennung], root) => rot(phasendatei, kennung, root) },
  grenzen: {
    argumente: 2,
    optionen: ["rolle", "basis"],
    fuehreAus: ([phasendatei, kennung], root, { rolle, basis }) =>
      grenzen(phasendatei, kennung, { rolle, basis, root }),
  },
};

function gelesen() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: { rolle: { type: "string" }, basis: { type: "string" } },
    });
  } catch {
    return { positionals: [], values: {} };
  }
}

function aufruf() {
  const { positionals, values } = gelesen();
  const [name, ...argumente] = positionals;
  const befehl = BEFEHLE[name];
  if (!Object.hasOwn(BEFEHLE, name ?? "") || argumente.length !== befehl.argumente) return null;
  const fehlend = (befehl.optionen ?? []).some((option) => values[option] === undefined);
  if (fehlend || (values.rolle !== undefined && !ROLLEN.includes(values.rolle))) return null;
  return { befehl, argumente, optionen: values };
}

const gewaehlt = aufruf();
if (gewaehlt === null) {
  console.error(AUFRUF);
  process.exitCode = EXIT_AUFRUF;
} else {
  process.exitCode = gewaehlt.befehl.fuehreAus(gewaehlt.argumente, cwd(), gewaehlt.optionen);
}
