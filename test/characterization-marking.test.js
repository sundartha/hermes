import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import {
  maskNonCode,
  testBlocksOf,
  characterizationFindings,
  nonDeBytePinsOf,
} from "./helpers/characterization-scan.mjs";

const TEST_DIR = path.join(ROOT, "test");
const MIN_EXPECTED_NON_DE_PINS = 5;
const FILES_WITHOUT_TEST_BLOCK = ["outbound-recv-log.test.js"];
const FIXTURE_FILE_NAME = "fixture.test.js";

function testSourceFiles() {
  return fs
    .readdirSync(TEST_DIR)
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => ({
      fileName: name,
      source: fs.readFileSync(path.join(TEST_DIR, name), "utf8"),
    }));
}

const scan = (source) => characterizationFindings({ source, fileName: FIXTURE_FILE_NAME });

const GERMAN_SYSTEM_PROMPT = 'Du bist "Hermes", der persoenliche Assistent von Jonas Beispiel.';
const sp5Fixture = (testName) => `
const EXPECTED_SP_EN_OUT_FULL = \`${GERMAN_SYSTEM_PROMPT}\`;
test("${testName}", () => {
  assert.equal(systemPrompt(call({ language: "en" })), EXPECTED_SP_EN_OUT_FULL);
});
`;
const PURITY_COMPANION_FIXTURE = `
test("SP5 Sprachreinheit: der EN-Prompt traegt keinen deutschen Rest", () => {
  assert.ok(!GERMAN_STOPWORDS.test(systemPrompt(call({ language: "en" }))));
});
`;
const PURE_EN_PIN_FIXTURE = `
test("EN-Bundle: budgetExhaustedHangup ist byte-stabil", () => {
  assert.equal(LOCALES.en.budgetExhaustedHangup, "The demo budget has been used up. Goodbye.");
});
`;
const GERMAN_NOISE_AROUND_PURE_PIN_FIXTURE = `
// Der Erwartungswert ist hier bewusst rein englisch, alles drumherum ist deutsch.
test("Die EN-Meldung wird nicht auf Deutsch geprueft", () => {
  assert.equal(
    LOCALES.en.budgetExhaustedHangup,
    "The demo budget has been used up. Goodbye.",
    "der deutsche Meldungstext darf nicht zaehlen",
  );
});
`;

function findingReport(findings) {
  return findings
    .map((f) => `${f.fileName}:${f.line} · ${f.testName} · "${f.expected}"`)
    .join("\n");
}

test("GAP-27: kein byte-genauer Nicht-DE-Pin traegt deutschen Text ohne Kennzeichnung und Sprachreinheits-Test", () => {
  const findings = testSourceFiles().flatMap(characterizationFindings);
  assert.deepEqual(
    findings,
    [],
    "Mischsprach-Pin(s) gefunden - ein als nicht-deutsch ausgewiesener Wert ist byte-genau " +
      "auf deutschen Text gepinnt und zementiert damit einen Defekt als Sollzustand:\n" +
      `${findingReport(findings)}\n` +
      "Abhilfe A (bevorzugt): den Produktionswert in die Zielsprache bringen und den Pin " +
      "darauf umstellen. Abhilfe B (nur als Zwischenschritt): den Test als CHARAKTERISIERUNG " +
      "kennzeichnen (Testname oder Dateiname) UND in derselben Datei einen " +
      "Sprachreinheits-Eigenschaftstest gegen GERMAN_STOPWORDS ergaenzen. Die Regel NICHT " +
      "entschaerfen - siehe Kopf von test/helpers/characterization-scan.mjs.",
  );
});

test("GAP-27 (Selbsttest): der Detektor erkennt den historischen SP5-Fall", () => {
  const findings = scan(sp5Fixture("SP5 systemPrompt en outbound voll"));
  assert.equal(findings.length, 1, "der Mischsprach-Pin muss genau einmal gemeldet werden");
  assert.match(findings[0].expected, /Du bist/);
});

test("GAP-27 (Selbsttest): Kennzeichnung UND Sprachreinheits-Test heben den Befund auf", () => {
  const source =
    sp5Fixture("Charakterisierung SP5: systemPrompt en outbound") + PURITY_COMPANION_FIXTURE;
  assert.deepEqual(scan(source), []);
});

test("GAP-27 (Selbsttest): Kennzeichnung allein reicht nicht", () => {
  const source = sp5Fixture("Charakterisierung SP5: systemPrompt en outbound");
  assert.equal(
    scan(source).length,
    1,
    "ohne begleitenden Sprachreinheits-Test bleibt es ein Befund",
  );
});

test("GAP-27 (Selbsttest): ein sprachreiner EN-Pin ist kein Befund", () => {
  assert.deepEqual(scan(PURE_EN_PIN_FIXTURE), []);
});

test("GAP-27 (Selbsttest): nur der Erwartungs-Operand zaehlt", () => {
  assert.deepEqual(scan(GERMAN_NOISE_AROUND_PURE_PIN_FIXTURE), []);
});

test("GAP-27 (Selbsttest): die Maskierung ist laengentreu", () => {
  const drifted = testSourceFiles()
    .filter(({ source }) => maskNonCode(source).code.length !== source.length)
    .map(({ fileName }) => fileName);
  assert.deepEqual(
    drifted,
    [],
    "die Maskierung MUSS laengentreu sein - sonst zeigen die Offsets aus der maskierten " +
      "Fassung im Rohtext auf die falsche Stelle und der Detektor liest Muell",
  );
});

test("GAP-27 (Lebendigkeit): der Detektor sieht die bestehenden Nicht-DE-Byte-Pins", () => {
  const pins = testSourceFiles().flatMap(nonDeBytePinsOf);
  const files = [...new Set(pins.map((pin) => pin.fileName))];
  assert.ok(
    pins.length >= MIN_EXPECTED_NON_DE_PINS,
    `nur ${pins.length} Nicht-DE-Byte-Pins gefunden (erwartet >= ${MIN_EXPECTED_NON_DE_PINS}) - ` +
      `der Detektor ist vermutlich stumpf geworden. Gefundene Dateien: ${files.join(", ") || "keine"}`,
  );
});

test("GAP-27 (Lebendigkeit): jede Testdatei wird geparst", () => {
  const withoutBlock = testSourceFiles()
    .filter(({ source }) => testBlocksOf(source).length === 0)
    .map(({ fileName }) => fileName);
  assert.deepEqual(
    withoutBlock,
    FILES_WITHOUT_TEST_BLOCK,
    "eine Testdatei ohne erkannten Testblock heisst: der Scanner sieht ihren Inhalt nicht",
  );
});
