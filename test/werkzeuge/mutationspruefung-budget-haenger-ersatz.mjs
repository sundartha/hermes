import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { env } from "node:process";

const BUDGET = new URL("../../tools/mutationspruefung/budget.mjs", import.meta.url).href;
const PAKET = "@stryker-mutator/core";
const FUENF_SEKUNDEN_MS = 5000;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === PAKET) return { url: import.meta.url, shortCircuit: true };
    const ziel = nextResolve(specifier, context);
    return ziel.url === BUDGET ? { url: import.meta.url, shortCircuit: true } : ziel;
  },
});

export const BUDGET_MS = { normal: FUENF_SEKUNDEN_MS, testumbau: FUENF_SEKUNDEN_MS };
export const SCHAETZUNG_MS = { aufruf: 0, mutant: 0 };

export class Stryker {
  runMutationTest() {
    const kind = spawn("sleep", ["600"], { stdio: "ignore" });
    appendFileSync(env.HAENGER_PROTOKOLL, `${kind.pid}\n`);
    return new Promise(() => {});
  }
}
