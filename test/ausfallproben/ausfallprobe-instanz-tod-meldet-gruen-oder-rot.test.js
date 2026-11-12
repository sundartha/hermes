import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HALTEN_MS = 10_000;
const SCHWELLE_MS = 2000;
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
const gruen = () => (gruenerLauf ??= fuehreAus(["instanz-tod"], postgres()));

test("instanz-tod: nach SIGKILL der ersten Instanz antwortet die zweite 10 s lang binnen 2000 ms mit 200, Exit 0", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await gruen();
  assert.equal(lauf.code, 0, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.probe, "instanz-tod");
  assert.equal(lauf.zeile.ergebnis, "gruen");
  assert.equal(lauf.zeile.schwelle, SCHWELLE_MS);
  assert.ok(lauf.zeile.gemessen >= 0 && lauf.zeile.gemessen <= SCHWELLE_MS);
  assert.ok(lauf.zeile.grund.length > 0);
});

test("instanz-tod: die erste Instanz endete durch SIGKILL und die zweite wurde ueber die gesamte Haltezeit gemessen", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await gruen();
  const { beleg } = lauf.zeile;
  assert.equal(beleg.signal, "SIGKILL");
  assert.equal(beleg.haltenMs, HALTEN_MS);
  assert.ok(beleg.messungen >= 5, `nur ${beleg.messungen} Messungen`);
  assert.ok(lauf.dauerMs >= HALTEN_MS, `Lauf dauerte ${lauf.dauerMs} ms`);
});

test("instanz-tod: die Postgres-Adresse der aufrufenden Umgebung erreicht die Zeile nicht", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await gruen();
  assert.equal(lauf.stdout.includes(process.env[POSTGRES_VARIABLE]), false);
});

test("instanz-tod: ohne Postgres-Adresse ist die Probe rot mit Grund, Exit 1", async () => {
  const lauf = await fuehreAus(["instanz-tod"]);
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.probe, "instanz-tod");
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "HERMES_TEST_POSTGRES_URL fehlt");
});

test("instanz-tod: eine Postgres-Adresse ausser Loopback ist rot, ohne dorthin zu verbinden", async () => {
  const lauf = await fuehreAus(["instanz-tod"], {
    [POSTGRES_VARIABLE]: "postgres://nutzer@192.0.2.1:5432/postgres",
  });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "Postgres ist nicht lokal (nur 127.0.0.1 oder localhost)");
});

test("instanz-tod: antwortet die zweite Instanz nicht rechtzeitig, ist die Probe rot, Exit 1", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await fuehreAus(["instanz-tod"], {
    ...postgres(),
    AUSFALLPROBE_MESSWEICHE_VERZUG_MS: String(VERZUG_UEBER_ANFRAGEFRIST_MS),
  });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "/healthz antwortete nicht mit 200");
  assert.equal(lauf.zeile.gemessen, null);
});
