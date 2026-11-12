import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FRIST_MS = 8000;
const TEILFRIST_UNTERGRENZE_MS = 6000;
const OHNE_POSTGRES = `kein Postgres, uebersprungen (${POSTGRES_VARIABLE} fehlt)`;

function fuehreAus(args, zusatz = {}) {
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
          zeile: zeile ? JSON.parse(zeile) : null,
        });
      },
    );
  });
}

const postgres = () => ({ [POSTGRES_VARIABLE]: process.env[POSTGRES_VARIABLE] });

let gruenerLauf = null;
const gruen = () => (gruenerLauf ??= fuehreAus(["deploy-bei-anruf"], postgres()));

test("deploy-bei-anruf: SIGTERM bei offener Anfrage endet mit Exit 0, Flush-Zeile und binnen 8000 ms, Exit 0 der Probe", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await gruen();
  assert.equal(lauf.code, 0, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.probe, "deploy-bei-anruf");
  assert.equal(lauf.zeile.ergebnis, "gruen");
  assert.equal(lauf.zeile.schwelle, FRIST_MS);
  assert.ok(lauf.zeile.gemessen <= FRIST_MS, `beendet nach ${lauf.zeile.gemessen} ms`);
  assert.ok(lauf.zeile.grund.length > 0);
});

test("deploy-bei-anruf: die Anfrage war wirklich offen, denn die Abschaltung wartete auf die Teilfrist", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const { zeile } = await gruen();
  assert.equal(zeile.beleg.signal, "SIGTERM");
  assert.equal(zeile.beleg.exitCode, 0);
  assert.ok(zeile.beleg.gehalteneAufrufe >= 1);
  assert.ok(
    zeile.gemessen >= TEILFRIST_UNTERGRENZE_MS,
    `Abschaltung nach nur ${zeile.gemessen} ms: die Anfrage war nicht offen`,
  );
});

test("deploy-bei-anruf: die Postgres-Adresse der aufrufenden Umgebung erreicht die Zeile nicht", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  assert.equal((await gruen()).stdout.includes(process.env[POSTGRES_VARIABLE]), false);
});

test("deploy-bei-anruf: ohne Postgres-Adresse ist die Probe rot mit Grund, Exit 1", async () => {
  const lauf = await fuehreAus(["deploy-bei-anruf"]);
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.probe, "deploy-bei-anruf");
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "HERMES_TEST_POSTGRES_URL fehlt");
});

test("deploy-bei-anruf: eine Postgres-Adresse ausser Loopback ist rot, ohne dorthin zu verbinden", async () => {
  const lauf = await fuehreAus(["deploy-bei-anruf"], {
    [POSTGRES_VARIABLE]: "postgres://nutzer@192.0.2.1:5432/postgres",
  });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.grund, "Postgres ist nicht lokal (nur 127.0.0.1 oder localhost)");
});
