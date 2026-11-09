import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WERKZEUG = join(REPO_ROOT, "tools/mutation-laeufe.mjs");
const GIT_ICH = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid"];

const LISTE = [
  { version: "v27.0.0-alpha.0.0.0", date: "2026-10-29", lts: false },
  { version: "v26.14.0", date: "2026-11-05", lts: "Lithium" },
  { version: "v26.13.1", date: "2026-11-05", lts: "Lithium" },
  { version: "v26.13.0", date: "2026-10-28", lts: "Lithium" },
  { version: "v26.12.1", date: "2026-10-21", lts: false },
  { version: "v24.22.2", date: "2026-10-27", lts: "Krypton" },
  { version: "v24.11.0", date: "2025-10-28", lts: "Krypton" },
  { version: "v22.23.4", date: "2026-10-20", lts: "Jod" },
  { version: "v22.11.0", date: "2024-10-29", lts: "Jod" },
];

const FALSCHER_GH = [
  "#!/bin/sh",
  'printf "%s\\n" "gh $*" | tr "\\n" " " >> "$PROBE_LOG"',
  'echo >> "$PROBE_LOG"',
  'case "$*" in',
  '  "pr list"*"--state all"*) cat "$PROBE_PRS" ;;',
  '  "pr list"*) echo "[]" ;;',
  '  "api"*"labels=updates-pausiert"*) if [ -n "$PROBE_NOT_AUS" ]; then echo "$PROBE_NOT_AUS"; else echo "[]"; fi ;;',
  "esac",
].join("\n");
const FALSCHES_NPM = ["#!/bin/sh", 'echo "npm $*" >> "$PROBE_LOG"'].join("\n");

function schreibe(wurzel, pfad, inhalt) {
  mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
  writeFileSync(join(wurzel, pfad), inhalt);
}

function probeRepo(t, dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "node-erkennung-"));
  t.after(() => rmSync(ordner, { recursive: true, force: true }));
  const wurzel = join(ordner, "repo");
  const entfernt = join(ordner, "entfernt.git");
  const bin = join(ordner, "bin");
  for (const [pfad, inhalt] of Object.entries(dateien)) schreibe(wurzel, pfad, inhalt);
  schreibe(bin, "gh", FALSCHER_GH);
  schreibe(bin, "npm", FALSCHES_NPM);
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "npm"), 0o755);
  execFileSync("git", ["init", "--bare", "-q", "-b", "master", entfernt]);
  const git = (...argumente) => execFileSync("git", [...GIT_ICH, ...argumente], { cwd: wurzel, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "master");
  git("add", "-A");
  git("commit", "-q", "-m", "Start");
  git("remote", "add", "origin", entfernt);
  git("push", "-q", "origin", "master");
  return { ordner, wurzel, entfernt, bin, git };
}

function kleinesRepo(zusatz = {}) {
  return {
    ".nvmrc": "22.18\n",
    "package.json": `{\n  "engines": {\n    "node": ">=22.18 <27"\n  },\n  "devDependencies": {\n    "@types/node": "22.20.5"\n  }\n}\n`,
    "package-lock.json": "{}\n",
    "render.yaml": "services:\n  - type: web\n    runtime: node\n",
    ".github/actions/node-npm-ci/action.yml": 'inputs:\n  node-version:\n    default: "22"\n',
    ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - name: Node 22\n        with:\n          node-version: 22\n      - name: Node 26\n        with:\n          node-version: 26\n",
    ...zusatz,
  };
}

function lauf(t, { dateien = kleinesRepo(), liste = LISTE, heute, prs = [] }) {
  const probe = probeRepo(t, dateien);
  const listePfad = join(probe.ordner, "liste.json");
  const prsPfad = join(probe.ordner, "prs.json");
  const log = join(probe.ordner, "log.txt");
  writeFileSync(listePfad, typeof liste === "string" ? liste : JSON.stringify(liste));
  writeFileSync(prsPfad, JSON.stringify(prs));
  writeFileSync(log, "");
  const ergebnis = spawnSync(process.execPath, [WERKZEUG, "node-erkennung", "--liste", listePfad, "--heute", heute], {
    cwd: probe.wurzel,
    encoding: "utf8",
    env: { ...process.env, PATH: `${probe.bin}:${process.env.PATH}`, PROBE_LOG: log, PROBE_PRS: prsPfad },
  });
  const aufrufe = readFileSync(log, "utf8").split("\n").filter(Boolean);
  const entfernteZweige = execFileSync("git", ["--git-dir", probe.entfernt, "for-each-ref", "--format=%(refname:short)"], { encoding: "utf8" }).trim().split("\n");
  return { ...probe, ergebnis, aufrufe, entfernteZweige, lies: (pfad) => readFileSync(join(probe.wurzel, pfad), "utf8") };
}

