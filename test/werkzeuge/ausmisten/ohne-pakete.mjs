import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const ergebnis = nextResolve(specifier, context);
    if (ergebnis.url.includes("/node_modules/")) {
      throw new Error(`Fremdpaket ${specifier} geladen von ${context.parentURL}`);
    }
    return ergebnis;
  },
});
