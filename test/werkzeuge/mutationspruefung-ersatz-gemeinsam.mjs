import { registerHooks } from "node:module";
import { join } from "node:path";
import { cwd } from "node:process";

const PAKET = "@stryker-mutator/core";
const SPALTENBEREICH = /:(\d+):(\d+)-\d+:\d+$/;
const ZEILENBEREICH = /:(\d+)-(\d+)$/;

export function ersetzeStryker(ersatz) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === PAKET) return { url: ersatz, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}

export function gefragteMutanten(muster, { zeile, mutanten }) {
  const genau = SPALTENBEREICH.exec(muster);
  if (genau) return mutanten.filter(({ spalte }) => Number(genau[1]) === zeile && Number(genau[2]) === spalte - 1);
  const [, von, bis] = ZEILENBEREICH.exec(muster);
  return Number(von) <= zeile && zeile <= Number(bis) ? mutanten : [];
}

export function mutantenergebnis({ quelle, zeile, spalte, breite, art }, { status, toeter }) {
  return {
    fileName: join(cwd(), quelle),
    location: { start: { line: zeile, column: spalte }, end: { line: zeile, column: spalte + breite } },
    mutatorName: "EqualityOperator",
    replacement: art,
    status,
    killedBy: toeter === undefined ? undefined : [toeter],
  };
}
