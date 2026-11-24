import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const WERKZEUG = join(WURZEL, "node_modules/.bin/type-coverage");

async function messeFixture(atLeast) {
  const ordner = await mkdtemp(join(tmpdir(), "typabdeckung-"));
  try {
    await writeFile(
      join(ordner, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["*.ts"] }),
    );
    await writeFile(join(ordner, "a.ts"), "export const x: any = 1;\n");
    await writeFile(
      join(ordner, "package.json"),
      JSON.stringify({ name: "fixture", typeCoverage: { atLeast } }),
    );
    return spawnSync(WERKZEUG, ["-p", "tsconfig.json"], { cwd: ordner, encoding: "utf8" });
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

test("Typabdeckung: Schwelle 100 bricht bei einem expliziten any", async () => {
  const lauf = await messeFixture(100);
  assert.notEqual(lauf.status, null);
  assert.notEqual(lauf.status, 0);
});

test("Typabdeckung: Schwelle 0 lässt dieselbe Datei durch", async () => {
  const lauf = await messeFixture(0);
  assert.equal(lauf.status, 0);
});

test("Typabdeckung: package.json hat Skript und positive Schwelle", async () => {
  const paket = JSON.parse(await readFile(join(WURZEL, "package.json"), "utf8"));
  assert.match(paket.scripts["typecheck:abdeckung"], /^type-coverage\b/);
  assert.equal(typeof paket.typeCoverage.atLeast, "number");
  assert.ok(paket.typeCoverage.atLeast > 0);
  assert.ok(paket.typeCoverage.atLeast <= 100);
});

test("Typabdeckung: ci.yml führt das Skript nach der Typprüfung aus", async () => {
  const ci = await readFile(join(WURZEL, ".github/workflows/ci.yml"), "utf8");
  const typen = ci.indexOf("run: npm run typecheck\n");
  const abdeckung = ci.indexOf("npm run typecheck:abdeckung");
  assert.ok(typen > 0);
  assert.ok(abdeckung > typen);
  assert.match(ci, /name: Typabdeckung \(Untergrenze, Ratsche\)/);
  assert.match(ci, /typeCoverage\.atLeast/);
});