function hatPr(aufrufe) {
  return aufrufe.some((zeile) => zeile.startsWith("gh pr create"));
}

test("Am 13. Tag nach Beginn der Active LTS kommt noch kein PR, und die ältere LTS-Linie wird nicht ersatzweise genommen", (t) => {
  const { ergebnis, aufrufe, lies, entfernteZweige } = lauf(t, { heute: "2026-11-10" });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  assert.equal(hatPr(aufrufe), false);
  assert.equal(lies(".nvmrc"), "22.18\n");
  assert.deepEqual(entfernteZweige, ["master"]);
});

test("Am 14. Tag nach Beginn der Active LTS öffnet der Lauf einen PR mit dem Label node-hauptversion", (t) => {
  const { ergebnis, aufrufe, entfernteZweige } = lauf(t, { heute: "2026-11-11" });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  const pr = aufrufe.find((zeile) => zeile.startsWith("gh pr create"));
  assert.ok(pr, "kein PR geöffnet");
  assert.match(pr, /--label node-hauptversion/);
  assert.match(pr, /--head system\/node-26/);
  assert.match(pr, /--base master/);
  assert.deepEqual(entfernteZweige.sort(), ["master", "system/node-26"]);
});

test("Der PR-Text nennt das aus der Liste gelesene Datum und verlangt Antonios Ja", (t) => {
  const { aufrufe } = lauf(t, { heute: "2026-11-20" });
  const pr = aufrufe.find((zeile) => zeile.startsWith("gh pr create"));
  assert.match(pr, /2026-10-28/);
  assert.match(pr, /Antonios Ja/);
});

test("Der Lauf mischt nie selbst: kein Merge und kein Auto-Merge, master bleibt unverändert", (t) => {
  const { aufrufe, entfernt, git } = lauf(t, { heute: "2026-11-11" });
  assert.equal(aufrufe.some((zeile) => / merge\b|--auto\b/.test(zeile)), false);
  const entfernterMaster = execFileSync("git", ["--git-dir", entfernt, "rev-parse", "master"], { encoding: "utf8" }).trim();
  assert.equal(entfernterMaster, git("rev-parse", "master"));
});

test("Ein Patch- oder Minor-Release innerhalb der Wartezeit wird nicht genommen, die Laufzeit bleibt auf dem ausgereiften Stand", (t) => {
  const { lies } = lauf(t, { heute: "2026-11-11" });
  assert.equal(lies(".nvmrc"), "26.13\n");
});

test("Liegt keine neuere LTS-Hauptversion vor, bleibt alles unverändert", (t) => {
  const { ergebnis, aufrufe, lies } = lauf(t, { heute: "2026-11-11", liste: LISTE.filter(({ version }) => version.startsWith("v22")) });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  assert.equal(hatPr(aufrufe), false);
  assert.equal(lies(".nvmrc"), "22.18\n");
});

test("Besteht schon ein PR für die Zielversion, auch ein geschlossener, kommt kein zweiter", (t) => {
  const { ergebnis, aufrufe, lies, entfernteZweige } = lauf(t, { heute: "2026-11-11", prs: [{ number: 7 }] });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  assert.equal(hatPr(aufrufe), false);
  assert.equal(lies(".nvmrc"), "22.18\n");
  assert.deepEqual(entfernteZweige, ["master"]);
});

