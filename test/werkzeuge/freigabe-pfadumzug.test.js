import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { freigabeImProbeRepo } from "./freigabe/hilfen.mjs";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const UMZUG_URL = pathToFileURL(join(REPO_ROOT, "tools/freigabe-pfadumzug.mjs")).href;
const AUFRUF = [
  `import { pfadumzuege } from ${JSON.stringify(UMZUG_URL)};`,
  "const pfade = process.argv.slice(1);",
  'const menge = pfadumzuege("HEAD~1", pfade.map((path) => ({ status: "M", path })));',
  "console.log(JSON.stringify([...menge].sort()));",
].join("\n");
const EXIT_OK = 0;
const EXIT_ROT = 1;
const JSON_EINZUG = 2;
const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const TESTIMPORTE = "tools/basis/test-importe.json";
const ABHAENGIGKEITEN = ".dependency-cruiser-known-violations.json";
const KNIP = "tools/basis/knip.json";
const FREIGABE_IN_PROBE = "tools/freigabe-pruefung.mjs";
const ALLE_LISTEN = [UNTERDRUECKUNGEN, TESTIMPORTE, ABHAENGIGKEITEN, KNIP];
const ALT = "src/zahl.js";
const NEU = "src/zahl.ts";
const REST = "src/rest.js";
const ZAHL_VORHER = 3;
const ZAHL_GESTRICHEN = 2;
const ZAHL_ERHOEHT = 4;

function json(wert) {
  return `${JSON.stringify(wert, null, JSON_EINZUG)}\n`;
}

function quelle(typ) {
  return [
    `export function zahl(wert${typ}) {`,
    "  const doppelt = wert * 2;",
    "  const summe = doppelt + wert;",
    "  if (summe > 100) return 100;",
    "  if (summe < 0) return 0;",
    "  return summe;",
    "}",
    "",
    `export function menge(liste${typ}) {`,
    "  return liste.map((eintrag) => zahl(eintrag));",
    "}",
    "",
  ].join("\n");
}

function unterdrueckungen(
  zahlPfad,
  { count = ZAHL_VORHER, regel = "complexity", zusatz = {} } = {},
) {
  return json({
    [zahlPfad]: { [regel]: { count } },
    [REST]: { "max-lines": { count: 1 } },
    ...zusatz,
  });
}

function importEintrag(von, ziel) {
  return {
    from: von,
    to: ziel,
    rule: { name: "tests-nur-ueber-eingaenge" },
    unresolvedTo: `../../${ziel}`,
  };
}

function testimporte(zahlPfad) {
  return json([
    importEintrag("test/anrufe/zahl.test.js", zahlPfad),
    importEintrag("test/anrufe/rest.test.js", REST),
  ]);
}

function weitereListen(zahlPfad) {
  return {
    [ABHAENGIGKEITEN]: json([importEintrag("src/app.js", zahlPfad)]),
    [KNIP]: json({ befunde: [`exports ${zahlPfad} zahl`] }),
  };
}

const BASIS = {
  [ALT]: quelle(""),
  [REST]: "export const REST = 1;\n",
  [UNTERDRUECKUNGEN]: unterdrueckungen(ALT),
  [TESTIMPORTE]: testimporte(ALT),
  ...weitereListen(ALT),
};

const VOLLER_UMZUG = {
  [UNTERDRUECKUNGEN]: unterdrueckungen(NEU),
  [TESTIMPORTE]: testimporte(NEU),
};

function aenderung(verzeichnis, { umbenennen = [[ALT, NEU]], dateien }) {
  for (const [alt, neu] of umbenennen) {
    runIn(verzeichnis, "git", ["mv", alt, neu]);
    writeFiles(verzeichnis, { [neu]: quelle(": number") });
  }
  const eintraege = Object.entries(dateien);
  for (const [pfad] of eintraege.filter(([, text]) => text === null)) {
    rmSync(join(verzeichnis, pfad));
  }
  writeFiles(verzeichnis, Object.fromEntries(eintraege.filter(([, text]) => text !== null)));
  commitAll(verzeichnis, "Umbau");
}

