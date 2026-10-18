import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MAX_AUSGABEDATEI_BYTES, legeAusgabeAb } from "../../tools/auftrag/pruefungen.mjs";
import { BASIS, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";

const ROTER_VORLAUFTEST = "gross bleibt unter Last gleich";
const URSACHE_IM_LINT = "src/text.js:7 Ursache-Marke aus der Mitte der Ausgabe";
const BELEGORDNER = ".fortschritt/probe";
const AUSGABE_ENDUNG = ".log";
const ABSATZ_LINT = "Zweck lint: Drehbuchtext des Ersatz-Agenten.";
const UMGEBAUT = { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" };

function skript(zeilen, exitCode) {
  return `for (const zeile of ${JSON.stringify(zeilen)}) console.log(zeile);\nprocess.exitCode = ${exitCode};\n`;
}

const VORLAUF_ABBRUCH = skript(
  [
    "Hinweis: Vorlage für src/text.js eingestellt",
    "12:00:00 (4711) ERROR DryRunExecutor One or more tests failed in the initial test run:",
    `\t${ROTER_VORLAUFTEST}`,
    ...Array.from({ length: 12 }, (_, nummer) => `\t\t    at Stelle ${nummer} (test/text.test.js:${nummer}:1)`),
    "Abbruch: There were failed tests in the initial test run.",
  ],
  2,
);

const LANGE_LINTAUSGABE = skript(
  [...Array.from({ length: 30 }, (_, nummer) => `Lint-Fortschritt ${nummer}`), URSACHE_IM_LINT, ...Array.from({ length: 30 }, (_, nummer) => `Lint-Nachlauf ${nummer}`)],
  1,
);

function mitSkripten(skripte) {
  const paket = JSON.parse(BASIS["package.json"]);
  const dateien = Object.fromEntries(Object.entries(skripte).map(([name, inhalt]) => [`${name}.mjs`, inhalt]));
  const scripts = { ...paket.scripts, ...Object.fromEntries(Object.keys(skripte).map((name) => [name, `node ${name}.mjs`])) };
  return { ...dateien, "package.json": JSON.stringify({ ...paket, scripts }) };
}

function ausgabeDateien(repo) {
  return readdirSync(join(repo, BELEGORDNER)).filter((name) => name.endsWith(AUSGABE_ENDUNG));
}

function inhalt(repo, datei) {
  return readFileSync(join(repo, BELEGORDNER, datei), "utf8");
}

test("bricht die Mutationsprüfung im Vorlauf ab, nennt der Beleg-Ordner den roten Test, auch wenn er weder Trefferzeile noch Schlusszeile ist", (context) => {
  const { repo, beleg, lauf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: UMGEBAUT }, dateien: mitSkripten({ "test:mutation": VORLAUF_ABBRUCH }) });
  assert.ok(beleg, lauf.stdout + lauf.stderr);
  const abbruch = beleg.pruefungen.find(({ exitCode }) => exitCode === 2);
  assert.ok(abbruch, JSON.stringify(beleg.pruefungen));
  assert.ok(!abbruch.zeilen.some((zeile) => zeile.includes(ROTER_VORLAUFTEST)), JSON.stringify(abbruch.zeilen));
  assert.equal(typeof abbruch.ausgabeDatei, "string", "Der Beleg verweist auf die volle Ausgabe");
  assert.ok(inhalt(repo, abbruch.ausgabeDatei).includes(ROTER_VORLAUFTEST), abbruch.ausgabeDatei);
  const dateien = ausgabeDateien(repo);
  assert.equal(dateien.length, 2, `Erster Versuch und Wiederholung legen je eine eigene Datei ab: ${dateien.join(", ")}`);
  for (const datei of dateien) assert.ok(inhalt(repo, datei).includes(ROTER_VORLAUFTEST), datei);
  const gruen = beleg.pruefungen.filter(({ exitCode }) => exitCode === 0);
  assert.ok(gruen.length > 0);
  assert.deepEqual(gruen.filter((eintrag) => "ausgabeDatei" in eintrag), []);
});

test("die volle Ausgabe einer roten Prüfung liegt im Beleg-Ordner, gelangt aber in keinen Prompt an die Agenten", (context) => {
  const { repo, werkzeug, beleg, lauf } = starte(context, {
    auftrag: UMBAU,
    drehbuch: { bau: UMGEBAUT, "bau-antwort": ABSATZ_LINT },
    dateien: mitSkripten({ lint: LANGE_LINTAUSGABE }),
  });
  assert.ok(beleg, lauf.stdout + lauf.stderr);
  const lint = beleg.pruefungen.find(({ name }) => name === "lint");
  assert.equal(lint.exitCode, 1);
  assert.equal(typeof lint.ausgabeDatei, "string", "Der Beleg verweist auf die volle Ausgabe");
  assert.ok(inhalt(repo, lint.ausgabeDatei).includes(URSACHE_IM_LINT), lint.ausgabeDatei);
  const prompts = readdirSync(werkzeug).filter((name) => name.startsWith("prompt-"));
  assert.ok(prompts.includes("prompt-bau.txt"), prompts.join(", "));
  for (const prompt of prompts) {
    const text = readFileSync(join(werkzeug, prompt), "utf8");
    assert.ok(text.includes("Lint-Nachlauf 29"), `${prompt} zeigt die entscheidenden Zeilen der vorigen Runde`);
    assert.ok(!text.includes(URSACHE_IM_LINT), `${prompt} enthält die volle Ausgabe`);
    assert.ok(!text.includes(lint.ausgabeDatei), `${prompt} nennt die Ausgabedatei`);
  }
});

test("die Ausgabedatei behält höchstens die letzten MAX_AUSGABEDATEI_BYTES, eine grüne Prüfung legt keine an", (context) => {
  const ordner = probeDirectory(context, {});
  const eintrag = { name: "mutation", exitCode: 2, zeilen: [] };
  const ende = "Abbruch: There were failed tests in the initial test run.";
  const faelle = [
    { ausgabe: "x".repeat(MAX_AUSGABEDATEI_BYTES - ende.length) + ende, kopf: "x" },
    { ausgabe: "x".repeat(MAX_AUSGABEDATEI_BYTES + 7 - ende.length) + ende, kopf: "[7 Bytes vom Anfang weggelassen]\nx" },
  ];
  for (const [nummer, { ausgabe, kopf }] of faelle.entries()) {
    const { ausgabeDatei } = legeAusgabeAb(eintrag, { exitCode: 2, ausgabe }, { ordner, stamm: `fall-${nummer}` });
    const text = readFileSync(join(ordner, ausgabeDatei), "utf8");
    assert.ok(text.startsWith(kopf), text.slice(0, 40));
    assert.ok(text.endsWith(`${ende}\n`));
    assert.equal(text.length, kopf.length - 1 + MAX_AUSGABEDATEI_BYTES + 1);
  }
  assert.equal(legeAusgabeAb(eintrag, { exitCode: 0, ausgabe: ende }, { ordner, stamm: "gruen" }), eintrag);
  assert.deepEqual(readdirSync(ordner).sort(), ["fall-0.log", "fall-1.log"]);
});
