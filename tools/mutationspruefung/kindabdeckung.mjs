import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import { createTapTestRunnerFactory } from "@stryker-mutator/tap-runner";

import { mitKindern } from "./kindabdeckung-ablage.mjs";
import { KINDABDECKUNG_ORDNER } from "./zustand.mjs";

export const KINDABDECKUNG = "tap-kindabdeckung";
const ORDNERPRAEFIX = "kindabdeckung-";
const BERICHT = "kindabdeckungBericht";
const ZEILENENDE = "\n";
const TEST_RUNNER = "TestRunner";
const INJEKTOR = "$injector";
const OPTIONEN = "options";
const tapRunner = createTapTestRunnerFactory();

export function kindabdeckungsBericht() {
  const datei = join(tmpdir(), `${ORDNERPRAEFIX}${randomUUID()}.txt`);
  return {
    option: { [BERICHT]: datei },
    ohneTestdatei() {
      if (!existsSync(datei)) return 0;
      const zahl = readFileSync(datei, "utf8").split(ZEILENENDE).filter(Boolean).length;
      rmSync(datei);
      return zahl;
    },
  };
}

function tapMitKindabdeckung(injector) {
  const runner = tapRunner(injector);
  const bericht = injector.resolve(OPTIONEN)[BERICHT];
  const probelauf = runner.dryRun.bind(runner);
  runner.dryRun = async (optionen) => {
    const ordner = mkdtempSync(join(tmpdir(), ORDNERPRAEFIX));
    env[KINDABDECKUNG_ORDNER] = ordner;
    try {
      const ergebnis = await probelauf(optionen);
      if (ergebnis.mutantCoverage === undefined) return ergebnis;
      const { perTest, ohneTestdatei } = mitKindern(ergebnis.mutantCoverage.perTest, ordner);
      if (ohneTestdatei.length > 0) appendFileSync(bericht, ohneTestdatei.map((testdatei) => `${testdatei}${ZEILENENDE}`).join(""));
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
export const strykerValidationSchema = { type: "object", properties: { [BERICHT]: { type: "string" } } };
