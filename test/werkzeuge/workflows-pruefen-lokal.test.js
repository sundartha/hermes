import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/workflows-pruefen.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const AUFRUFER = "aufrufer.yml";
const GERUFEN = "gerufen.yml";

function aufrufer(ziel) {
  return [
    "name: Aufrufer",
    "on:",
    "  push:",
    "    branches: [master]",
    "permissions: {}",
    "jobs:",
    "  kette:",
    "    uses: " + ziel,
    "",
  ].join("\n");
}

const GERUFENER_WORKFLOW = [
  "name: Gerufen",
  "on:",
  "  workflow_call:",
  "permissions: {}",
  "jobs:",
  "  probe:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npm test",
  "",
].join("\n");

function pruefe(dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "workflows-pruefen-lokal-"));
  try {
    for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(ordner, name), inhalt);
    const lauf = spawnSync(process.execPath, [SCRIPT_PATH, ordner], { encoding: "utf8" });
    return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("workflows-pruefen: ein wiederverwendbarer Workflow aus demselben Ordner ist ohne SHA erlaubt", () => {
  const ergebnis = pruefe({
    [AUFRUFER]: aufrufer(`./.github/workflows/${GERUFEN}`),
    [GERUFEN]: GERUFENER_WORKFLOW,
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.ausgabe);
  assert.equal(ergebnis.ausgabe, "");
});

test("workflows-pruefen: ein lokaler Workflow, den es im Ordner nicht gibt, stoppt die Pruefung", () => {
  const ergebnis = pruefe({ [AUFRUFER]: aufrufer("./.github/workflows/fehlt.yml") });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.ausgabe);
  assert.match(
    ergebnis.ausgabe,
    /aufrufer\.yml:8: \.\/\.github\/workflows\/fehlt\.yml ist nicht per 40-stelliger Commit-SHA eingebunden/,
  );
});

test("workflows-pruefen: eine lokale Action ohne SHA stoppt die Pruefung weiterhin", () => {
  const ergebnis = pruefe({
    [AUFRUFER]: aufrufer("./.github/actions/eigen"),
    [GERUFEN]: GERUFENER_WORKFLOW,
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.ausgabe);
  assert.match(
    ergebnis.ausgabe,
    /\.\/\.github\/actions\/eigen ist nicht per 40-stelliger Commit-SHA eingebunden/,
  );
});

test("workflows-pruefen: ein fremder wiederverwendbarer Workflow per Tag stoppt die Pruefung weiterhin", () => {
  const ergebnis = pruefe({
    [AUFRUFER]: aufrufer(`fremd/repo/.github/workflows/${GERUFEN}@v1`),
    [GERUFEN]: GERUFENER_WORKFLOW,
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /fremd\/repo\/\.github\/workflows\/gerufen\.yml@v1 ist nicht per/);
});

test("workflows-pruefen: ein Pfad aus dem Ordner heraus gilt nicht als lokaler Workflow", () => {
  const ergebnis = pruefe({
    [AUFRUFER]: aufrufer("./.github/workflows/../gerufen.yml"),
    [GERUFEN]: GERUFENER_WORKFLOW,
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.ausgabe);
});
