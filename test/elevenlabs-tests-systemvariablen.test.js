import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { checkElevenlabsTests } from "../scripts/check-elevenlabs-tests.js";
import {
  hasFinding,
  joined,
  makeRoot,
  removeRoots,
  writeAgentConfig,
  writeRegisteredDefinition,
} from "./helpers/elevenlabs-gate-fixture.mjs";

const TMP_PREFIX = "elevenlabs-gate-systemvariablen-";
const SYSTEMVARIABLE = "system__env_hermes_host";

afterEach(removeRoots);

describe("check-elevenlabs-tests Vokabular-Gate: Systemvariablen des Anbieters", () => {
  it("eine Systemvariable in der Vorlage verlangt von keiner Testdefinition einen Wert", () => {
    const root = makeRoot(TMP_PREFIX);
    writeAgentConfig(root, ["owner_name", SYSTEMVARIABLE]);
    writeRegisteredDefinition(root, "s1.json", {
      name: "S1",
      type: "simulation",
      dynamic_variables: { owner_name: "Miles Ashbury" },
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, true, `Systemvariable faelschlich verlangt: ${joined(findings)}`);
  });

  it("neben einer Systemvariablen bleibt eine fehlende normale Variable ein Fund", () => {
    const root = makeRoot(TMP_PREFIX);
    writeAgentConfig(root, ["owner_name", SYSTEMVARIABLE]);
    writeRegisteredDefinition(root, "s2.json", {
      name: "S2",
      type: "simulation",
      success_conditions: ["The agent confirms the appointment."],
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, false, `fehlende Variable nicht gemeldet: ${joined(findings)}`);
    assert.ok(hasFinding(findings, "s2.json", "owner_name"), `Fund zu s2.json/owner_name fehlt: ${joined(findings)}`);
    assert.ok(!hasFinding(findings, SYSTEMVARIABLE), `Systemvariable faelschlich verlangt: ${joined(findings)}`);
  });
});
