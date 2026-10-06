import { strict as assert } from "node:assert";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { checkElevenlabsTests } from "../scripts/check-elevenlabs-tests.js";
import {
  LEGACY_DIR_NAME,
  LEGACY_DIR_REL,
  TEST_CONFIGS_DIR_NAME,
  TEST_CONFIGS_DIR_REL,
  hasFinding,
  joined,
  makeRoot,
  registerConfigPath,
  removeRoots,
  writeAgentConfig,
  writeJson,
  writeRegisteredDefinition,
  writeRegistry,
} from "./helpers/elevenlabs-gate-fixture.mjs";

const TMP_PREFIX = "elevenlabs-registry-kopplung-";
const OWNER_VARIABLE = "owner_name";
const OWNER_NAME = "Miles Ashbury";

function definition(name) {
  return {
    name,
    type: "simulation",
    dynamic_variables: { [OWNER_VARIABLE]: OWNER_NAME },
    success_conditions: [`The agent states the objective of ${name}.`],
  };
}

function makeFixtureRoot() {
  const root = makeRoot(TMP_PREFIX);
  writeAgentConfig(root, [OWNER_VARIABLE]);
  return root;
}

afterEach(removeRoots);

describe("check-elevenlabs-tests Registry-Kopplung: der produktive Ort", () => {
  it("registrierte Definition unter test_configs/ wird geprueft: Platzhalter dort ist ein Fund", () => {
    const root = makeFixtureRoot();
    writeRegisteredDefinition(root, "t1-am-produktiven-ort.json", {
      ...definition("T1"),
      first_message: "<AUSFUELLEN: erster Satz des Testagenten>",
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `Platzhalter am produktiven Ort nicht gemeldet - der Ort ist ungeprueft: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(
        findings,
        "t1-am-produktiven-ort.json",
        "first_message",
        "<AUSFUELLEN:",
      ),
      `Fund zur Datei am produktiven Ort fehlt: ${joined(findings)}`,
    );
  });

  it("Definition ohne Registry-Zeile ist ein Fund: sie wird nie hochgeladen", () => {
    const root = makeFixtureRoot();
    writeRegisteredDefinition(root, "t2-in-der-registry.json", definition("T2"));
    writeJson(
      root,
      `${TEST_CONFIGS_DIR_REL}/t2-ohne-registry-zeile.json`,
      definition("T2b"),
    );

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `Definition fehlt in tests.json und wird nie hochgeladen - Gate schweigt: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, "t2-ohne-registry-zeile.json"),
      `Fund zur unregistrierten Definition fehlt: ${joined(findings)}`,
    );
    assert.ok(
      !hasFinding(findings, "t2-in-der-registry.json"),
      `die registrierte Definition ist kein Fund: ${joined(findings)}`,
    );
  });

  it("Registry-Zeile ohne Datei ist ein Fund: der Push bricht am fehlenden config-Pfad", () => {
    const root = makeFixtureRoot();
    writeRegisteredDefinition(root, "t3-vorhanden.json", definition("T3"));
    registerConfigPath(root, `${TEST_CONFIGS_DIR_NAME}/t3-nie-angelegt.json`);

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `tests.json verweist auf eine Datei, die es nicht gibt - Gate schweigt: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, "t3-nie-angelegt.json"),
      `Fund zur fehlenden Datei der Registry-Zeile fehlt: ${joined(findings)}`,
    );
    assert.ok(
      !hasFinding(findings, "t3-vorhanden.json"),
      `die vorhandene Definition ist kein Fund: ${joined(findings)}`,
    );
  });
});

describe("check-elevenlabs-tests Registry-Kopplung: der alte Ort", () => {
  it("Definition nur unter elevenlabs/tests/ ist ein Fund: der Altpfad ist kein Ablageort mehr", () => {
    const root = makeFixtureRoot();
    const fileName = "t4-alter-ort.json";
    writeJson(root, `${LEGACY_DIR_REL}/${fileName}`, definition("T4"));
    registerConfigPath(root, `${LEGACY_DIR_NAME}/${fileName}`);

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `Definition am toten Altpfad besteht das Gate: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, fileName),
      `Fund nennt die Datei am Altpfad nicht - wer sie ablegt, erfaehrt nichts: ${joined(findings)}`,
    );
  });

  it("leeres test_configs/ ist ein Fund, auch wenn anderswo eine Streu-Definition liegt", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, TEST_CONFIGS_DIR_REL), { recursive: true });
    writeRegistry(root, []);
    writeJson(root, `${LEGACY_DIR_REL}/t5-streu.json`, definition("T5"));

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `nichts wuerde hochgeladen, das Gate meldet trotzdem Vollzug: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, TEST_CONFIGS_DIR_NAME),
      `Fund nennt den produktiven Ort nicht: ${joined(findings)}`,
    );
  });
});

describe("check-elevenlabs-tests Registry-Kopplung: Mutationsschutz", () => {
  it("von der CLI zurueckgeschriebene Felder (id, type) lassen das Gate gruen", () => {
    const root = makeFixtureRoot();
    const fileName = "t6-schon-gepusht.json";
    writeJson(root, `${TEST_CONFIGS_DIR_REL}/${fileName}`, definition("T6"));
    writeRegistry(root, [
      {
        config: `${TEST_CONFIGS_DIR_NAME}/${fileName}`,
        type: "tool",
        id: "wLFDkMHuqBcCPPPr9Wtn",
      },
    ]);

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.deepEqual(findings, [], `unerwartete Funde: ${joined(findings)}`);
    assert.equal(ok, true);
  });
});
