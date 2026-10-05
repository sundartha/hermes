import assert from "node:assert/strict";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { bestandFriertGenauEin, bestandsDatei } from "./hermes-regeln-probe.js";
import { probeDirectory } from "./probe-repo.js";
import { befundZeilen, konfigurationMitTestregeln } from "./testregeln-probe.js";

const REGEL = "hermes-tests/fester-importpfad";
const BESTAND = "tools/basis/fester-importpfad.json";
const DATEI = "test/anrufe/probe.test.js";
const KOPF = ["const MARKE = Date.now();", 'const PFAD = "../../src/config.js";'];
const MIT_PLATZHALTER = "await import(`../../src/store/json.js?neu=${MARKE}`);";

function befunde(verzeichnis, zeilen) {
  const probe = { verzeichnis, datei: DATEI, regel: REGEL, bestand: BESTAND };
  return befundZeilen(probe, [...KOPF, ...zeilen]);
}

test("fester-importpfad: import() mit Platzhalter, Variable oder Verkettung wird gemeldet", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const zeilen = [MIT_PLATZHALTER, "await import(PFAD);", 'await import("../../src/" + "app.js");'];
  assert.deepEqual(befunde(verzeichnis, zeilen), zeilen);
});

test("fester-importpfad: import() mit festem Text bleibt frei, auch mit Cache-Brecher", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const zeilen = [
    'await import("../../src/config.js");',
    'await import("../../src/config.js?frisch");',
    "await import(`../../src/store/json.js?fest`);",
    'import { config } from "../../src/config.js";',
  ];
  assert.deepEqual(befunde(verzeichnis, zeilen), []);
});

test("fester-importpfad: ein eingefrorener Import ist frei, derselbe ein zweites Mal nicht", (context) => {
  const ausdruck = MIT_PLATZHALTER.slice("await ".length, -1);
  const verzeichnis = probeDirectory(context, {
    [BESTAND]: bestandsDatei([befundSchluessel(DATEI, ausdruck)]),
  });
  assert.deepEqual(befunde(verzeichnis, [MIT_PLATZHALTER]), []);
  assert.deepEqual(befunde(verzeichnis, [MIT_PLATZHALTER, MIT_PLATZHALTER]), [MIT_PLATZHALTER]);
  assert.deepEqual(befunde(verzeichnis, ["await import(PFAD);"]), ["await import(PFAD);"]);
});

test("fester-importpfad: die Basislinie aus basis-vergleich friert genau den Bestand ein", (context) => {
  bestandFriertGenauEin(context, {
    werkzeug: "fester-importpfad",
    konfiguration: { files: ["test/**"], rules: { [REGEL]: ["error", { bestand: BESTAND }] } },
    vorher: {
      "eslint.config.mjs": konfigurationMitTestregeln(REGEL, BESTAND),
      "test/alt.test.js": `${KOPF.join("\n")}\n${MIT_PLATZHALTER}\n`,
    },
    neu: { "test/neu.test.js": `${KOPF.join("\n")}\nawait import(PFAD);\n` },
    ort: "test/neu.test.js:3",
  });
});
