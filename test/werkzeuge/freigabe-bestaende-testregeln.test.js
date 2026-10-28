import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG_URL = pathToFileURL(join(REPO_ROOT, "tools/freigabe-strenger.mjs")).href;
const AUFRUF = [
  `import { stricterCases } from ${JSON.stringify(WERKZEUG_URL)};`,
  "const [, pfad] = process.argv;",
  'const faelle = stricterCases("HEAD~1", [{ status: "M", path: pfad }]);',
  "console.log(JSON.stringify(faelle ?? null));",
].join("\n");
const ALTBEFUNDE_GESTRICHEN = "(a) Altbefunde gestrichen";
const SELBSTPRUEFUNG = "tools/basis/selbstpruefung.json";
const FESTER_IMPORTPFAD = "tools/basis/fester-importpfad.json";
const TESTIMPORTE = "tools/basis/test-importe.json";

function befundListe(...befunde) {
  return `${JSON.stringify({ befunde })}\n`;
}

function testimporte(...ziele) {
  const eintraege = ziele.map((ziel) => ({
    from: "test/anrufe/alt.test.js",
    to: ziel,
    rule: { name: "tests-nur-ueber-eingaenge" },
  }));
  return `${JSON.stringify(eintraege)}\n`;
}

function einstufung(context, pfad, { vorher, nachher }) {
  const verzeichnis = probeRepository(context, { [pfad]: vorher });
  writeFiles(verzeichnis, { [pfad]: nachher });
  commitAll(verzeichnis, "geaendert");
  const lauf = runIn(verzeichnis, process.execPath, ["--input-type=module", "-e", AUFRUF, pfad]);
  assert.equal(lauf.status, 0, lauf.stderr);
  return JSON.parse(lauf.stdout);
}

