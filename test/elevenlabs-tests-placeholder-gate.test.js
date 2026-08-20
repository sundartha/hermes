// Vor-dem-Hochladen-Gate fuer die ElevenLabs-Testdefinitionen
// (scripts/check-elevenlabs-tests.js). Arbeitet ausschliesslich auf einer
// synthetischen Attrappe in einem Temp-Verzeichnis
// (test/helpers/elevenlabs-gate-fixture.mjs) - haengt NICHT an den echten
// Dateien unter elevenlabs/test_configs/, damit dieser Test nicht rot wird,
// sobald jemand die dortigen Platzhalter ausfuellt. Offline, kein Netz.
//
// Die Attrappe liegt am produktiven Ablageort: elevenlabs/test_configs/ plus
// eine Zeile in der Registry elevenlabs/tests.json - denn nur was in der
// Registry steht, wird je hochgeladen (elevenlabs/tests/README.md, Abschnitt
// "Ablage"). Die Aussagen der drei Faelle sind davon unberuehrt; sie pruefen
// nur nicht mehr an einem Ort, aus dem nichts mehr hochgeladen wird.
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { checkElevenlabsTests } from "../scripts/check-elevenlabs-tests.js";
import {
  TEMPLATES_DIR_NAME,
  TEST_CONFIGS_DIR_REL,
  makeRoot,
  removeRoots,
  writeJson,
  writeRegisteredDefinition,
} from "./helpers/elevenlabs-gate-fixture.mjs";

const TMP_PREFIX = "elevenlabs-tests-gate-";
const TEMPLATES_DIR_REL = `${TEST_CONFIGS_DIR_REL}/${TEMPLATES_DIR_NAME}`;

afterEach(removeRoots);

describe("check-elevenlabs-tests Platzhalter-Gate", () => {
  it("Attrappe ohne Platzhalter -> keine Funde, ok true", () => {
    const root = makeRoot(TMP_PREFIX);
    writeRegisteredDefinition(root, "a1.json", {
      criterion: "A1",
      scenarios: [{ tool: "get_consult", expected: "beantwortet" }],
    });
    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, true, `unerwartete Funde: ${findings.join(" | ")}`);
    assert.deepEqual(findings, []);
  });

  it("Attrappe mit Platzhalter -> Fund nennt Datei und Feldpfad (A3 verify_absence)", () => {
    const root = makeRoot(TMP_PREFIX);
    writeRegisteredDefinition(root, "a3.json", {
      criterion: "A3",
      type: "verify_absence",
      scenarios: [
        { tool: "<AUSFUELLEN: Werkzeugkennung fuer verbotenes Tool>" },
      ],
    });
    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, false);
    assert.ok(
      findings.some(
        (finding) =>
          finding.includes("a3.json") &&
          finding.includes("scenarios[0].tool") &&
          finding.includes("<AUSFUELLEN:"),
      ),
      `erwarteter Fund fehlt: ${findings.join(" | ")}`,
    );
  });

  it("Platzhalter unter templates/ loest keinen Fund aus (Vorlagen duerfen sie tragen)", () => {
    const root = makeRoot(TMP_PREFIX);
    // Bewusst ohne Registry-Zeile: eine Vorlage ist keine Testdefinition, sie
    // wird nie hochgeladen - genau deshalb darf sie Platzhalter tragen.
    writeJson(root, `${TEMPLATES_DIR_REL}/vorlage.json`, {
      criterion: "<AUSFUELLEN: Kriterium>",
    });
    writeRegisteredDefinition(root, "a2.json", { criterion: "A2" });
    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, true, `unerwartete Funde: ${findings.join(" | ")}`);
    assert.ok(!findings.some((finding) => finding.includes("vorlage.json")));
  });
});
