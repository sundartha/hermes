import { registerHooks } from "node:module";

const BUDGET = new URL("../../tools/mutationspruefung/budget.mjs", import.meta.url).href;
const EINE_SEKUNDE_MS = 1000;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const ziel = nextResolve(specifier, context);
    return ziel.url === BUDGET ? { url: import.meta.url, shortCircuit: true } : ziel;
  },
});

export const BUDGET_MS = { normal: EINE_SEKUNDE_MS, testumbau: EINE_SEKUNDE_MS };
export const SCHAETZUNG_MS = { aufruf: 0, mutant: 0 };