test("freigabe-strenger: aus tools/basis/selbstpruefung.json nur streichen ist strenger", (context) => {
  const faelle = einstufung(context, SELBSTPRUEFUNG, {
    vorher: befundListe("a", "b"),
    nachher: befundListe("b"),
  });
  assert.deepEqual(faelle, [{ path: SELBSTPRUEFUNG, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: aus tools/basis/fester-importpfad.json nur streichen ist strenger", (context) => {
  const faelle = einstufung(context, FESTER_IMPORTPFAD, {
    vorher: befundListe("a", "b"),
    nachher: befundListe("a"),
  });
  assert.deepEqual(faelle, [{ path: FESTER_IMPORTPFAD, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: aus tools/basis/test-importe.json nur streichen ist strenger", (context) => {
  const faelle = einstufung(context, TESTIMPORTE, {
    vorher: testimporte("src/store/defaults.js", "src/store/state-ops.js"),
    nachher: testimporte("src/store/state-ops.js"),
  });
  assert.deepEqual(faelle, [{ path: TESTIMPORTE, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: ein neuer Eintrag in einem Bestand der Testregeln ist nicht strenger", (context) => {
  const befunde = einstufung(context, SELBSTPRUEFUNG, {
    vorher: befundListe("a"),
    nachher: befundListe("a", "b"),
  });
  const importe = einstufung(context, TESTIMPORTE, {
    vorher: testimporte("src/store/defaults.js"),
    nachher: testimporte("src/store/defaults.js", "src/store/pg.js"),
  });
  assert.deepEqual([befunde, importe], [null, null]);
});

const UNTERDRUECKUNGEN = "eslint-suppressions.json";

function unterdrueckungen(zahlen) {
  const eintraege = Object.entries(zahlen).map(([datei, count]) => [datei, { complexity: { count } }]);
  return `${JSON.stringify(Object.fromEntries(eintraege))}\n`;
}

test("freigabe-strenger: eine gesenkte Zahl in eslint-suppressions.json ist strenger", (context) => {
  const faelle = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungen({ "src/a.js": 3, "src/b.js": 1 }),
    nachher: unterdrueckungen({ "src/a.js": 2, "src/b.js": 1 }),
  });
  assert.deepEqual(faelle, [{ path: UNTERDRUECKUNGEN, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: ein gestrichener Eintrag in eslint-suppressions.json ist strenger", (context) => {
  const faelle = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungen({ "src/a.js": 3, "src/b.js": 1 }),
    nachher: unterdrueckungen({ "src/a.js": 3 }),
  });
  assert.deepEqual(faelle, [{ path: UNTERDRUECKUNGEN, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: eine erhöhte oder neue Zahl in eslint-suppressions.json ist nicht strenger", (context) => {
  const erhoeht = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungen({ "src/a.js": 3, "src/b.js": 1 }),
    nachher: unterdrueckungen({ "src/a.js": 2, "src/b.js": 2 }),
  });
  const neu = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungen({ "src/a.js": 3 }),
    nachher: unterdrueckungen({ "src/a.js": 2, "src/c.js": 1 }),
  });
  assert.deepEqual([erhoeht, neu], [null, null]);
});

function unterdrueckungenRoh(inhalt) {
  return `${JSON.stringify(inhalt)}\n`;
}

test("freigabe-strenger: eine neue Datei oder Regel ohne Zahl in eslint-suppressions.json ist nicht strenger", (context) => {
  const alt = { "src/a.js": { complexity: { count: 3 } } };
  const gesenkt = { "src/a.js": { complexity: { count: 2 } } };
  const neueDatei = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungenRoh(alt),
    nachher: unterdrueckungenRoh({ ...alt, "src/x.js": {} }),
  });
  const neueDateiBeiSenkung = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungenRoh(alt),
    nachher: unterdrueckungenRoh({ ...gesenkt, "src/x.js": {} }),
  });
  const neueRegel = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungenRoh(alt),
    nachher: unterdrueckungenRoh({ "src/a.js": { ...alt["src/a.js"], "no-x": {} } }),
  });
  assert.deepEqual([neueDatei, neueDateiBeiSenkung, neueRegel], [null, null, null]);
});

const KARTE = "tools/bausteine.json";
const KARTE_STRENGER = "(d) Bausteinkarte nur strenger";
const BAUSTEINE = [
  { baustein: "start", zweck: "Baut zusammen.", quellen: ["src/app.js"], eingaenge: [], nutzt: [], importiertJedeDatei: true },
  { baustein: "werk", zweck: "Hilfen.", quellen: ["src/werk/"], eingaenge: "alle", nutzt: [] },
  { baustein: "kasse", zweck: "Kasse.", quellen: ["src/kasse/"], eingaenge: ["src/kasse/a.js", "src/kasse/b.js"], nutzt: [] },
  { baustein: "fach", zweck: "Fach.", quellen: ["src/fach/"], eingaenge: ["src/fach/tor.js"], nutzt: ["kasse", "werk"] },
];
const ALTLAST = [
  { von: "werk", nach: "fach" },
  { von: "werk", nach: "kasse" },
];

function karte(aenderung = {}) {
  return { schichten: [["werk"], ["kasse", "fach"], ["start"]], bausteine: BAUSTEINE, altlast: ALTLAST, ...aenderung };
}

function mitBaustein(name, felder) {
  return karte({ bausteine: BAUSTEINE.map((eintrag) => (eintrag.baustein === name ? { ...eintrag, ...felder } : eintrag)) });
}

function karteEingestuft(context, nachher, vorher = karte()) {
  return einstufung(context, KARTE, { vorher: `${JSON.stringify(vorher, null, 2)}\n`, nachher: `${JSON.stringify(nachher)}\n` });
}

test("freigabe-strenger: Streichen in tools/bausteine.json (Eingang, Altlast-Paar, Nutzung, alle Eingänge, freies Importieren) ist strenger", (context) => {
  const faelle = {
    eingang: mitBaustein("kasse", { eingaenge: ["src/kasse/a.js"] }),
    altlast: karte({ altlast: ALTLAST.slice(1) }),
    nutzung: mitBaustein("fach", { nutzt: [] }),
    nutzungMitteGestrichen: mitBaustein("fach", { nutzt: ["werk"] }),
    alleEingaenge: mitBaustein("werk", { eingaenge: ["src/werk/zeit.js"] }),
    freiesImportieren: mitBaustein("start", { importiertJedeDatei: undefined }),
  };
  for (const [name, nachher] of Object.entries(faelle)) {
    assert.deepEqual(karteEingestuft(context, nachher), [{ path: KARTE, fall: KARTE_STRENGER }], name);
  }
});

test("freigabe-strenger: Ergänzen, Umordnen oder Umschreiben in tools/bausteine.json ist nicht strenger", (context) => {
  const faelle = {
    eingang: mitBaustein("kasse", { eingaenge: ["src/kasse/a.js", "src/kasse/b.js", "src/kasse/c.js"] }),
    altlast: karte({ altlast: [...ALTLAST, { von: "kasse", nach: "fach" }] }),
    nutzung: mitBaustein("kasse", { nutzt: ["fach"] }),
    eingangUmgeordnet: mitBaustein("kasse", { eingaenge: ["src/kasse/b.js", "src/kasse/a.js"] }),
    eingangDoppelt: mitBaustein("kasse", { eingaenge: ["src/kasse/a.js", "src/kasse/a.js", "src/kasse/b.js"] }),
    nutzungUmgeordnet: mitBaustein("fach", { nutzt: ["werk", "kasse"] }),
    nutzungDoppelt: mitBaustein("fach", { nutzt: ["kasse", "kasse", "werk"] }),
    altlastUmgeordnet: karte({ altlast: [...ALTLAST].reverse() }),
    altlastDoppelt: karte({ altlast: [ALTLAST[0], ALTLAST[0], ALTLAST[1]] }),
    listeZuAlle: mitBaustein("kasse", { eingaenge: "alle" }),
    freiesImportierenNeu: mitBaustein("fach", { importiertJedeDatei: true }),
    quelleGestrichen: mitBaustein("fach", { quellen: [] }),
    schichten: karte({ schichten: [["werk"], ["kasse"], ["fach"], ["start"]] }),
    zweck: mitBaustein("fach", { zweck: "Anders." }),
    bausteinGestrichen: karte({ bausteine: BAUSTEINE.slice(0, -1) }),
    neuesFeld: mitBaustein("fach", { ausnahmen: [] }),
    schreibweise: karte(),
  };
  for (const [name, nachher] of Object.entries(faelle)) {
    assert.equal(karteEingestuft(context, nachher), null, name);
  }
  const mitZusatz = (wert, felder) => karte({ zusatz: wert, ...felder });
  assert.equal(karteEingestuft(context, mitZusatz(2, { altlast: ALTLAST.slice(1) }), mitZusatz(1)), null, "zusatzSchluessel");
});