function umzuege(context, aenderungen) {
  const verzeichnis = probeRepository(context, BASIS);
  aenderung(verzeichnis, aenderungen);
  const lauf = runIn(verzeichnis, process.execPath, [
    "--input-type=module",
    "-e",
    AUFRUF,
    ...ALLE_LISTEN,
  ]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  return JSON.parse(lauf.stdout);
}

test("pfadumzug: beide Listen ziehen nur mit der Git-Umbenennung um", (context) => {
  assert.deepEqual(umzuege(context, { dateien: VOLLER_UMZUG }), [UNTERDRUECKUNGEN, TESTIMPORTE]);
});

test("pfadumzug: nur eslint-suppressions.json zieht um", (context) => {
  const dateien = { [UNTERDRUECKUNGEN]: unterdrueckungen(NEU) };
  assert.deepEqual(umzuege(context, { dateien }), [UNTERDRUECKUNGEN]);
});

test("pfadumzug: nur tools/basis/test-importe.json zieht um", (context) => {
  const dateien = { [TESTIMPORTE]: testimporte(NEU) };
  assert.deepEqual(umzuege(context, { dateien }), [TESTIMPORTE]);
});

test("pfadumzug: eine geänderte Zahl beim Umzug ist kein Pfadumzug", (context) => {
  const gesenkt = { [UNTERDRUECKUNGEN]: unterdrueckungen(NEU, { count: ZAHL_GESTRICHEN }) };
  const erhoeht = { [UNTERDRUECKUNGEN]: unterdrueckungen(NEU, { count: ZAHL_ERHOEHT }) };
  assert.deepEqual(
    [umzuege(context, { dateien: gesenkt }), umzuege(context, { dateien: erhoeht })],
    [[], []],
  );
});

test("pfadumzug: eine geänderte Regel oder ein neuer Eintrag beim Umzug ist kein Pfadumzug", (context) => {
  const regel = { [UNTERDRUECKUNGEN]: unterdrueckungen(NEU, { regel: "max-depth" }) };
  const zusatz = { "src/neu.js": { complexity: { count: 1 } } };
  const neuerEintrag = { [UNTERDRUECKUNGEN]: unterdrueckungen(NEU, { zusatz }) };
  assert.deepEqual(
    [umzuege(context, { dateien: regel }), umzuege(context, { dateien: neuerEintrag })],
    [[], []],
  );
});

test("pfadumzug: ein gestrichener Eintrag beim Umzug ist kein Pfadumzug", (context) => {
  const dateien = {
    [UNTERDRUECKUNGEN]: json({ [NEU]: { complexity: { count: ZAHL_VORHER } } }),
    [TESTIMPORTE]: json([importEintrag("test/anrufe/zahl.test.js", NEU)]),
  };
  assert.deepEqual(umzuege(context, { dateien }), []);
});

test("pfadumzug: bleibt die alte Datei bestehen, ist der Listenumzug kein Pfadumzug", (context) => {
  const dateien = { ...VOLLER_UMZUG, [NEU]: quelle(": number") };
  assert.deepEqual(umzuege(context, { umbenennen: [], dateien }), []);
});

test("pfadumzug: Löschen und unähnliches Neuanlegen ist keine Umbenennung", (context) => {
  const dateien = { ...VOLLER_UMZUG, [ALT]: null, [NEU]: "export type Andere = string;\n" };
  assert.deepEqual(umzuege(context, { umbenennen: [], dateien }), []);
});

test("pfadumzug: ein Pfad außerhalb des Umbenennungspaars zieht nicht um", (context) => {
  const fremd = {
    [UNTERDRUECKUNGEN]: json({
      [ALT]: { complexity: { count: ZAHL_VORHER } },
      "src/rest.ts": { "max-lines": { count: 1 } },
    }),
  };
  const erfunden = { [TESTIMPORTE]: testimporte("src/erfunden.ts") };
  assert.deepEqual(
    [umzuege(context, { dateien: fremd }), umzuege(context, { dateien: erfunden })],
    [[], []],
  );
});

test("pfadumzug: ein anderer Zielname als die Umbenennung ist kein Pfadumzug", (context) => {
  const umbenennen = [[ALT, "src/menge.ts"]];
  assert.deepEqual(umzuege(context, { umbenennen, dateien: VOLLER_UMZUG }), []);
});

test("pfadumzug: andere Bestandslisten bleiben auch beim reinen Umzug draußen", (context) => {
  const dateien = { ...VOLLER_UMZUG, ...weitereListen(NEU) };
  assert.deepEqual(umzuege(context, { dateien }), [UNTERDRUECKUNGEN, TESTIMPORTE]);
});

test("pfadumzug: eine nur umsortierte Liste neben einer Umbenennung ist kein Pfadumzug", (context) => {
  const umsortiert = json({
    [REST]: { "max-lines": { count: 1 } },
    [ALT]: { complexity: { count: ZAHL_VORHER } },
  });
  assert.deepEqual(umzuege(context, { dateien: { [UNTERDRUECKUNGEN]: umsortiert } }), []);
});

test("pfadumzug: eine Liste ohne gültiges JSON ist kein Pfadumzug", (context) => {
  const kaputt = { ...VOLLER_UMZUG, [UNTERDRUECKUNGEN]: "{\n" };
  assert.deepEqual(umzuege(context, { dateien: kaputt }), [TESTIMPORTE]);
});

async function freigabePruefung(context, { basis = {}, aenderungen }) {
  const verzeichnis = probeRepository(context, {
    ".github/CODEOWNERS": "/tools/ @Antonio20045\neslint-suppressions*.json @Antonio20045\n",
    ...BASIS,
    ...basis,
  });
  const basisStand = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  aenderung(verzeichnis, aenderungen);
  return freigabeImProbeRepo(context, { verzeichnis, basis: basisStand });
}

function grundZeile(stdout) {
  return stdout.split("\n").find((zeile) => zeile.includes("Bestehende Prüfungsdateien")) ?? "";
}

test("freigabe-pruefung: ein reiner Pfadumzug mit Umbenennung ist art:code ohne Freigabe", async (context) => {
  const lauf = await freigabePruefung(context, { aenderungen: { dateien: VOLLER_UMZUG } });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Art art:code\./);
  assert.equal(grundZeile(lauf.stdout), "");
});

