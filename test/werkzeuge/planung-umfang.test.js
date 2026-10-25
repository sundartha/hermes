import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, planeAntworten, planungsBericht } from "./planung-plane-probe.js";
import { HINWEIS, LAUF_FRIST_MS, ORDNER, exit, geaenderteDateien, plane } from "./planung-probe.js";
import { REPO_ROOT, isolatedEnvironment, probeRepository } from "./probe-repo.js";

const PAKET = "plaene/P-009-probe";
const KB = 1024;
const DOKUMENT_KB = 3;
const PITCH = `# Probe

## Anforderungen

#### Szenario S1: Hinweis erscheint
Die Änderung liegt in \`src/hinweis.js:4\`.

#### Szenario S2: Hinweis bleibt aus
Siehe \`src/grund.js:1\` und \`test/hinweis.test.js:1\`.

## Bleibt unverändert

### Szenario B1: Alter Weg
Die Datei \`src/fehlt.js:3\` gibt es nicht.
`;
const SICHERHEIT = `# Sicherheit

## 2. Angriffswege

### T1: Fremde Nummer
Ausgang: verhindern
Szenario: fremde Nummer wird abgelehnt

### T2: Lange Leitung
Ausgang: hinnehmen
`;
const DESIGN_KOPF = "# Design\n\n";
const QUELLEN = {
  "src/hinweis.js": `import { grund } from "./grund.js";\n\nexport function alt(nummer) {\n  var text = grund(nummer);\n  return text;\n}\n\nexport function neu(nummer) {\n  return nummer;\n}\n`,
  "src/grund.js": `export function grund(nummer) {\n  return nummer;\n}\n`,
  "test/hinweis.test.js": `import { alt } from "../src/hinweis.js";\n\nalt("x");\n`,
  "test/grund.test.js": `import { grund } from "../src/grund.js";\n\ngrund("x");\n`,
  "tools/bereiche.json": "[]",
  "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
  "package.json": JSON.stringify({ type: "module" }),
  ".gitignore": "node_modules\n",
};

function design() {
  const belegt = Buffer.byteLength(PITCH) + Buffer.byteLength(SICHERHEIT) + Buffer.byteLength(DESIGN_KOPF);
  return DESIGN_KOPF + "x".repeat(DOKUMENT_KB * KB - belegt);
}

function paketRepo(context, dokumente, quellen = QUELLEN) {
  const wurzel = probeRepository(context, { ...quellen, ...Object.fromEntries(Object.entries(dokumente).map(([name, text]) => [`${PAKET}/${name}`, text])) });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(wurzel, "node_modules"));
  return wurzel;
}

function umfangIn(wurzel, ordner) {
  return spawnSync(process.execPath, [AUFTRAG, "umfang", ordner], { cwd: wurzel, encoding: "utf8", env: isolatedEnvironment(), timeout: LAUF_FRIST_MS });
}

test("umfang zählt Nummern, belegte Code- und Testdateien, getroffene Funktionen, Altfunktionen, erreichende Tests und die Dokumentgröße eines Pitch-Ordners", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = paketRepo(context, { "pitch.md": PITCH, "sicherheit.md": SICHERHEIT, "design.md": design() });

  const lauf = umfangIn(wurzel, PAKET);

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(JSON.parse(lauf.stdout), {
    nummern: 4,
    codeDateien: ["src/grund.js", "src/hinweis.js"],
    testDateien: ["test/hinweis.test.js"],
    funktionen: 2,
    altfunktionen: 1,
    testsAnDateien: ["test/grund.test.js", "test/hinweis.test.js"],
    dokumentKB: DOKUMENT_KB,
  });
});

function umfangMitAbschnitt(context, abschnitt) {
  const wurzel = paketRepo(context, { "pitch.md": PITCH + abschnitt, "sicherheit.md": SICHERHEIT, "design.md": DESIGN_KOPF });
  const lauf = umfangIn(wurzel, PAKET);
  exit(lauf, EXIT_GRUEN);
  return JSON.parse(lauf.stdout);
}

test("umfang trennt geänderte Code-Dateien aus dem Abschnitt Geänderte Dateien von reinen Beleg-Dateien", { timeout: LAUF_FRIST_MS }, (context) => {
  const gemessen = umfangMitAbschnitt(context, geaenderteDateien(["src/hinweis.js", "src/neu.js", "test/hinweis.test.js"]));

  assert.deepEqual(gemessen.codeDateien, ["src/grund.js", "src/hinweis.js"]);
  assert.deepEqual(gemessen.geaenderteDateien, ["src/hinweis.js", "src/neu.js", "test/hinweis.test.js"]);
  assert.deepEqual(gemessen.belegDateien, ["src/grund.js"]);
});

