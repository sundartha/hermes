import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const CI = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const SCHRITT = "Median der Fehlerquote der letzten 20 Queue-Läufe";

function schrittText() {
  const start = CI.indexOf(`- name: ${SCHRITT}`);
  assert.ok(start >= 0, "Schritt fehlt in ci.yml");
  const rest = CI.slice(start);
  const ende = rest.indexOf("\n\n      - name:", 1);
  return rest.slice(0, ende);
}

function runText() {
  const zeilen = schrittText().split("\n");
  const i = zeilen.findIndex((z) => z.trim() === "run: |");
  assert.ok(i >= 0, "run-Text fehlt");
  return zeilen
    .slice(i + 1)
    .map((z) => z.slice(10))
    .join("\n");
}

function fuehreAus(ghSkript) {
  const ordner = mkdtempSync(join(tmpdir(), "abruf-"));
  const gh = join(ordner, "gh");
  writeFileSync(gh, `#!/bin/sh\n${ghSkript}\n`);
  chmodSync(gh, 0o755);
  try {
    return spawnSync("bash", ["-c", runText()], {
      cwd: WURZEL,
      encoding: "utf8",
      env: { ...process.env, PATH: `${ordner}:${process.env.PATH}`, GITHUB_REPOSITORY: "o/r" },
    });
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Lastlauf-Median: scheitert der Listenabruf, meldet der Schritt den fehlenden Abruf ohne Fehlerstatus", () => {
  const r = fuehreAus("exit 1");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Abruf der letzten Queue-Läufe nicht möglich$/m);
  assert.doesNotMatch(r.stdout, /keine Werte/);
});

test("Lastlauf-Median: liefert der Listenabruf Läufe, werden Job und Log je Lauf abgerufen und der Median berechnet", () => {
  const r = fuehreAus(
    'case "$2" in\n*workflows/ci.yml/runs*) echo 11;;\n*runs/11/jobs*) echo 22;;\n*jobs/22/logs) echo \'2026-11-17T10:00:01.0000000Z {"ergebnis":{"fehlerquoteProzent":0.5},"urteil":{"gruen":true,"gruende":[]}}\';;\nesac',
  );
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /nicht möglich/);
  assert.match(r.stdout, /0\.5/);
});

test("Lastlauf-Median: Schritt bleibt continue-on-error und auf merge_group beschränkt", () => {
  const text = schrittText();
  assert.match(text, /^ {8}continue-on-error: true$/m);
  assert.match(text, /github\.event_name == 'merge_group'/);
});
