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

const befund = (path, check_id, lines) => ({ path, check_id, start: { line: 12 }, extra: { message: "Treffer", ...(lines === undefined ? {} : { lines }) } });

test("Die Ausnahme nennt den Zeileninhalt token === null", () => {
  assert.equal(pruefen.SEMGREP_AUSNAHME.zeile, "token === null");
});

test("Befund mit token === null in der Zeile wird nicht gemeldet", () => {
  assert.deepEqual(pruefen.semgrepOhneAusnahme([befund(DATEI, REGEL, "    if (token === null) return;")]), []);
});

test("Dieselbe Regel in derselben Datei mit anderem Zeileninhalt bleibt Befund", () => {
  const echt = [befund(DATEI, REGEL, "    if (token === geheimnis) return;")];
  assert.deepEqual(pruefen.semgrepOhneAusnahme(echt), echt);
});

test("Befund ohne extra.lines bleibt Befund", () => {
  const echt = [befund(DATEI, REGEL)];
  assert.deepEqual(pruefen.semgrepOhneAusnahme(echt), echt);
});

test("Andere Datei oder andere Regel mit token === null bleibt Befund", () => {
  const andere = [befund("src/auth.js", REGEL, "token === null"), befund(DATEI, "javascript.lang.security.audit.eval", "token === null")];
  assert.deepEqual(pruefen.semgrepOhneAusnahme(andere), andere);
});

function semgrepSchritt(ergebnisse) {
  const ordner = mkdtempSync(join(tmpdir(), "semgrep-attrappe-"));
  const programm = join(ordner, "semgrep");
  const antwort = JSON.stringify({ results: ergebnisse, errors: [] });
  writeFileSync(programm, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1; exit 0; fi\nprintf '%s' '${antwort}'\nexit 1\n`);
  chmodSync(programm, 0o755);
  return spawnSync("node", [PRUEFEN, "semgrep", "--basis", "HEAD"], { encoding: "utf8", env: { ...process.env, PATH: `${ordner}:${process.env.PATH}` } });
}

test("Schritt semgrep ist rot bei Timing-Befund mit anderem Zeileninhalt", () => {
  const lauf = semgrepSchritt([befund(DATEI, REGEL, "if (token === geheimnis) {")]);
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.stdout, new RegExp(`${DATEI}:12: ${REGEL}: Treffer`));
});

test("Schritt semgrep ist gruen bei Befund mit token === null", () => {
  assert.equal(semgrepSchritt([befund(DATEI, REGEL, "if (token === null) {")]).status, 0);
});