test("umfang zählt bei einem Ordner oder einer Zeile ohne Dateiform unter Geänderte Dateien jede belegte Code-Datei als geändert", { timeout: LAUF_FRIST_MS }, (context) => {
  for (const abschnitt of [geaenderteDateien(["src/hinweis.js", "src/"]), `${geaenderteDateien(["src/hinweis.js"])}keine, weil nur belegt wird\n`]) {
    const gemessen = umfangMitAbschnitt(context, abschnitt);

    assert.deepEqual(gemessen.codeDateien, ["src/grund.js", "src/hinweis.js"], abschnitt);
    assert.equal(gemessen.geaenderteDateien, undefined, abschnitt);
    assert.equal(gemessen.belegDateien, undefined, abschnitt);
  }
});

test("umfang ohne sicherheit.md endet mit Exit 2, nennt die fehlende Datei und gibt kein JSON aus", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = paketRepo(context, { "pitch.md": PITCH });

  const lauf = umfangIn(wurzel, PAKET);

  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, /enthält kein sicherheit\.md/u);
  assert.equal(lauf.stdout, "");
});

function mitBeleg(wurzel) {
  appendFileSync(join(wurzel, ORDNER, "design.md"), `\nBeleg für den Hinweis: \`${HINWEIS}:7\`\n`);
  return ["plane", ORDNER];
}

test("plane schreibt den Umfang des Pitches in planung.json, gleich der Ausgabe von umfang", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: mitBeleg });
  exit(lauf, EXIT_GRUEN);

  const { umfang } = planungsBericht(lauf);

  const gemessen = umfangIn(lauf.wurzel, ORDNER);
  exit(gemessen, EXIT_GRUEN);
  assert.deepEqual(umfang, JSON.parse(gemessen.stdout));
  assert.ok(umfang.codeDateien.includes(HINWEIS), JSON.stringify(umfang));
});

const KETTE = {
  "src/a.js": `import { b1 } from "./b.js";\n\nexport function a() {\n  return b1();\n}\n`,
  "src/b.js": `import { c } from "./c.js";\n\nexport function b1() {\n  return c();\n}\n\nexport function b2() {\n  return 2;\n}\n`,
  "src/c.js": `export function c() {\n  return 3;\n}\n`,
  "src/d.js": `import { b2 } from "./b.js";\n\nconsole.log(b2());\n`,
  "test/a.test.js": `import { a } from "../src/a.js";\n\na();\n`,
  "test/c.test.js": `import { c } from "../src/c.js";\n\nc();\n`,
  "test/b.test.js": `import { b1, b2 } from "../src/b.js";\n\nb1();\nb2();\n`,
  "test/b-spaet.test.js": `const b = await import("../src/b.js");\n\nb.b1();\n`,
  "test/b-raum.test.js": `import * as b from "../src/b.js";\n\nb.b2();\n`,
  "test/b-gemischt.test.js": `let b;\nb = await import("../src/b.js");\nb.b1();\nconst { b2 } = await import("../src/b.js");\nb2();\n`,
  "package.json": JSON.stringify({ type: "module" }),
  ".gitignore": "node_modules\n",
};

