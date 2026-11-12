import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHWELLE_MS = 30_000;
const ABWEISEN_MS = 10_000;
const VERZUG_UEBER_ANFRAGEFRIST_MS = 6000;
const OHNE_POSTGRES = `kein Postgres, uebersprungen (${POSTGRES_VARIABLE} fehlt)`;

function fuehreAus(args, zusatz = {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/ausfallproben.mjs", ...args],
      { cwd: ROOT, env: kindUmgebung(zusatz) },
      (fehler, stdout, stderr) => {
        const zeilen = stdout.trim().split("\n").filter(Boolean);
        const zeile = zeilen.pop();
        resolve({
          code: fehler ? fehler.code : 0,
          stdout,
          stderr,
          dauerMs: Date.now() - start,
          zeile: zeile ? JSON.parse(zeile) : null,
        });
      },
    );
  });
}

const postgres = () => ({ [POSTGRES_VARIABLE]: process.env[POSTGRES_VARIABLE] });

let gruenerLauf = null;
const gruen = () => (gruenerLauf ??= fuehreAus(["postgres-neustart"], postgres()));

test("postgres-neustart: nach gekappten Verbindungen und 10 s Abweisung ist /healthz wieder 200, Hermes lebt, Exit 0", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await gruen();
  assert.equal(lauf.code, 0, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.probe, "postgres-neustart");
  assert.equal(lauf.zeile.ergebnis, "gruen");
  assert.equal(lauf.zeile.schwelle, SCHWELLE_MS);
  assert.ok(lauf.zeile.gemessen >= 0 && lauf.zeile.gemessen <= SCHWELLE_MS);
  assert.ok(lauf.zeile.grund.length > 0);
});

test("postgres-neustart: die Weiche hat Verbindungen gesehen, gekappt und 10 s lang abgewiesen", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await gruen();
  const { beleg } = lauf.zeile;
  assert.ok(beleg.angenommen >= 1);
  assert.ok(beleg.gekappt >= 1);
  assert.equal(beleg.abweisenMs, ABWEISEN_MS);
  assert.ok(lauf.dauerMs >= ABWEISEN_MS, `Lauf dauerte ${lauf.dauerMs} ms`);
});

test("postgres-neustart: die Postgres-Adresse der aufrufenden Umgebung erreicht die Zeile nicht", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await gruen();
  assert.equal(lauf.stdout.includes(process.env[POSTGRES_VARIABLE]), false);
});

test("postgres-neustart: ohne Postgres-Adresse ist die Probe rot mit Grund, Exit 1", async () => {
  const lauf = await fuehreAus(["postgres-neustart"]);
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "HERMES_TEST_POSTGRES_URL fehlt");
});

test("postgres-neustart: eine Postgres-Adresse ausser Loopback ist rot, ohne dorthin zu verbinden", async () => {
  const lauf = await fuehreAus(["postgres-neustart"], {
    [POSTGRES_VARIABLE]: "postgres://nutzer@192.0.2.1:5432/postgres",
  });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "Postgres ist nicht lokal (nur 127.0.0.1 oder localhost)");
});

test("postgres-neustart: kommt /healthz nach der Stoerung nicht binnen 30 s zurueck, ist die Probe rot, Exit 1", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await fuehreAus(["postgres-neustart"], {
    ...postgres(),
    AUSFALLPROBE_MESSWEICHE_VERZUG_MS: String(VERZUG_UEBER_ANFRAGEFRIST_MS),
  });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "/healthz kam nach dem Neustart nicht zurueck");
  assert.equal(lauf.zeile.gemessen, null);
});
