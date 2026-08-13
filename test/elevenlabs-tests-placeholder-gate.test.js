// Vor-dem-Hochladen-Gate fuer die ElevenLabs-Testdefinitionen
// (scripts/check-elevenlabs-tests.js). Arbeitet ausschliesslich auf einer
// synthetischen Attrappe in einem Temp-Verzeichnis (mkdtemp-Muster) - haengt
// NICHT an den echten Dateien unter elevenlabs/tests/, damit dieser Test nicht
// rot wird, sobald jemand die dortigen Platzhalter ausfuellt. Offline, kein Netz.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";

import { checkElevenlabsTests } from "../scripts/check-elevenlabs-tests.js";

const TEST_DIR_REL = "elevenlabs/tests";
const TEMPLATES_DIR_REL = `${TEST_DIR_REL}/templates`;
const JSON_INDENT = 2;

let tmpDirs = [];

function writeJson(root, rel, value) {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, JSON.stringify(value, null, JSON_INDENT));
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "elevenlabs-tests-gate-"));
  tmpDirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe("check-elevenlabs-tests Platzhalter-Gate", () => {
  it("Attrappe ohne Platzhalter -> keine Funde, ok true", () => {
    const root = makeRoot();
    writeJson(root, `${TEST_DIR_REL}/a1.json`, {
      criterion: "A1",
      scenarios: [{ tool: "get_consult", expected: "beantwortet" }],
    });
    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, true, `unerwartete Funde: ${findings.join(" | ")}`);
    assert.deepEqual(findings, []);
  });

  it("Attrappe mit Platzhalter -> Fund nennt Datei und Feldpfad (A3 verify_absence)", () => {
    const root = makeRoot();
    writeJson(root, `${TEST_DIR_REL}/a3.json`, {
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
    const root = makeRoot();
    writeJson(root, `${TEMPLATES_DIR_REL}/vorlage.json`, {
      criterion: "<AUSFUELLEN: Kriterium>",
    });
    writeJson(root, `${TEST_DIR_REL}/a2.json`, { criterion: "A2" });
    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, true, `unerwartete Funde: ${findings.join(" | ")}`);
    assert.ok(!findings.some((finding) => finding.includes("vorlage.json")));
  });
});