test("Läuft die Zielversion noch nicht in der CI, stoppt der Lauf sichtbar und ändert nichts", (t) => {
  const dateien = kleinesRepo({ ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - with:\n          node-version: 22\n" });
  const { ergebnis, aufrufe, lies } = lauf(t, { dateien, heute: "2026-11-11" });
  assert.notEqual(ergebnis.status, 0);
  assert.match(ergebnis.stderr, /CI/);
  assert.equal(hatPr(aufrufe), false);
  assert.equal(lies(".nvmrc"), "22.18\n");
});

test("Eine unlesbare Release-Liste stoppt den Lauf, statt keinen Fund zu melden", (t) => {
  const { ergebnis, aufrufe } = lauf(t, { heute: "2026-11-11", liste: '{"keine":"liste"}' });
  assert.notEqual(ergebnis.status, 0);
  assert.equal(hatPr(aufrufe), false);
});

test("Eine Liste ohne einen einzigen brauchbaren LTS-Eintrag stoppt den Lauf", (t) => {
  const { ergebnis, aufrufe } = lauf(t, { heute: "2026-11-11", liste: [{ version: "v27.0.0-alpha.0.0.0", date: "2026-10-29", lts: false }] });
  assert.notEqual(ergebnis.status, 0);
  assert.equal(hatPr(aufrufe), false);
});

test("Fehlt die engines-Angabe, bricht der Lauf ab, statt einen unvollständigen PR zu öffnen", (t) => {
  const dateien = kleinesRepo({ "package.json": `{ "devDependencies": {} }\n` });
  const { ergebnis, aufrufe, entfernteZweige } = lauf(t, { dateien, heute: "2026-11-11" });
  assert.notEqual(ergebnis.status, 0);
  assert.equal(hatPr(aufrufe), false);
  assert.deepEqual(entfernteZweige, ["master"]);
});

test("@types/node wird ohne Paket-Skripte und nur aus ausreichend alten Versionen gezogen", (t) => {
  const { aufrufe } = lauf(t, { heute: "2026-11-11" });
  const npm = aufrufe.find((zeile) => zeile.startsWith("npm "));
  assert.ok(npm, "npm nicht aufgerufen");
  assert.match(npm, /--ignore-scripts/);
  assert.match(npm, /--package-lock-only/);
  assert.match(npm, /--save-exact/);
  assert.match(npm, /@types\/node@26(?:\s|$)/);
  assert.match(npm, /--before=2026-11-03/);
});

test("Ein NODE_VERSION-Eintrag in render.yaml wird mitgezogen", (t) => {
  const dateien = kleinesRepo({ "render.yaml": 'services:\n  - type: web\n    envVars:\n      - key: NODE_VERSION\n        value: "22.18"\n' });
  const { lies } = lauf(t, { dateien, heute: "2026-11-11" });
  assert.match(lies("render.yaml"), /key: NODE_VERSION\n\s+value: "26\.13"/);
});

test("Einträge mit unlesbarer Version oder unlesbarem Datum zählen nicht als LTS, der Lauf stoppt", (t) => {
  const liste = [
    { version: "v27.0.0-rc.1", date: "2026-10-01", lts: "Vorab" },
    { version: "v28.0.0", date: "bald", lts: "Ohne Datum" },
  ];
  const { ergebnis, aufrufe } = lauf(t, { heute: "2026-11-11", liste });
  assert.notEqual(ergebnis.status, 0);
  assert.equal(hatPr(aufrufe), false);
});

test("Ein Vorlauf-Job mit neuerer Node-Version als das Ziel wird nicht zurückgestuft", (t) => {
  const dateien = kleinesRepo({ ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - with:\n          node-version: 22\n      - with:\n          node-version: 26\n      - with:\n          node-version: 28\n" });
  const { ergebnis, lies } = lauf(t, { dateien, heute: "2026-11-11" });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  const zahlen = [...lies(".github/workflows/ci.yml").matchAll(/node-version: (\d+)/g)].map(([, zahl]) => Number(zahl));
  assert.deepEqual(zahlen, [26, 26, 28]);
});

test("Die Vorgabe eines anderen Action-Eingangs bleibt, nur die von node-version wird angehoben", (t) => {
  const aktion = 'inputs:\n  node-version:\n    description: Hauptversion.\n    required: false\n    default: "22"\n  versuche:\n    description: Anzahl.\n    default: "3"\n';
  const dateien = kleinesRepo({ ".github/actions/node-npm-ci/action.yml": aktion });
  const { ergebnis, lies } = lauf(t, { dateien, heute: "2026-11-11" });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  const neu = lies(".github/actions/node-npm-ci/action.yml");
  assert.match(neu, /node-version:\n.*\n.*\n\s+default: "26"/);
  assert.match(neu, /versuche:\n.*\n\s+default: "3"/);
});

test("Auf den echten Dateien des Repos zieht der Lauf alle Stellen auf die höchste Version der CI", (t) => {
  const dateien = {};
  for (const pfad of ["package.json", "render.yaml"]) dateien[pfad] = readFileSync(join(REPO_ROOT, pfad), "utf8");
  const echteYaml = execFileSync("git", ["ls-files", ".github"], { cwd: REPO_ROOT, encoding: "utf8" }).trim().split("\n");
  for (const pfad of echteYaml) dateien[pfad] = readFileSync(join(REPO_ROOT, pfad), "utf8");
  const ziel = Math.max(...[...dateien[".github/workflows/ci.yml"].matchAll(/node-version:\s*["']?(\d+)/g)].map(([, zahl]) => Number(zahl)));
  dateien[".nvmrc"] = `${ziel - 1}.0\n`;
  dateien["package-lock.json"] = "{}\n";
  const liste = [{ version: `v${ziel}.13.0`, date: "2026-10-28", lts: "Probe" }];

  const { ergebnis, aufrufe, lies, wurzel } = lauf(t, { dateien, liste, heute: "2026-11-11" });

  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  assert.equal(hatPr(aufrufe), true);
  assert.equal(lies(".nvmrc"), `${ziel}.13\n`);
  assert.equal(JSON.parse(lies("package.json")).engines.node, `>=${ziel}.13 <${ziel + 1}`);
  assert.equal(existsSync(join(wurzel, ".github/actions/node-npm-ci/action.yml")), true);
  const aktion = lies(".github/actions/node-npm-ci/action.yml");
  assert.ok(aktion.includes(`default: "${ziel}"`), aktion);
  assert.ok(aktion.includes(`Standard ${ziel}`), aktion);
  for (const pfad of echteYaml.filter((name) => name.endsWith(".yml"))) {
    for (const [, zahl] of lies(pfad).matchAll(/node-version:\s*["']?(\d+)/g)) assert.equal(Number(zahl), ziel, `${pfad}: node-version ${zahl}`);
    for (const [, zahl] of lies(pfad).matchAll(/\bNode (\d+)\b/g)) assert.ok(Number(zahl) >= ziel, `${pfad}: Node ${zahl}`);
  }
});

function mitNotAus(t, antwort) {
  process.env.PROBE_NOT_AUS = antwort;
  t.after(() => {
    delete process.env.PROBE_NOT_AUS;
  });
}

test("Not-Aus: mit gesetztem Label updates-pausiert öffnet die Node-Erkennung keinen PR und ändert nichts", (t) => {
  mitNotAus(t, JSON.stringify([{ number: 3458 }]));
  const { ergebnis, aufrufe, lies, entfernteZweige } = lauf(t, { heute: "2026-11-11" });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  assert.match(ergebnis.stdout, /updates-pausiert/);
  assert.equal(hatPr(aufrufe), false);
  assert.equal(lies(".nvmrc"), "22.18\n");
  assert.deepEqual(entfernteZweige, ["master"]);
});

test("Not-Aus: ohne Label öffnet die Node-Erkennung den PR wie bisher", (t) => {
  mitNotAus(t, "[]");
  const { ergebnis, aufrufe } = lauf(t, { heute: "2026-11-11" });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  assert.equal(hatPr(aufrufe), true);
});

test("Not-Aus: eine unlesbare Antwort stoppt die Node-Erkennung, statt den PR zu öffnen", (t) => {
  mitNotAus(t, "kein json");
  const { ergebnis, aufrufe, entfernteZweige } = lauf(t, { heute: "2026-11-11" });
  assert.notEqual(ergebnis.status, 0);
  assert.equal(hatPr(aufrufe), false);
  assert.deepEqual(entfernteZweige, ["master"]);
});
