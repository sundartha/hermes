import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REIHENFOLGE = [
  "elevenlabs-aus",
  "elevenlabs-langsam",
  "postgres-neustart",
  "instanz-tod",
  "deploy-bei-anruf",
];
const POSTGRES_PROBEN = ["postgres-neustart", "instanz-tod", "deploy-bei-anruf"];
const OHNE_POSTGRES = `kein Postgres, uebersprungen (${POSTGRES_VARIABLE} fehlt)`;

function fuehreAus(zusatz = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/ausfallproben.mjs", "alle"],
      { cwd: ROOT, env: kindUmgebung(zusatz), maxBuffer: 1 << 24 },
      (fehler, stdout, stderr) => {
        const zeilen = stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((zeile) => JSON.parse(zeile));
        resolve({ code: fehler ? fehler.code : 0, stdout, stderr, zeilen });
      },
    );
  });
}

let ohneLauf = null;
const ohne = () => (ohneLauf ??= fuehreAus());
let mitLauf = null;
const mit = () =>
  (mitLauf ??= fuehreAus({ [POSTGRES_VARIABLE]: process.env[POSTGRES_VARIABLE] }));

test("alle: ohne Postgres sind genau die Postgres-Proben rot, Gesamt-Exit 1", async () => {
  const lauf = await ohne();
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  const einzel = lauf.zeilen.slice(0, REIHENFOLGE.length);
  assert.deepEqual(
    einzel.map((zeile) => zeile.probe),
    REIHENFOLGE,
  );
  for (const zeile of einzel) {
    const erwartet = POSTGRES_PROBEN.includes(zeile.probe) ? "rot" : "gruen";
    assert.equal(zeile.ergebnis, erwartet, `${zeile.probe}: ${zeile.grund}`);
  }
  for (const zeile of einzel.filter((z) => z.ergebnis === "rot"))
    assert.equal(zeile.grund, "HERMES_TEST_POSTGRES_URL fehlt");
});

test("alle: die letzte Zeile fasst zusammen und ist rot, wenn eine Probe rot ist", async () => {
  const lauf = await ohne();
  const letzte = lauf.zeilen.at(-1);
  assert.equal(lauf.zeilen.length, REIHENFOLGE.length + 1);
  assert.equal(letzte.probe, "alle");
  assert.equal(letzte.ergebnis, "rot");
  assert.deepEqual(
    letzte.proben.map((p) => [p.probe, p.ergebnis]),
    REIHENFOLGE.map((probe) => [probe, POSTGRES_PROBEN.includes(probe) ? "rot" : "gruen"]),
  );
  assert.ok(letzte.grund.length > 0);
});

test("alle: mit Postgres sind alle fuenf Proben gruen, Gesamt-Exit 0", async (t) => {
  if (!process.env[POSTGRES_VARIABLE]) return t.skip(OHNE_POSTGRES);
  const lauf = await mit();
  assert.equal(lauf.code, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(
    lauf.zeilen.slice(0, REIHENFOLGE.length).map((z) => [z.probe, z.ergebnis]),
    REIHENFOLGE.map((probe) => [probe, "gruen"]),
  );
  assert.equal(lauf.zeilen.at(-1).probe, "alle");
  assert.equal(lauf.zeilen.at(-1).ergebnis, "gruen");
});
