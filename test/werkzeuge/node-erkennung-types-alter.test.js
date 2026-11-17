import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WERKZEUG = join(fileURLToPath(new URL("../..", import.meta.url)), "tools/mutation-laeufe.mjs");
const GIT_ICH = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid"];
const LISTE = [{ version: "v26.13.0", date: "2026-10-28", lts: "Lithium" }];
const DATEIEN = {
  ".nvmrc": "22.18\n",
  "package.json": `{\n  "engines": {\n    "node": ">=22.18 <27"\n  },\n  "devDependencies": {\n    "@types/node": "22.20.5"\n  }\n}\n`,
  "package-lock.json": "{}\n",
  ".github/actions/node-npm-ci/action.yml": 'inputs:\n  node-version:\n    default: "22"\n',
  "render.yaml": "services:\n  - type: web\n    runtime: node\n",
  ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - with:\n          node-version: 22\n      - with:\n          node-version: 26\n",
};

function schreibe(wurzel, pfad, inhalt) {
  mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
  writeFileSync(join(wurzel, pfad), inhalt);
}

function npmAufruf(t, heute) {
  const ordner = mkdtempSync(join(tmpdir(), "types-alter-"));
  t.after(() => rmSync(ordner, { recursive: true, force: true }));
  const wurzel = join(ordner, "repo");
  const entfernt = join(ordner, "entfernt.git");
  const bin = join(ordner, "bin");
  const log = join(ordner, "log.txt");
  for (const [pfad, inhalt] of Object.entries(DATEIEN)) schreibe(wurzel, pfad, inhalt);
  schreibe(bin, "gh", '#!/bin/sh\ncase "$*" in\n  "pr list"*"--state all"*) echo "[]" ;;\n  "pr list"*) echo "[]" ;;\n  "api"*) echo "[]" ;;\nesac\n');
  schreibe(bin, "npm", '#!/bin/sh\necho "npm $*" >> "$PROBE_LOG"\n');
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "npm"), 0o755);
  writeFileSync(log, "");
  execFileSync("git", ["init", "--bare", "-q", "-b", "master", entfernt]);
  const git = (...argumente) => execFileSync("git", [...GIT_ICH, ...argumente], { cwd: wurzel });
  git("init", "-q", "-b", "master");
  git("add", "-A");
  git("commit", "-q", "-m", "Start");
  git("remote", "add", "origin", entfernt);
  git("push", "-q", "origin", "master");
  const listePfad = join(ordner, "liste.json");
  writeFileSync(listePfad, JSON.stringify(LISTE));
  const ergebnis = spawnSync(process.execPath, [WERKZEUG, "node-erkennung", "--liste", listePfad, "--heute", heute], {
    cwd: wurzel,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PROBE_LOG: log },
  });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  return readFileSync(log, "utf8").split("\n").find((zeile) => zeile.startsWith("npm "));
}

test("@types/node wird nur aus Versionen gezogen, die mindestens 14 Tage alt sind (Major-Wartezeit der Freigabe)", (t) => {
  assert.match(npmAufruf(t, "2026-11-17"), /--before=2026-11-03(?:\s|$)/);
});

test("Die Wartezeit für @types/node rechnet vom Lauftag zurück, nicht von einem festen Datum", (t) => {
  assert.match(npmAufruf(t, "2026-12-20"), /--before=2026-12-06(?:\s|$)/);
});
