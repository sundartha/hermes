import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHWELLE_MS = 2000;
const VERZUG_MS = 1000;
const UNTERGRENZE_MS = 900;
const OBERGRENZE_MS = 1900;

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

let gruenerLauf = null;
const gruen = () => (gruenerLauf ??= fuehreAus(["elevenlabs-langsam"]));

test("elevenlabs-langsam: Hermes bleibt bei fuenffach langsamem Anbieter binnen 2000 ms auf /healthz 200, Exit 0", async () => {
  const lauf = await gruen();
  assert.equal(lauf.code, 0, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.probe, "elevenlabs-langsam");
  assert.equal(lauf.zeile.ergebnis, "gruen");
  assert.equal(lauf.zeile.schwelle, SCHWELLE_MS);
  assert.ok(lauf.zeile.gemessen >= 0 && lauf.zeile.gemessen <= SCHWELLE_MS);
  assert.ok(lauf.zeile.grund.length > 0);
});

test("elevenlabs-langsam: die Weiche hat mindestens einen Aufruf gesehen und erst nach etwa 1000 ms beantwortet", async () => {
  const { beleg } = (await gruen()).zeile;
  assert.ok(beleg.anbieterAufrufe >= 1);
  assert.equal(beleg.antwortVerzugMs, VERZUG_MS);
  assert.ok(
    beleg.langsamsteAntwortMs >= UNTERGRENZE_MS && beleg.langsamsteAntwortMs <= OBERGRENZE_MS,
    `langsamste Antwort ${beleg.langsamsteAntwortMs}`,
  );
});

test("elevenlabs-langsam: /healthz hinter einer Verzoegerungsweiche ueber der Schwelle ist rot mit Grund, Exit 1", async () => {
  const lauf = await fuehreAus(["elevenlabs-langsam"], {
    AUSFALLPROBE_MESSWEICHE_VERZUG_MS: String(SCHWELLE_MS + 500),
  });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "/healthz zu langsam");
  assert.ok(lauf.zeile.gemessen > SCHWELLE_MS);
});

test("elevenlabs-langsam: ohne gesehenen Anbieter-Aufruf ist die Probe rot, Exit 1", async () => {
  const lauf = await fuehreAus(["elevenlabs-langsam"], { AUSFALLPROBE_OHNE_SAAT: "1" });
  assert.equal(lauf.code, 1, lauf.stdout + lauf.stderr);
  assert.equal(lauf.zeile.ergebnis, "rot");
  assert.equal(lauf.zeile.grund, "Die Weiche sah keinen Anbieter-Aufruf");
});

test("elevenlabs-langsam: Ziel ausser 127.0.0.1 bricht mit Exit 2 ab", async () => {
  const lauf = await fuehreAus(["elevenlabs-langsam", "--ziel", "192.0.2.1"]);
  assert.equal(lauf.code, 2);
  assert.equal(lauf.stdout, "");
});