function loeschPitch(einstiege) {
  return `# Probe\n\n## Löschen\n\n${einstiege.map((einstieg) => `- \`${einstieg}\``).join("\n")}\n`;
}

function loeschmengeIn(context, quellen, einstiege) {
  const wurzel = paketRepo(context, { "pitch.md": loeschPitch(einstiege), "sicherheit.md": SICHERHEIT }, quellen);
  const lauf = umfangIn(wurzel, PAKET);
  exit(lauf, EXIT_GRUEN);
  return JSON.parse(lauf.stdout).loeschmenge;
}

test("umfang rechnet zu einem Abschnitt Löschen die Dateien und Exporte, die mit dem Einstieg ihren letzten Nutzer verlieren, behält eine Datei, die ein anderer mitnutzt, und nennt je Test, ob er wegfällt oder angepasst werden muss", { timeout: LAUF_FRIST_MS }, (context) => {
  const loeschmenge = loeschmengeIn(context, KETTE, ["src/a.js:a"]);

  assert.deepEqual(loeschmenge, {
    dateien: ["src/a.js", "src/c.js"],
    exporte: ["src/b.js:b1"],
    reste: ["src/b.js:c"],
    tests: [
      { datei: "test/a.test.js", art: "löschen" },
      { datei: "test/b-gemischt.test.js", art: "anpassen" },
      { datei: "test/b-spaet.test.js", art: "löschen" },
      { datei: "test/b.test.js", art: "anpassen" },
      { datei: "test/c.test.js", art: "löschen" },
    ],
    fehlend: [],
  });
});

const ROUTEN = {
  "src/routen.js": [
    `import { Router } from "express";`,
    `import { altText } from "./alt.js";`,
    `import { neuText } from "./neu.js";`,
    "",
    `const ALT_PRAEFIX = "[alt]";`,
    "",
    "export function routen() {",
    "  const router = Router();",
    "  function antworteAlt(res) {",
    "    res.send(`${ALT_PRAEFIX} ${altText()}`);",
    "  }",
    `  router.post("/alt", (req, res) => antworteAlt(res));`,
    `  router.post("/neu", (req, res) => res.send(neuText()));`,
    "  return router;",
    "}",
    "",
  ].join("\n"),
  "src/alt.js": `export function altText() {\n  return "alt";\n}\n`,
  "src/neu.js": `export function neuText() {\n  return "neu";\n}\n`,
  "src/server.js": `import { routen } from "./routen.js";\n\nrouten();\n`,
  "test/alt.test.js": `import { altText } from "../src/alt.js";\n\naltText();\n`,
  "package.json": JSON.stringify({ type: "module" }),
  ".gitignore": "node_modules\n",
};

test("umfang rechnet die Löschmenge einer Route bis zu den Resten in der bleibenden Datei und nennt einen Einstieg, den es nicht gibt", { timeout: LAUF_FRIST_MS }, (context) => {
  const loeschmenge = loeschmengeIn(context, ROUTEN, ["src/routen.js:/alt", "src/routen.js:/gibt-es-nicht", "src/fehlt.js:weg"]);

  assert.deepEqual(loeschmenge, {
    dateien: ["src/alt.js"],
    exporte: [],
    reste: ["src/routen.js:ALT_PRAEFIX", "src/routen.js:altText", "src/routen.js:antworteAlt"],
    tests: [{ datei: "test/alt.test.js", art: "löschen" }],
    fehlend: ["src/routen.js:/gibt-es-nicht", "src/fehlt.js:weg"],
  });
});

const VORSICHT = {
  "src/alt.js": [
    `import { n } from "./ns.js";`,
    `import { s } from "./seite.js";`,
    `import { dyn } from "./dyn.js";`,
    `import { k } from "./kaputt-ziel.js";`,
    `import { b1 } from "./b.js";`,
    `import { vorlage } from "./vorlage.js";`,
    `import { werkzeug } from "./werkzeug.js";`,
    "",
    "export function alt() {",
    "  return [n(), s(), dyn(), k(), b1(), vorlage(), werkzeug()];",
    "}",
    "",
  ].join("\n"),
  "src/ns.js": `export function n() {\n  return 1;\n}\n`,
  "src/seite.js": `export function s() {\n  return 2;\n}\n`,
  "src/dyn.js": `export function dyn() {\n  return 3;\n}\n`,
  "src/kaputt-ziel.js": `export function k() {\n  return 4;\n}\n`,
  "src/vorlage.js": `export function vorlage() {\n  return 8;\n}\n`,
  "src/werkzeug.js": `export function werkzeug() {\n  return 9;\n}\n`,
  "src/spaet.js": "const geladen = await import(`./vorlage.js`);\nconsole.log(geladen);\n",
  "src/doppelt.js": `export function d1() {\n  return 10;\n}\n`,
  "src/teil.js": "import { d1 } from \"./doppelt.js\";\n\nexport function weg() {\n  return d1();\n}\n\nexport function bleibt() {\n  return import(`./doppelt.js`);\n}\n",
  "src/teil-nutzer.js": `import { bleibt } from "./teil.js";\n\nconsole.log(bleibt());\n`,
  "tools/messung.mjs": `import { werkzeug } from "../src/werkzeug.js";\n\nconsole.log(werkzeug());\n`,
  "src/b.js": `export function b1() {\n  return 5;\n}\n\nexport function b2() {\n  return 6;\n}\n\nexport function b3() {\n  return 7;\n}\n`,
  "src/haupt.js": `import * as ns from "./ns.js";\nimport "./seite.js";\nimport { b2 } from "./b.js";\n\nconst dyn = await import("./dyn.js");\nconsole.log(ns, dyn, b2());\n`,
  "src/kaputt.js": `import { k } from "./kaputt-ziel.js";\n\nk(;\n`,
  "test/b3.test.js": `import { b3 } from "../src/b.js";\n\nb3();\n`,
  "package.json": JSON.stringify({ type: "module" }),
  ".gitignore": "node_modules\n",
};

test("umfang lässt in der Löschmenge Dateien stehen, die ein Namensraum-, Nebenwirkungs- oder dynamischer Import, ein Import aus einer Vorlage ohne Platzhalter, auch neben einem statischen Import, ein Werkzeug unter tools/ oder ein nicht lesbarer Importeur hält, und einen Export, den vorher nur Tests nutzten", { timeout: LAUF_FRIST_MS }, (context) => {
  const loeschmenge = loeschmengeIn(context, VORSICHT, ["src/alt.js:alt", "src/teil.js:weg"]);

  assert.deepEqual(loeschmenge, { dateien: ["src/alt.js"], exporte: ["src/b.js:b1"], reste: ["src/teil.js:d1"], tests: [], fehlend: [] });
});
