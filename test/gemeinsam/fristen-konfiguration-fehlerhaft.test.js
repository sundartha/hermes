import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { kindUmgebung } from "./kind-umgebung.mjs";
import { BASE_ENV, ROOT } from "../helpers.js";

const SKRIPT = [
  'import("./src/config.ts").then(({ configFatalErrors }) =>',
  "  process.stdout.write(JSON.stringify(configFatalErrors())));",
].join("\n");

function befunde(env) {
  const ausgabe = execFileSync(process.execPath, ["--input-type=module", "-e", SKRIPT], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, NODE_ENV: "test", ...env }),
    encoding: "utf8",
  });
  return JSON.parse(ausgabe);
}

test("Fristen-Einstellungen: ein ungueltiger FRISTEN_TAKT_MS wird beim Namen genannt", () => {
  const liste = befunde({ FRISTEN_TAKT_MS: "abc" });
  assert.ok(liste.some((b) => b.startsWith('FRISTEN_TAKT_MS="abc" ist keine gueltige Zahl')));
});

test("Fristen-Einstellungen: ein ungueltiges FRISTEN_LIMIT_JE_MANDANT wird beim Namen genannt", () => {
  const liste = befunde({ FRISTEN_LIMIT_JE_MANDANT: "abc" });
  assert.ok(
    liste.some((b) => b.startsWith('FRISTEN_LIMIT_JE_MANDANT="abc" ist keine gueltige Zahl')),
  );
});
