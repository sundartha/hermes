import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";

const HTML = { alpha: "<html>alpha</html>", beta: "<html>beta ä</html>" };
const sha256Of = (html) => createHash("sha256").update(html, "utf8").digest("hex");
const PINS = {
  _comment: "Kommentar, kein Widget",
  alpha: { 1: "alt", 2: sha256Of(HTML.alpha) },
  beta: { 1: sha256Of(HTML.beta) },
  entfallen: { 1: "weg" },
};

function beispielRepo(context) {
  const wurzel = mkdtempSync(join(tmpdir(), "widget-pins-"));
  context.after(() => rmSync(wurzel, { recursive: true, force: true }));
  mkdirSync(join(wurzel, "tools"));
  mkdirSync(join(wurzel, "src/ui"), { recursive: true });
  copyFileSync(join(REPO_ROOT, "tools/widget-pins.mjs"), join(wurzel, "tools/widget-pins.mjs"));
  writeFileSync(
    join(wurzel, "src/ui/widget-catalog.js"),
    `const HTML = ${JSON.stringify(HTML)};\nexport const hasWidget = (id) => Object.hasOwn(HTML, id);\nexport const widgetHtml = (id) => HTML[id];\n`,
  );
  writeFileSync(join(wurzel, "src/ui/registry.js"), `export const widgetPins = () => (${JSON.stringify(PINS)});\n`);
  return wurzel;
}

function aufruf(wurzel, argumente = []) {
  return execFileSync(process.execPath, ["tools/widget-pins.mjs", ...argumente], { cwd: wurzel, encoding: "utf8", stdio: "pipe" });
}

function dateien(wurzel) {
  return readdirSync(wurzel, { recursive: true }).sort();
}

test("widget-pins gibt je ausgeliefertem Widget den Hash aus, der dem Pin der höchsten Version entspricht", (context) => {
  const ausgabe = JSON.parse(aufruf(beispielRepo(context)));
  assert.deepEqual(ausgabe, { alpha: PINS.alpha[2], beta: PINS.beta[1] });
});

test("widget-pins schreibt keine Datei", (context) => {
  const wurzel = beispielRepo(context);
  const vorher = dateien(wurzel);
  aufruf(wurzel);
  assert.deepEqual(dateien(wurzel), vorher);
});

test("widget-pins lehnt Argumente ab", (context) => {
  assert.throws(() => aufruf(beispielRepo(context), ["x"]), { status: 2 });
});
