import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FUNKTIONSKARTE = join(REPO, "tools", "funktionskarte.mjs");
const KARTE = "docs/funktionen/rueckfrage.md";
const TEST_FRIST = { timeout: 170000 };
const LAUF_FRIST_MS = 160000;
const EXIT_ROT = 1;
const GROSSZUEGIG_MS = 60000;
const KNAPP_MS = 1;
const MARKIERT = ["elevenlabs-consult", "elevenlabs-lookup"];

const ordner = mkdtempSync(join(tmpdir(), "antwortzeiten-test-"));
after(() => {
  rmSync(ordner, { recursive: true, force: true });
});

function budgets(name, werte) {
  const pfad = join(ordner, `${name}.json`);
  writeFileSync(pfad, `${JSON.stringify({ attrappen: werte, staging: {} }, null, 2)}\n`);
  return pfad;
}

function allePlus(wert, zusatz = {}) {
  return { ...Object.fromEntries(MARKIERT.map((name) => [name, wert])), ...zusatz };
}

function pruefen(antwortzeiten) {
  return new Promise((fertig) => {
    execFile(
      process.execPath,
      [FUNKTIONSKARTE, "pruefen", "--karte", KARTE, "--antwortzeiten", antwortzeiten],
      { cwd: REPO, timeout: LAUF_FRIST_MS },
      (fehler, stdout, stderr) => fertig({ exit: fehler?.code ?? 0, ausgabe: `${stdout}${stderr}` }),
    );
  });
}

test("Antwortzeit über dem Budget macht die Karte rot", TEST_FRIST, async () => {
  const lauf = await pruefen(
    budgets("zu-knapp", allePlus(GROSSZUEGIG_MS, { "elevenlabs-consult": KNAPP_MS })),
  );
  assert.equal(lauf.exit, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /elevenlabs-consult[^\n]*\b\d+ ms[^\n]*Budget[^\n]*\b1 ms/);
});

test("Antwortzeit im Budget bleibt sauber", TEST_FRIST, async () => {
  const lauf = await pruefen(budgets("im-budget", allePlus(GROSSZUEGIG_MS)));
  assert.equal(lauf.exit, 0, lauf.ausgabe);
  assert.match(lauf.ausgabe, /Funktionskarte: sauber/);
});

test("Markierter Schritt ohne Budget ist rot", TEST_FRIST, async () => {
  const ohneConsult = Object.entries(allePlus(GROSSZUEGIG_MS)).filter(
    ([name]) => name !== "elevenlabs-consult",
  );
  const lauf = await pruefen(budgets("ohne-budget", Object.fromEntries(ohneConsult)));
  assert.equal(lauf.exit, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /elevenlabs-consult[^\n]*hat kein Budget/);
});

test("Budget ohne markierten Schritt ist rot", TEST_FRIST, async () => {
  const lauf = await pruefen(
    budgets("totes-budget", allePlus(GROSSZUEGIG_MS, { "gibt-es-nicht": GROSSZUEGIG_MS })),
  );
  assert.equal(lauf.exit, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, /gibt-es-nicht[^\n]*hat keinen Schritt/);
});
