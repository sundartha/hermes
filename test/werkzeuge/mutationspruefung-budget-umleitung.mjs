import { registerHooks } from "node:module";

const BUDGET = new URL("../../tools/mutationspruefung/budget.mjs", import.meta.url).href;

export function leiteBudgetUm(ersatz) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const ziel = nextResolve(specifier, context);
      return ziel.url === BUDGET ? { url: ersatz, shortCircuit: true } : ziel;
    },
  });
}
