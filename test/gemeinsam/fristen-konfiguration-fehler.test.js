import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { kindUmgebung } from "./kind-umgebung.mjs";
import { BASE_ENV, ROOT } from "../helpers.js";

const SKRIPT = [
  'import("./src/config.js").then(({ configFatalErrors }) =>',
  "  process.stdout.write(JSON.stringify(configFatalErrors())));",
].join("\n");

function fehler(env) {
  const ausgabe = execFileSync(process.execPath, ["--input-type=module", "-e", SKRIPT], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, NODE_ENV: "test", ...env }),
    encoding: "utf8",
  });
  return JSON.parse(ausgabe);
}

test("Fristen-Konfiguration: ein ungueltiger Takt nennt FRISTEN_TAKT_MS im Konfigurationsfehler", () => {
  assert.deepEqual(fehler({ FRISTEN_TAKT_MS: "abc" }), [
    'FRISTEN_TAKT_MS="abc" ist keine gueltige Zahl (erwartet: Ganzzahl, >= 1).',
  ]);
});

test("Fristen-Konfiguration: ein ungueltiges Limit nennt FRISTEN_LIMIT_JE_MANDANT im Konfigurationsfehler", () => {
  assert.deepEqual(fehler({ FRISTEN_LIMIT_JE_MANDANT: "abc" }), [
    'FRISTEN_LIMIT_JE_MANDANT="abc" ist keine gueltige Zahl (erwartet: Ganzzahl, >= 1).',
  ]);
});
