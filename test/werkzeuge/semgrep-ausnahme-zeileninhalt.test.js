import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import * as pruefen from "../../tools/pruefen.mjs";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const REGEL = "ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack";
const DATEI = "src/tts/directive-synth.js";

const QUELLE = ["const a = 1;", "  const token = await ablegen;", "  if (token === null) {", "  ttsStore.put(a);", "  return token;"].join("\n");
const AUSNAHME_ZEILE = 3;
const ANDERE_ZEILE = 4;
const lies = () => QUELLE;

const befund = (path, check_id, line = AUSNAHME_ZEILE) => ({ path, check_id, start: { line }, extra: { message: "Treffer", lines: "requires login" } });

test("Die Ausnahme nennt den Zeileninhalt token === null", () => {
  assert.equal(pruefen.SEMGREP_AUSNAHME.zeile, "token === null");
});

test("Befund auf der Zeile token === null wird nicht gemeldet, auch wenn extra.lines nur requires login enthaelt", () => {
  assert.deepEqual(pruefen.semgrepOhneAusnahme([befund(DATEI, REGEL)], lies), []);
});

test("Dieselbe Regel in derselben Datei auf einer anderen Zeile bleibt Befund", () => {
  const echt = [befund(DATEI, REGEL, ANDERE_ZEILE)];
  assert.deepEqual(pruefen.semgrepOhneAusnahme(echt, lies), echt);
});

test("Befund hinter dem Dateiende bleibt Befund", () => {
  const echt = [befund(DATEI, REGEL, 50)];
  assert.deepEqual(pruefen.semgrepOhneAusnahme(echt, lies), echt);
});

test("Nicht lesbare Datei bleibt Befund", () => {
  const echt = [befund(DATEI, REGEL)];
  const unlesbar = () => {
    throw new Error("ENOENT");
  };
  assert.deepEqual(pruefen.semgrepOhneAusnahme(echt, unlesbar), echt);
});

test("Andere Datei oder andere Regel auf der Ausnahme-Zeile bleibt Befund", () => {
  const andere = [befund("src/auth.js", REGEL), befund(DATEI, "javascript.lang.security.audit.eval")];
  assert.deepEqual(pruefen.semgrepOhneAusnahme(andere, lies), andere);
});

function semgrepSchritt(ergebnisse) {
  const ordner = mkdtempSync(join(tmpdir(), "semgrep-attrappe-"));
  const programm = join(ordner, "semgrep");
  const antwort = JSON.stringify({ results: ergebnisse, errors: [] });
  writeFileSync(programm, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1; exit 0; fi\nprintf '%s' '${antwort}'\nexit 1\n`);
  chmodSync(programm, 0o755);
  mkdirSync(join(ordner, "src/tts"), { recursive: true });
  writeFileSync(join(ordner, DATEI), QUELLE);
  return spawnSync("node", [PRUEFEN, "semgrep", "--basis", "HEAD"], { encoding: "utf8", cwd: ordner, env: { ...process.env, PATH: `${ordner}:${process.env.PATH}` } });
}

test("Schritt semgrep ist rot bei Timing-Befund auf anderer Zeile", () => {
  const lauf = semgrepSchritt([befund(DATEI, REGEL, ANDERE_ZEILE)]);
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.stdout, new RegExp(`${DATEI}:${ANDERE_ZEILE}: ${REGEL}: Treffer`));
});

test("Schritt semgrep ist gruen bei Befund auf der Zeile token === null", () => {
  assert.equal(semgrepSchritt([befund(DATEI, REGEL)]).status, 0);
});
