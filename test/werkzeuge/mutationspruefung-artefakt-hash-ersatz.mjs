import { registerHooks } from "node:module";

const GRENZE_MODUL = "gegenprobe-grenze.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(GRENZE_MODUL)) return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

export const DATEIGRENZE_MS = 3000;
