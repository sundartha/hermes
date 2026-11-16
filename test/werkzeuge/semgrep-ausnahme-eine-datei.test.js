import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import * as pruefen from "../../tools/pruefen.mjs";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const REGEL = "ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack";
const DATEI = "src/tts/directive-synth.js";

const befund = (path, check_id, line = 7) => ({ path, check_id, start: { line }, extra: { message: "Treffer" } });

test("Die Ausnahme gilt nur fuer die Datei der Ablage und die Timing-Regel", () => {
  assert.equal(pruefen.SEMGREP_AUSNAHME.datei, DATEI);
  assert.equal(pruefen.SEMGREP_AUSNAHME.regel, REGEL);
});

test("Befund der Timing-Regel in der Ablage-Datei wird nicht gemeldet", () => {
  assert.deepEqual(pruefen.semgrepOhneAusnahme([befund(DATEI, REGEL)]), []);
});

test("Dieselbe Regel in jeder anderen Datei bleibt ein Befund", () => {
  const andere = [befund("src/auth.js", REGEL), befund("src/tts/store.js", REGEL), befund("test/src/tts/directive-synth.js", REGEL)];
  assert.deepEqual(pruefen.semgrepOhneAusnahme(andere), andere);
});

test("Jede andere Regel in der Ablage-Datei bleibt ein Befund", () => {
  const andere = [befund(DATEI, "javascript.lang.security.audit.eval"), befund(DATEI, `${REGEL}.zwei`)];
  assert.deepEqual(pruefen.semgrepOhneAusnahme(andere), andere);
});

test("Ausnahme und Befund gemischt: nur der Befund bleibt", () => {
  const echt = befund("src/auth.js", REGEL, 3);
  assert.deepEqual(pruefen.semgrepOhneAusnahme([befund(DATEI, REGEL), echt]), [echt]);
});

function semgrepSchritt(ergebnisse, status) {
  const ordner = mkdtempSync(join(tmpdir(), "semgrep-attrappe-"));
  const programm = join(ordner, "semgrep");
  const antwort = JSON.stringify({ results: ergebnisse, errors: [] });
  writeFileSync(programm, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1; exit 0; fi\nprintf '%s' '${antwort}'\nexit ${status}\n`);
  chmodSync(programm, 0o755);
  const lauf = spawnSync("node", [PRUEFEN, "semgrep", "--basis", "HEAD"], { encoding: "utf8", env: { ...process.env, PATH: `${ordner}:${process.env.PATH}` } });
  return { status: lauf.status, ausgabe: lauf.stdout };
}

test("Schritt semgrep ist gruen, wenn nur der Ausnahme-Befund gefunden wird", () => {
  assert.equal(semgrepSchritt([befund(DATEI, REGEL)], 1).status, 0);
});

test("Schritt semgrep ist rot und nennt Datei und Regel, wenn dieselbe Regel in einer anderen Datei trifft", () => {
  const lauf = semgrepSchritt([befund(DATEI, REGEL), befund("src/auth.js", REGEL, 42)], 1);
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.ausgabe, new RegExp(`src/auth.js:42: ${REGEL}: Treffer`));
  assert.doesNotMatch(lauf.ausgabe, /directive-synth/);
});

test("Schritt semgrep ist gruen ohne Befunde", () => {
  assert.equal(semgrepSchritt([], 0).status, 0);
});

test("Schritt semgrep ist rot, wenn semgrep selbst scheitert", () => {
  assert.notEqual(semgrepSchritt([], 2).status, 0);
});
