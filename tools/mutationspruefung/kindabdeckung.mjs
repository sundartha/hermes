import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import { createTapTestRunnerFactory } from "@stryker-mutator/tap-runner";

import { mitKindern } from "./kindabdeckung-ablage.mjs";
import { KINDABDECKUNG_ORDNER } from "./zustand.mjs";

export const KINDABDECKUNG = "tap-kindabdeckung";
const ORDNERPRAEFIX = "kindabdeckung-";
const TEST_RUNNER = "TestRunner";
const INJEKTOR = "$injector";
const tapRunner = createTapTestRunnerFactory();

function tapMitKindabdeckung(injector) {
  const runner = tapRunner(injector);
  const probelauf = runner.dryRun.bind(runner);
  runner.dryRun = async (optionen) => {
    const ordner = mkdtempSync(join(tmpdir(), ORDNERPRAEFIX));
    env[KINDABDECKUNG_ORDNER] = ordner;
    try {
      const ergebnis = await probelauf(optionen);
      if (ergebnis.mutantCoverage === undefined) return ergebnis;
      const perTest = mitKindern(ergebnis.mutantCoverage.perTest, ordner);
      return { ...ergebnis, mutantCoverage: { ...ergebnis.mutantCoverage, perTest } };
    } finally {
      delete env[KINDABDECKUNG_ORDNER];
      rmSync(ordner, { recursive: true, force: true });
    }
  };
  return runner;
}
tapMitKindabdeckung.inject = [INJEKTOR];

export const strykerPlugins = [{ kind: TEST_RUNNER, name: KINDABDECKUNG, factory: tapMitKindabdeckung }];
