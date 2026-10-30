import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CHECKOUT_RETURN } from "../../../src/portal-paths.js";
import { STRINGS } from "../src/lib/i18n.js";
import { AA_NORMAL_TEXT, RATIO_DECIMALS, contrastOf } from "./kontrast.js";
import { ERR_TONE, LANG, NEUTRAL_TONE, OK_TONE, SHELL_HTML } from "./rueckkehr-dom-shell.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHELL_RUNNER = fileURLToPath(new URL("./rueckkehr-dom-shell.js", import.meta.url));

const WORK_PARENT = join(WEB_ROOT, "node_modules");
const WORK_PREFIX = ".rueckkehr-dom-";
const BUILD_DIR = "dist-rueckkehr-dom";
const ASSET_DIR = "_astro";
const BILLING_BUNDLE = /^BillingIsland\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/;
const run = promisify(execFile);

const EXPECTED = Object.freeze({
  CARD_OK: { key: "cardSaved", tone: OK_TONE },
  CARD_CANCELED: { key: "cardCancelled", tone: NEUTRAL_TONE },
  CARD_ERROR: { key: "cardError", tone: ERR_TONE },
  SUB_OK: { key: "subBooked", tone: OK_TONE },
  SUB_FAILED: { key: "subFailed", tone: ERR_TONE },
});

const CSS_BUNDLE = /\.css$/;

let distDir;
let workDir;

function bundleName(dir) {
  const names = readdirSync(join(dir, ASSET_DIR)).filter((name) => BILLING_BUNDLE.test(name));
  assert.equal(names.length, 1, `genau ein Billing-Bündel erwartet, gefunden: ${names.join(", ") || "keins"}`);
  return names[0];
}

async function openShell(dir, target) {
  const { stdout } = await run(process.execPath, [SHELL_RUNNER, dir, target]);
  return JSON.parse(stdout);
}

function assertRunsClean(seen, label) {
  assert.deepEqual(seen.errors, [], `${label}: Fehler beim Ausführen der Shell`);
  assert.deepEqual(seen.external, [], `${label}: Aufruf außerhalb der Probe-Adresse`);
  assert.equal(seen.cardShown, true, `${label}: Abrechnungskarte nicht sichtbar, Shell lief nicht durch`);
  assert.equal(seen.cardStatus, STRINGS[LANG].cardOnFile, `${label}: Abrechnungskarte nicht aus dem Zustand gezeichnet`);
}

async function assertReturnMessage(dir, name) {
  const target = CHECKOUT_RETURN[name];
  const expected = EXPECTED[name];
  assert.ok(expected, `${name}: keine erwartete Meldung hinterlegt`);
  for (const lang of Object.keys(STRINGS)) {
    assert.ok(STRINGS[lang][expected.key], `${name}: Wortlaut ${expected.key} fehlt in Sprache ${lang}`);
  }
  const seen = await openShell(dir, target);
  assertRunsClean(seen, name);
  assert.equal(seen.shown, true, `${name}: keine sichtbare Meldung nach ${target}`);
  assert.equal(seen.text, STRINGS[LANG][expected.key], `${name}: falscher Wortlaut nach ${target}`);
  assert.equal(seen.tone, expected.tone, `${name}: falsche Färbung nach ${target}`);
  assert.equal(seen.search, "", `${name}: Rückkehr-Parameter bleiben nach ${target} in der Adresse`);
}

async function assertAllReturnMessages(dir) {
  for (const name of Object.keys(CHECKOUT_RETURN)) await assertReturnMessage(dir, name);
}

async function looksOf(dir, names) {
  const looks = {};
  for (const name of names) {
    const seen = await openShell(dir, CHECKOUT_RETURN[name]);
    assertRunsClean(seen, name);
    assert.equal(seen.shown, true, `${name}: keine sichtbare Meldung`);
    looks[name] = seen.look;
  }
  return looks;
}

async function assertSuccessAndErrorLookApart(dir) {
  const looks = await looksOf(dir, ["CARD_OK", "CARD_ERROR"]);
  const [ok, err] = [looks.CARD_OK, looks.CARD_ERROR];
  assert.notEqual(ok.color, err.color, "Erfolg und Fehler: gleiche Schriftfarbe");
  assert.notEqual(ok.background, err.background, "Erfolg und Fehler: gleiche Fläche");
  for (const [label, look] of Object.entries({ Erfolg: ok, Fehler: err })) {
    assert.ok(look.glyph, `${label}: kein Zeichen vor dem Text`);
    assert.equal(look.borderStyle, "solid", `${label}: kein Balken neben dem Text`);
    assert.notEqual(look.borderWidth, "0px", `${label}: Balken ohne Breite`);
    assert.ok(contrastOf(look) >= AA_NORMAL_TEXT, `${label}: Kontrast ${contrastOf(look).toFixed(RATIO_DECIMALS)} unter ${AA_NORMAL_TEXT}`);
  }
  assert.notEqual(ok.glyph, err.glyph, "Erfolg und Fehler: gleiches Zeichen");
}