test("freigabe-pruefung: eine beim Umzug erhöhte Zahl wartet als art:pruefung", async (context) => {
  const dateien = {
    ...VOLLER_UMZUG,
    [UNTERDRUECKUNGEN]: unterdrueckungen(NEU, { count: ZAHL_ERHOEHT }),
  };
  const lauf = await freigabePruefung(context, { aenderungen: { dateien } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Art art:pruefung\./);
  assert.match(grundZeile(lauf.stdout), /eslint-suppressions\.json/);
  assert.doesNotMatch(grundZeile(lauf.stdout), /test-importe\.json/);
});

test("freigabe-pruefung: eine geänderte Freigabe-Prüfung neben dem Umzug bleibt art:pruefung", async (context) => {
  const lauf = await freigabePruefung(context, {
    basis: { [FREIGABE_IN_PROBE]: "export const STRENG = true;\n" },
    aenderungen: {
      dateien: { ...VOLLER_UMZUG, [FREIGABE_IN_PROBE]: "export const STRENG = false;\n" },
    },
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Art art:pruefung\./);
  assert.match(grundZeile(lauf.stdout), /tools\/freigabe-pruefung\.mjs/);
  assert.doesNotMatch(grundZeile(lauf.stdout), /eslint-suppressions\.json|test-importe\.json/);
});
