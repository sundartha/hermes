import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";

import konfiguration from "../../eslint.config.js";
import { kenntZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import lintFormat from "../../tools/lint-format.mjs";
import { STRENGE_NEBENREGELN } from "../../tools/lint-neue-funktionen.mjs";
import { NAMENSREGEL, OHNE_REGEL, lintGruppen, lintZweckId, lintZweckZeilen } from "../../tools/lint-zweck.mjs";
import { PRUEFREGEL } from "../../tools/neue-kommentare.mjs";
import { gelesen } from "../../tools/syntaxbaum.mjs";
import { REPO_ROOT, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { EXIT_ROT, TOR, UNTERDRUECKUNGEN } from "./unterdrueckungen-probe.js";

const ZUORDNUNG = JSON.parse(readFileSync(join(REPO_ROOT, "tools/zweck/zuordnung/lint-regeln.json"), "utf8"));
const TEXTE = JSON.parse(readFileSync(join(REPO_ROOT, "tools/zweck/lint.json"), "utf8"));
const PRAEFIX = "lint/";
const AUS = new Set(["off", 0]);
const MELDUNG = "message";
const EINTRAGS_SCHLUESSEL = ["selector", "name", "object", "property", "group", "regex"];
const LITERAL_ID = /^lint\/[a-z-]+$/;
const ZEIGEN_AUFRUF = /zweck-zeigen\.mjs((?: [a-z]+\/[a-z-]+)+)/g;
const JS_DATEI = /\.(?:js|mjs|cjs)$/;
const NUTZER_DATEI = /\.(?:js|mjs|cjs|ya?ml)$|^\.githooks\//;
const NUTZER_ORTE = ["tools", "scripts", ".githooks", ".github/workflows", ".claude/hooks"];
const IGNORIERTER_ORDNER = ".mutationspruefung";
const VERSIONIERT = {
  "tools/werkzeug.mjs": "export const wert = 1;\n",
  "scripts/lauf.js": "export const wert = 2;\n",
  ".githooks/pre-push": "#!/bin/sh\n",
  ".github/workflows/ci.yml": "name: ci\n",
  ".claude/hooks/hook.cjs": "module.exports = 3;\n",
  "tools/notiz.md": "Keine Nutzer-Datei\n",
};
const UNVERSIONIERT = { "tools/neu.mjs": "export const wert = 4;\n" };
const VERSIONIERTE_NUTZER_DATEIEN = [
  ".claude/hooks/hook.cjs",
  ".githooks/pre-push",
  ".github/workflows/ci.yml",
  "scripts/lauf.js",
  "tools/werkzeug.mjs",
];
const MODUL = { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: {} };
const ZAHL_OHNE_NAMEN = 7;
const DEMETER = "Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)";
const ALTLAST = "eslint-legacy-exceptions.json";
const PROBE_DATEI = join(REPO_ROOT, "src/zweck-lint-probe.js");
const PROBE_CODE = [
  "export function vier(erster, zweiter, dritter, vierter) {",
  "  return [erster, zweiter, dritter, vierter];",
  "}",
  "export function fuenf(erster, zweiter, dritter, vierter, fuenfter) {",
  `  return [erster, zweiter, dritter, vierter, fuenfter].length * ${ZAHL_OHNE_NAMEN};`,
  "}",
  "",
].join("\n");
const NUR_WARNUNG = "export function eins(wert) {\n  const ungenutzt = wert;\n  return 1;\n}\n";

function stufe(wert) {
  return Array.isArray(wert) ? wert[0] : wert;
}

function konfigurierteRegeln() {
  const regeln = new Map();
  for (const { rules = {} } of konfiguration) {
    for (const [regel, wert] of Object.entries(rules)) {
      if (AUS.has(stufe(wert))) continue;
      if (!regeln.has(regel)) regeln.set(regel, []);
      if (Array.isArray(wert)) regeln.get(regel).push(...wert.slice(1));
    }
  }
  return regeln;
}

function eintraege(wert) {
  if (Array.isArray(wert)) return wert.flatMap(eintraege);
  if (wert === null || typeof wert !== "object") return [wert];
  const kinder = Object.values(wert).flatMap(eintraege);
  return EINTRAGS_SCHLUESSEL.some((schluessel) => Object.hasOwn(wert, schluessel)) ? [wert, ...kinder] : kinder;
}

function meldungen(optionen) {
  return eintraege(optionen).filter((eintrag) => typeof eintrag === "object").map((eintrag) => eintrag[MELDUNG]);
}

function hatMeldungen(optionen) {
  return meldungen(optionen).some((meldung) => typeof meldung === "string");
}

function zugeordneteIds() {
  const { regeln, meldungen: nachMeldung, namen, ohneRegel } = ZUORDNUNG;
  return [
    ...Object.values(regeln),
    ...Object.values(nachMeldung).flatMap(Object.values),
    ...Object.values(namen).flatMap(Object.values),
    ...Object.values(ohneRegel),
  ];
}

function versionierteDateien(ordner = REPO_ROOT) {
  const lauf = runIn(ordner, "git", ["ls-files", "-z", "--full-name", "--", ...NUTZER_ORTE.map((ort) => `:/${ort}`)]);
  assert.equal(lauf.status, 0, lauf.stderr);
  const dateien = lauf.stdout.split("\0").filter((datei) => NUTZER_DATEI.test(datei));
  assert.ok(dateien.length > 0, `git ls-files findet in ${ordner} keine versionierte Datei unter ${NUTZER_ORTE.join(", ")}`);
  return dateien;
}

function inIgnoriertemOrdner(dateien) {
  return Object.fromEntries(Object.entries(dateien).map(([pfad, inhalt]) => [join(IGNORIERTER_ORDNER, pfad), inhalt]));
}

function literale(baum) {
  const gefunden = [];
  const offen = [baum];
  while (offen.length > 0) {
    const knoten = offen.pop();
    if (knoten?.type === "Literal" && typeof knoten.value === "string") gefunden.push(knoten.value);
    if (knoten !== null && typeof knoten === "object") offen.push(...Object.values(knoten));
  }
  return gefunden;
}

function idsInDatei(datei) {
  const text = readFileSync(join(REPO_ROOT, datei), "utf8");
  const aufrufe = [...text.matchAll(ZEIGEN_AUFRUF)].flatMap((treffer) => treffer[1].trim().split(" "));
  const imCode = JS_DATEI.test(datei) ? literale(gelesen(text, MODUL)).filter((wert) => LITERAL_ID.test(wert)) : [];
  return [...aufrufe, ...imCode].filter((id) => id.startsWith(PRAEFIX));
}

async function probeErgebnis(code) {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [ergebnis] = await eslint.lintText(code, { filePath: PROBE_DATEI });
  return { ergebnis, stylish: await (await eslint.loadFormatter("stylish")).format([ergebnis]) };
}

test("jede konfigurierte Lint-Regel ohne eigene Meldungen ist einer Regelgruppe zugeordnet, und die Zuordnung nennt keine andere", () => {
  const konfiguriert = konfigurierteRegeln();
  const einfach = [...konfiguriert]
    .filter(([regel, optionen]) => regel !== NAMENSREGEL && !hatMeldungen(optionen))
    .map(([regel]) => regel);
  const erwartet = new Set([...einfach, ...Object.keys(STRENGE_NEBENREGELN), PRUEFREGEL]);
  assert.deepEqual(Object.keys(ZUORDNUNG.regeln).toSorted(), [...erwartet].toSorted());
});

test("jede eingetragene Meldung einer Sperr-Regel trifft genau einen Teiltext der Zuordnung, und jeder Teiltext trifft eine Meldung", () => {
  const mitMeldungen = [...konfigurierteRegeln()].filter(([regel, optionen]) => regel !== NAMENSREGEL && hatMeldungen(optionen));
  assert.deepEqual(Object.keys(ZUORDNUNG.meldungen).toSorted(), mitMeldungen.map(([regel]) => regel).toSorted());
  for (const [regel, optionen] of mitMeldungen) {
    const teile = Object.keys(ZUORDNUNG.meldungen[regel]);
    assert.deepEqual(optionen.filter((option) => typeof option === "string"), [], `${regel}: ein Eintrag ohne eigene Meldung`);
    for (const meldung of meldungen(optionen)) {
      assert.equal(typeof meldung, "string", `${regel}: ein Eintrag ohne eigene Meldung`);
      assert.equal(teile.filter((teil) => meldung.includes(teil)).length, 1, `${regel}: ${meldung}`);
    }
    for (const teil of teile) assert.ok(meldungen(optionen).some((meldung) => meldung.includes(teil)), `${regel}: ${teil}`);
  }
});

test("jeder Name von hermes/wort-nur-in ist einer Regelgruppe zugeordnet, und Meldungen ohne Regel haben ihre Gruppe", () => {
  const namen = new Set(konfigurierteRegeln().get(NAMENSREGEL).map(({ name }) => name));
  assert.deepEqual(Object.keys(ZUORDNUNG.namen[NAMENSREGEL]).toSorted(), [...namen].toSorted());
  assert.deepEqual(Object.keys(ZUORDNUNG.namen), [NAMENSREGEL]);
  assert.deepEqual(Object.keys(ZUORDNUNG.ohneRegel).toSorted(), Object.values(OHNE_REGEL).toSorted());
});

test("jede zugeordnete Regelgruppe hat einen Zweck-Text in tools/zweck/lint.json", () => {
  for (const id of zugeordneteIds()) {
    assert.ok(id.startsWith(PRAEFIX), id);
    assert.ok(kenntZweck(id), id);
  }
});

test("tools/zweck/lint.json hat keine ID, die weder die Zuordnung noch ein Skript, Hook oder Workflow nutzt", () => {
  const genutzt = new Set([...zugeordneteIds(), ...versionierteDateien().flatMap(idsInDatei)]);
  for (const id of genutzt) assert.ok(kenntZweck(id), `${id} wird genutzt, hat aber keinen Text`);
  assert.deepEqual(Object.keys(TEXTE).filter((id) => !genutzt.has(id)), []);
});

test("versionierteDateien nennt aus einem ignorierten Ordner im Checkout dieselben versionierten Dateien wie im Checkout, mit Pfaden ab der Wurzel", (context) => {
  const repo = probeRepository(context, VERSIONIERT);
  writeFiles(repo, UNVERSIONIERT);
  writeFiles(repo, { [`${IGNORIERTER_ORDNER}/.gitignore`]: "*\n", ...inIgnoriertemOrdner({ ...VERSIONIERT, ...UNVERSIONIERT }) });
  assert.deepEqual(versionierteDateien(repo).toSorted(), VERSIONIERTE_NUTZER_DATEIEN);
  assert.deepEqual(versionierteDateien(join(repo, IGNORIERTER_ORDNER)).toSorted(), VERSIONIERTE_NUTZER_DATEIEN);
});

test("versionierteDateien scheitert laut, wenn Git unter den Nutzer-Orten keine versionierte Datei findet", (context) => {
  const repo = probeRepository(context, { "README.md": "Nur ein Text\n" });
  writeFiles(repo, UNVERSIONIERT);
  assert.throws(() => versionierteDateien(repo), /keine versionierte Datei/);
});

test("lintGruppen fasst Befunde je Gruppe ohne Wiederholung zusammen und übergeht Regeln ohne Zuordnung", () => {
  const befunde = [
    { ruleId: "max-params" },
    { ruleId: "complexity" },
    { ruleId: "max-params" },
    { ruleId: "keine/regel" },
    { ruleId: null, fatal: true, message: "Parsing error" },
    { ruleId: "no-restricted-syntax", message: DEMETER },
    { ruleId: NAMENSREGEL, message: "anruf-starten: originateCall ruft nur …" },
  ];
  assert.deepEqual(lintGruppen(befunde), [
    { id: "lint/funktionsgroesse", regeln: ["max-params", "complexity"] },
    { id: "lint/syntax", regeln: ["ohne Regel"] },
    { id: "lint/demeter", regeln: ["no-restricted-syntax"] },
    { id: "lint/wort-anruf-wege", regeln: [NAMENSREGEL] },
  ]);
  assert.equal(lintZweckId({ ruleId: "null", message: "'// eslint-disable' has no effect" }), "lint/inline-abschalten");
  assert.equal(lintZweckId({ ruleId: "no-restricted-syntax" }), undefined);
});

test("der Formatter von Lint in CI und Pre-Commit zeigt nach stylish je vorkommender Gruppe einmal Kopfzeile und Block", async () => {
  const { ergebnis, stylish } = await probeErgebnis(PROBE_CODE);
  const text = await lintFormat([ergebnis], {});
  const bloecke = [
    "Zu max-params (lint/funktionsgroesse):",
    ...zweckBlock("lint/funktionsgroesse"),
    "Zu no-magic-numbers (lint/zahlen):",
    ...zweckBlock("lint/zahlen"),
  ];
  assert.equal(text, `${stylish}${bloecke.join("\n")}\n`);
  assert.deepEqual(lintZweckZeilen(ergebnis.messages), bloecke);
});

test("der Formatter zeigt bei reinen Warnungen und ohne Befund keinen Block", async () => {
  const warnung = await probeErgebnis(NUR_WARNUNG);
  assert.ok(warnung.ergebnis.warningCount > 0);
  assert.equal(await lintFormat([warnung.ergebnis], {}), warnung.stylish);
  const sauber = await probeErgebnis("export const wert = 1;\n");
  assert.equal(await lintFormat([sauber.ergebnis], {}), "");
});

function altlastMitDemeter(anzahl) {
  const eintrag = { reason: "Altlast", date: "2026-01-01", findings: { [`no-restricted-syntax :: ${DEMETER}`]: anzahl } };
  return `${JSON.stringify({ "src/alt.js": eintrag })}\n`;
}

function unterdrueckteKomplexitaet(anzahl) {
  return `${JSON.stringify({ "src/alt.js": { complexity: { count: anzahl } } })}\n`;
}

function gestiegeneZahlNenntGruppe(context, { liste, inhalt, andere, regel, gruppe }) {
  const repo = probeRepository(context, {
    [TOR]: readFileSync(join(REPO_ROOT, TOR), "utf8"),
    [andere]: "{}\n",
    [liste]: inhalt(1),
  });
  symlinkSync(join(REPO_ROOT, "tools"), join(repo, "tools"));
  writeFiles(repo, { [liste]: inhalt(2) });
  runIn(repo, "git", ["add", liste]);
  const lauf = runIn(repo, process.execPath, [TOR]);
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  const zeilen = lauf.stderr.split("\n");
  const kopf = `Zu ${regel} (${gruppe}):`;
  const erwartet = [kopf, ...zweckBlock(gruppe), ...zweckBlock("lint/unterdrueckungen-steigen")];
  assert.deepEqual(zeilen.slice(zeilen.indexOf(kopf), zeilen.indexOf(kopf) + erwartet.length), erwartet, lauf.stderr);
}

test("die Unterdrückungsprüfung nennt nach einem gestiegenen Pin in eslint-legacy-exceptions.json die Gruppe der Regel und danach den Block der Prüfung", (context) => {
  gestiegeneZahlNenntGruppe(context, {
    liste: ALTLAST,
    inhalt: altlastMitDemeter,
    andere: UNTERDRUECKUNGEN,
    regel: "no-restricted-syntax",
    gruppe: "lint/demeter",
  });
});

test("die Unterdrückungsprüfung nennt nach einer gestiegenen Zahl in eslint-suppressions.json die Gruppe der Regel und danach den Block der Prüfung", (context) => {
  gestiegeneZahlNenntGruppe(context, {
    liste: UNTERDRUECKUNGEN,
    inhalt: unterdrueckteKomplexitaet,
    andere: ALTLAST,
    regel: "complexity",
    gruppe: "lint/funktionsgroesse",
  });
});