function copyOfBuild(label) {
  const dir = join(workDir, label);
  cpSync(distDir, dir, { recursive: true });
  return dir;
}

function cssFileWith(dir, needle) {
  const names = readdirSync(join(dir, ASSET_DIR)).filter(
    (name) => CSS_BUNDLE.test(name) && readFileSync(join(dir, ASSET_DIR, name), "utf8").includes(needle),
  );
  assert.equal(names.length, 1, `genau eine Stildatei mit ${needle} erwartet, gefunden: ${names.length}`);
  return join(dir, ASSET_DIR, names[0]);
}

function mutatedCopy(label, mutate, fileOf = (dir) => join(dir, ASSET_DIR, bundleName(dir))) {
  const dir = copyOfBuild(label);
  const file = fileOf(dir);
  const source = readFileSync(file, "utf8");
  const changed = mutate(source);
  assert.notEqual(changed, source, `${label}: Veränderung greift nicht mehr am gebauten Bündel`);
  writeFileSync(file, changed);
  return dir;
}

function replaceOnce(pattern, replacement) {
  return (source) => {
    const hits = source.match(new RegExp(pattern.source, `${pattern.flags}g`)) ?? [];
    assert.equal(hits.length, 1, `Muster ${pattern} trifft ${hits.length}-mal statt einmal`);
    return source.replace(pattern, replacement);
  };
}

