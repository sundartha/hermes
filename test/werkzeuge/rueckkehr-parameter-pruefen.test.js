import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "tools", "rueckkehr-parameter-pruefen.mjs");
const SHELL_FILE = "apps/web/src/components/app/BillingIsland.astro";
const DATE_PAGE = "apps/web/src/pages/konto.astro";
const PORTAL_PATHS = [
  "export const CHECKOUT_RETURN = Object.freeze({",
  '  KARTE_GESPEICHERT: "/app?card=ok",',
  '  ABO_GESCHEITERT: "/app?sub=failed",',
  "});",
].join("\n");
const CARD_BRANCH = '    if (card === RETURN_OK) return "Karte gespeichert";';
const SUB_BRANCH = '    if (sub === RETURN_FAILED) return "Abo gescheitert";';

function shellSource(branches) {
  return [
    "<div></div>",
    "<script>",
    '  const RETURN_PARAM_CARD = "card";',
    '  const RETURN_PARAM_SUB = "sub";',
    '  const RETURN_OK = "ok";',
    '  const RETURN_FAILED = "failed";',
    "  function returnMessageText(card, sub) {",
    ...branches,
    '    return "";',
    "  }",
    "  const params = new URLSearchParams(window.location.search);",
    "  returnMessageText(params.get(RETURN_PARAM_CARD), params.get(RETURN_PARAM_SUB));",
    "</script>",
  ].join("\n");
}

function miniRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "rueckkehr-parameter-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
}

function runInMiniRoot(kontext, files) {
  const root = miniRoot({ "src/portal-paths.js": PORTAL_PATHS, ...files });
  kontext.after(() => rmSync(root, { recursive: true, force: true }));
  return runScript(["--wurzel", root]);
}

test("das echte Repo wertet jeden Rueckkehr-Parameter aus und formatiert in keinem .astro-Skript", () => {
  const result = runScript([]);
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("eine saubere Mini-Wurzel bleibt ohne Befund", (kontext) => {
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shellSource([CARD_BRANCH, SUB_BRANCH]) });
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("fehlt der Shell ein Rueckkehr-Zweig, meldet das Skript genau diesen Fall", (kontext) => {
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shellSource([CARD_BRANCH]) });
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.match(result.stdout, /BillingIsland\.astro:\d+ ABO_GESCHEITERT: kein Zweig "sub === RETURN_FAILED"/);
  assert.doesNotMatch(result.stdout, /KARTE_GESPEICHERT/);
});

test("ein Datumsformat mit de-DE in einem .astro-Skript ist ein Befund mit Datei und Zeile", (kontext) => {
  const page = ["---", "---", "<p></p>", "<script>", '  new Date().toLocaleDateString("de-DE");', "</script>"];
  const result = runInMiniRoot(kontext, {
    [SHELL_FILE]: shellSource([CARD_BRANCH, SUB_BRANCH]),
    [DATE_PAGE]: page.join("\n"),
  });
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.match(result.stdout, /konto\.astro:5 toLocale /);
  assert.match(result.stdout, /konto\.astro:5 de-DE /);
});

test("ein falscher Aufruf oder eine fehlende Datei endet mit Exit 2", (kontext) => {
  assert.equal(runScript(["--unbekannt"]).status, EXIT_USAGE);
  assert.equal(runScript(["ueberzaehlig"]).status, EXIT_USAGE);
  const result = runInMiniRoot(kontext, {});
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /Datei fehlt/);
});
