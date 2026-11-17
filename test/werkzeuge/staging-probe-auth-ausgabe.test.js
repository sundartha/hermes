import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { skriptStarten } from "../../tools/deploy-weg/staging.mjs";

async function laufen(skript) {
  const pfad = join(mkdtempSync(join(tmpdir(), "probe-ausgabe-")), "probe.sh");
  writeFileSync(pfad, skript);
  const zeilen = [];
  const exit = await skriptStarten(pfad, [], ausgabeAnlegen((zeile) => zeilen.push(zeile)));
  return { exit, zeilen };
}

test("Roter Probe-Lauf: stderr und stdout kommen als erlaubte Zeilen ins Log", async () => {
  const { exit, zeilen } = await laufen(
    'echo "Commit: abc (Pin erfuellt)"\necho "ABBRUCH: /healthz meldet Commit nicht" >&2\nexit 2\n',
  );
  assert.equal(exit, 2);
  assert.deepEqual(zeilen, ["Probe: Commit: abc (Pin erfuellt)", "Probe: ABBRUCH: /healthz meldet Commit nicht"]);
});

test("Roter Probe-Lauf: Zeilen mit Adresse, Mail, Bearer oder Telefonnummer bleiben draussen, nur die letzten 20 Zeilen", async () => {
  const { zeilen } = await laufen(
    [
      'echo "Ziel:   https://staging.example"',
      'echo "mail a@b.de"',
      'echo "Authorization: Bearer abc"',
      'echo "ruf +49 170 1234567"',
      'for i in $(seq 1 30); do echo "zeile $i"; done',
      "exit 1",
    ].join("\n"),
  );
  assert.equal(zeilen.length, 20);
  assert.equal(zeilen[0], "Probe: zeile 11");
  assert.equal(zeilen.at(-1), "Probe: zeile 30");
  assert.ok(zeilen.every((zeile) => !/https?:|@|Bearer|\+49/.test(zeile)));
});

test("Gruener Probe-Lauf schreibt nichts ins Log", async () => {
  const { exit, zeilen } = await laufen('echo "alles gut"\nexit 0\n');
  assert.equal(exit, 0);
  assert.deepEqual(zeilen, []);
});