before(() => {
  workDir = mkdtempSync(join(WORK_PARENT, WORK_PREFIX));
  distDir = join(workDir, BUILD_DIR);
  execFileSync("npx", ["astro", "build", "--outDir", distDir], { cwd: WEB_ROOT, stdio: "pipe" });
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("jede Rückkehr-Adresse hat genau eine erwartete Meldung", () => {
  assert.deepEqual(Object.keys(EXPECTED).sort(), Object.keys(CHECKOUT_RETURN).sort());
});

for (const name of Object.keys(CHECKOUT_RETURN)) {
  test(`gebaute Shell zeigt nach ${name} den Wortlaut und die Färbung`, async () => {
    await assertReturnMessage(distDir, name);
  });
}

test("gebaute Shell setzt Erfolg und Fehler der Rückkehr sichtbar voneinander ab", async () => {
  await assertSuccessAndErrorLookApart(distDir);
});

test("gebaute Shell ohne Rückkehr-Parameter zeigt keine Meldung", async () => {
  const seen = await openShell(distDir, "/app");
  assertRunsClean(seen, "ohne Parameter");
  assert.equal(seen.shown, false, `ohne Parameter erscheint "${seen.text}"`);
});

const RUN_FAILED = /Fehler beim Ausführen der Shell/;

const FAIL_CLOSED = [
  ["Billing-Bündel fehlt", (dir) => rmSync(join(dir, ASSET_DIR, bundleName(dir))), RUN_FAILED],
  [
    "Billing-Bündel ist kein gültiges Skript",
    (dir) => writeFileSync(join(dir, ASSET_DIR, bundleName(dir)), "export const =;"),
    RUN_FAILED,
  ],
  ["Shell-Seite fehlt", (dir) => rmSync(join(dir, SHELL_HTML)), /ENOENT[^\n]*app[\\/]index\.html/],
];

for (const [index, [label, damage, reason]] of FAIL_CLOSED.entries()) {
  test(`fail-closed: ${label} macht die Prüfung rot`, async () => {
    const dir = copyOfBuild(`kaputt-${index}`);
    damage(dir);
    await assert.rejects(assertAllReturnMessages(dir), reason);
  });
}

const CARD_OK_SILENT = /CARD_OK: keine sichtbare Meldung/;
const CARD_OK_HIDDEN = /CARD_OK: Abrechnungskarte nicht sichtbar/;
const CARD_OK_WRONG_TONE = /CARD_OK: falsche Färbung/;
const CARD_OK_WRONG_WORDING = /CARD_OK: falscher Wortlaut/;
const SUB_FAILED_SILENT = /SUB_FAILED: keine sichtbare Meldung/;
const UNDECLARED = /ReferenceError: \w+ is not defined/;
const BEFORE_INIT = /ReferenceError: Cannot access '\w+' before initialization/;

const MUTATIONS = [
  [
    "#1250 Zweig nur als Zeichenkette",
    replaceOnce(/(\w+)===(\w+)\?(\w+)\(`subFailed`\):/, "`$1===$2?$3(subFailed)`&&!1?0:"),
    SUB_FAILED_SILENT,
  ],
  [
    "#1262 Konstante nur als Zeichenkette",
    replaceOnce(/,(\w+)=`failed`/, ",$1$1=`const $1=\"failed\"`"),
    UNDECLARED,
  ],
  [
    "#1263 URLSearchParams ersetzt",
    (source) => `globalThis.URLSearchParams=class{get(){return null}};${source}`,
    CARD_OK_SILENT,
  ],
  ["#1247 get am Prototyp ersetzt", (source) => `URLSearchParams.prototype.get=()=>null;${source}`, CARD_OK_SILENT],
  [
    "#1264 Lesen vor der Deklaration (TDZ)",
    replaceOnce(
      /let (\w+)=(new URLSearchParams\(location\.search\)),(\w+)=(\w+\(\1\.get\(\w+\),\1\.get\(\w+\)\));/,
      "let $3=$4,$1=$2;",
    ),
    BEFORE_INIT,
  ],
  [
    "#1305 Adresse vor dem Lesen verändert",
    replaceOnce(
      /new URLSearchParams\(location\.search\)/,
      "(history.replaceState(null,``,`/app`),new URLSearchParams(location.search))",
    ),
    CARD_OK_SILENT,
  ],
  ["Konstante mit falschem Wert", replaceOnce(/,(\w+)=`failed`/, ",$1=`fehlgeschlagen`"), SUB_FAILED_SILENT],
  [
    "falsche Färbung",
    replaceOnce(/\?!0:(\w+)===(\w+)\|\|(\w+)===(\w+)\?!1:null/, "?!1:$1===$2||$3===$4?!0:null"),
    CARD_OK_WRONG_TONE,
  ],
  ["falscher Wortlaut", replaceOnce(/`cardSaved`/, "`cardCancelled`"), CARD_OK_WRONG_WORDING],
];

const PAGE_MUTATIONS = [
  [
    "Meldung per CSS ausgeblendet",
    replaceOnce(/<\/head>/, "<style>#billing-msg{display:none}</style></head>"),
    CARD_OK_SILENT,
  ],
  [
    "Abrechnungskarte per CSS unsichtbar",
    replaceOnce(/<\/head>/, "<style>#billing-card{visibility:hidden}</style></head>"),
    CARD_OK_HIDDEN,
  ],
  ["Schleier bleibt stehen", replaceOnce(/<html /, "<html data-cancel-arrival=\"\" "), CARD_OK_HIDDEN],
];

const CSS_MUTATIONS = [
  ["Regeln für Erfolg und Fehler entfernt", (source) => source.replace(/\.billing-msg--(ok|err)[^{]*\{[^}]*\}/g, ""), /gleiche Schriftfarbe/],
  ["Fehlerfarbe zu dunkel", replaceOnce(/\.billing-msg--err\{color:#ffc9c9/, ".billing-msg--err{color:#304060"), /Fehler: Kontrast/],
];

for (const [index, [label, mutate, reason]] of CSS_MUTATIONS.entries()) {
  test(`Rotprobe ${label}: veränderte Gestaltung macht die Prüfung rot`, async () => {
    const dir = mutatedCopy(`gestaltung-${index}`, mutate, (copy) => cssFileWith(copy, "billing-msg--err"));
    await assert.rejects(assertSuccessAndErrorLookApart(dir), { name: "AssertionError", message: reason });
  });
}

for (const [index, [label, mutate, reason]] of PAGE_MUTATIONS.entries()) {
  test(`Rotprobe ${label}: veränderte Seite macht die Prüfung rot`, async () => {
    const dir = mutatedCopy(`seite-${index}`, mutate, (copy) => join(copy, SHELL_HTML));
    await assert.rejects(assertAllReturnMessages(dir), { name: "AssertionError", message: reason });
  });
}

for (const [index, [label, mutate, reason]] of MUTATIONS.entries()) {
  test(`Rotprobe ${label}: veränderte Shell macht die Prüfung rot`, async () => {
    const dir = mutatedCopy(`mutation-${index}`, mutate);
    await assert.rejects(assertAllReturnMessages(dir), { name: "AssertionError", message: reason });
  });
}
