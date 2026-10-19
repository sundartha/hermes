import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { cwd, env } from "node:process";

const PAKET = "@stryker-mutator/core";
const BEREICH = /^(.+?)(?::(\d+)-(\d+))?$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === PAKET) return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

function stelle(zeilen, text) {
  const nummer = zeilen.findIndex((zeile) => zeile.includes(text));
  return nummer === -1 ? undefined : { line: nummer + 1, column: zeilen[nummer].indexOf(text) };
}

function ergebnis(regel, { datei, zeilen, tests }) {
  const ende = regel.bis ?? regel.text;
  const [start, schluss] = [stelle(zeilen, regel.text), stelle(zeilen, ende)];
  if (start === undefined || schluss === undefined) return undefined;
  return {
    fileName: join(cwd(), datei),
    location: { start, end: { line: schluss.line, column: schluss.column + ende.length } },
    mutatorName: regel.mutator,
    replacement: regel.ersatz,
    status: regel.toetend.some((test) => tests.includes(test)) ? "Killed" : "Survived",
  };
}

function imBereich({ location }, von, bis) {
  return (
    von === undefined || (location.start.line >= Number(von) && location.end.line <= Number(bis))
  );
}

function mutanten(eintrag, { regeln, tests }) {
  const [, datei, von, bis] = BEREICH.exec(eintrag);
  const zeilen = readFileSync(join(cwd(), datei), "utf8").split("\n");
  return regeln
    .filter((regel) => regel.datei === datei)
    .map((regel) => ergebnis(regel, { datei, zeilen, tests }))
    .filter((mutant) => mutant !== undefined && imBereich(mutant, von, bis));
}

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
  }

  async runMutationTest() {
    const regeln = JSON.parse(readFileSync(env.STRYKER_ERSATZ, "utf8"));
    const tests = this.#optionen.tap.testFiles;
    return this.#optionen.mutate.flatMap((eintrag) => mutanten(eintrag, { regeln, tests }));
  }
}
