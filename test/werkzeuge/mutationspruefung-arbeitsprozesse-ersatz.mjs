import { appendFileSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { env } from "node:process";

const PAKET = "@stryker-mutator/core";

os.availableParallelism = () => Number(env.KERNE);
syncBuiltinESMExports();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === PAKET) return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
  }

  async runMutationTest() {
    appendFileSync(env.ARBEITSPROZESSE, `${this.#optionen.concurrency}\n`);
    return [];
  }
}
