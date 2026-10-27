import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEPENDENCY_TOOL,
  REPO_ROOT,
  commitAll,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const KONFIGURATION = ".dependency-cruiser.cjs";
const ALTVERSTOESSE = ".dependency-cruiser-known-violations.json";
const SELBSTPRUEFUNG = "tools/basis/selbstpruefung.json";
const FESTER_IMPORTPFAD = "tools/basis/fester-importpfad.json";
const ALT = "test/anrufe/alt.test.js|0123456789abcdef";
const ZWEITER = "test/anrufe/alt.test.js|fedcba9876543210";
const NEU = "test/anrufe/neu.test.js|00112233aabbccdd";
const EXIT_OK = 0;
const EXIT_FINDING = 1;

const GRUNDSTAND = {
  [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
  "src/app.js": "export const app = true;\n",
};

function bestand(...eintraege) {
  return `${JSON.stringify({ befunde: eintraege })}\n`;
}

function nachAenderung(context, { vorher, nachher }) {
  const verzeichnis = probeRepository(context, { ...GRUNDSTAND, ...vorher });
  writeFiles(verzeichnis, nachher);
  commitAll(verzeichnis, "geaendert");
  return runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
}

test("bestaende: ein neuer Eintrag in tools/basis/selbstpruefung.json ist rot", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [SELBSTPRUEFUNG]: bestand(ALT) },
    nachher: { [SELBSTPRUEFUNG]: bestand(ALT, NEU) },
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(
    ergebnis.stderr,
    /tools\/basis\/selbstpruefung\.json darf nur kürzer werden, neu oder öfter eingefroren ist: test\/anrufe\/neu\.test\.js\|00112233aabbccdd/,
  );
});

test("bestaende: derselbe Eintrag ein zweites Mal in tools/basis/fester-importpfad.json ist rot", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [FESTER_IMPORTPFAD]: bestand(ALT) },
    nachher: { [FESTER_IMPORTPFAD]: bestand(ALT, ALT) },
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /tools\/basis\/fester-importpfad\.json darf nur kürzer werden/);
});

test("bestaende: gekürzte Bestände sind grün", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: {
      [SELBSTPRUEFUNG]: bestand(ALT, ZWEITER),
      [FESTER_IMPORTPFAD]: bestand(ALT, ZWEITER),
    },
    nachher: { [SELBSTPRUEFUNG]: bestand(ZWEITER), [FESTER_IMPORTPFAD]: bestand() },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^0 neue Dateien unter test\/ seit der Basis/m);
});

test("bestaende: ein Bestand, den es auf der Basis noch nicht gibt, gilt als neu angelegt", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: {},
    nachher: { [SELBSTPRUEFUNG]: bestand(ALT, NEU) },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^0 neue Dateien unter test\/ seit der Basis/m);
});

test("bestaende: eine Altverstoß-Liste und ein Bestand, die es auf der Basis noch nicht gibt, gelten beide als neu angelegt", (context) => {
  const altverstoss = {
    type: "dependency",
    from: "src/a",
    to: "src/b",
    rule: { severity: "error", name: "keine-ordnerzyklen" },
  };
  const ergebnis = nachAenderung(context, {
    vorher: {},
    nachher: {
      [ALTVERSTOESSE]: JSON.stringify([altverstoss]),
      [SELBSTPRUEFUNG]: bestand(ALT, NEU),
    },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(
    ergebnis.stdout,
    /known-violations\.json;.*; die Basis hat noch keine eingefrorene Liste$/m,
  );
  assert.match(ergebnis.stdout, /^0 neue Dateien unter test\/ seit der Basis/m);
});

const QUELLTEXT = "tools/basis/quelltext-als-text.json";
const ALTE_DATEI = "test/anrufe/alt.test.js";
const TEST_INHALT = 'import { test } from "node:test";\ntest("alt", () => {});\n';

function umbenanntMitUmzug(context, neuerInhalt) {
  const verzeichnis = probeRepository(context, {
    ...GRUNDSTAND,
    "tools/bereiche.json": readFileSync(join(REPO_ROOT, "tools/bereiche.json"), "utf8"),
    [ALTE_DATEI]: TEST_INHALT,
    [SELBSTPRUEFUNG]: bestand(ALT),
  });
  rmSync(join(verzeichnis, ALTE_DATEI));
  writeFiles(verzeichnis, {
    "test/anrufe/alt.test.ts": neuerInhalt,
    [SELBSTPRUEFUNG]: bestand(ALT.replace("alt.test.js", "alt.test.ts")),
  });
  commitAll(verzeichnis, "umbenannt");
  return runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
}

test("bestaende: ein Eintrag, der mit einer Umbenennung nur mit Typen wandert, ist grün", (context) => {
  const ergebnis = umbenanntMitUmzug(context, TEST_INHALT.replace("() => {}", "(): void => {}"));
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
});

test("bestaende: ein Eintrag, der mit einer Umbenennung mit geändertem Code wandert, ist rot", (context) => {
  const ergebnis = umbenanntMitUmzug(context, TEST_INHALT.replace('"alt"', '"neu"'));
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /selbstpruefung\.json darf nur kürzer werden, .*alt\.test\.ts/);
});

test("bestaende: ein neuer Eintrag in tools/basis/quelltext-als-text.json ist rot", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [QUELLTEXT]: bestand(ALT) },
    nachher: { [QUELLTEXT]: bestand(ALT, NEU) },
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /tools\/basis\/quelltext-als-text\.json darf nur kürzer werden/);
});

const LISTE = "tools/basis/sammeldatei-exporte.json";
const JSON_SPEICHER = "src/store/json.js";

function liste(...eintraege) {
  return `${JSON.stringify(eintraege.map((name) => `${JSON_SPEICHER}#${name}`))}\n`;
}

function speicher(...namen) {
  return namen.map((name) => `export function ${name}() {}\n`).join("");
}

function istRot(ergebnis, muster) {
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, muster);
}

const EINGEFROREN = { [LISTE]: liste("load", "save"), [JSON_SPEICHER]: speicher("load", "save") };

test("sammeldateien: ein neuer Export in src/store/json.js ist rot und nennt den Ort für Speicherfunktionen", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: EINGEFROREN,
    nachher: { [JSON_SPEICHER]: speicher("load", "save", "markiere") },
  });
  istRot(ergebnis, /src\/store\/json\.js: neuer Export „markiere“/);
  assert.match(ergebnis.stderr, /src\/store\/zustand\/anbindung\.js/);
});

test("sammeldateien: eine neue Speicherfunktion unter src/store/zustand/ ist grün", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: EINGEFROREN,
    nachher: {
      "src/store/zustand/markierung.js": "export function markiere(zustand) {\n  return { ergebnis: zustand, geaendert: true };\n}\n",
    },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^2 Exporte von 1 Sammeldateien, eingefroren in tools\/basis\/sammeldatei-exporte\.json; 0 davon/m);
});

test("sammeldateien: ein entfernter Export, der noch in der Liste steht, kommt nicht zurück", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [LISTE]: liste("load", "save"), [JSON_SPEICHER]: speicher("load") },
    nachher: { [JSON_SPEICHER]: speicher("load", "save") },
  });
  istRot(ergebnis, /src\/store\/json\.js: neuer Export „save“/);
});

test("sammeldateien: die Liste darf nur kürzer werden", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: EINGEFROREN,
    nachher: { [LISTE]: liste("load", "markiere", "save"), [JSON_SPEICHER]: speicher("load", "markiere", "save") },
  });
  istRot(ergebnis, /tools\/basis\/sammeldatei-exporte\.json darf nur kürzer werden, neu eingefroren ist: src\/store\/json\.js#markiere/);
});

test("sammeldateien: ein entfernter Export mit gekürzter Liste ist grün", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: EINGEFROREN,
    nachher: { [LISTE]: liste("load"), [JSON_SPEICHER]: speicher("load") },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
});

test("sammeldateien: ein entfernter Export ohne gekürzte Liste ist grün und wird zum Streichen genannt", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: EINGEFROREN,
    nachher: { [JSON_SPEICHER]: speicher("load") },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /; 1 davon gibt es nicht mehr, sie können gestrichen werden$/m);
});

test("sammeldateien: ein gestrichener Name, den die Datei noch exportiert, ist rot", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: EINGEFROREN,
    nachher: { [LISTE]: liste("load") },
  });
  istRot(ergebnis, /src\/store\/json\.js: neuer Export „save“/);
});

test("sammeldateien: export * aus einer anderen Datei ist ein neuer Export", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { ...EINGEFROREN, "src/store/zustand/markierung.js": "export const markiere = 1;\n" },
    nachher: { [JSON_SPEICHER]: `${speicher("load", "save")}export * from "./zustand/markierung.js";\n` },
  });
  istRot(ergebnis, /neuer Export „\*:\.\/zustand\/markierung\.js“/);
});

test("sammeldateien: nach der Umbenennung in .ts zählt dieselbe Liste", (context) => {
  const verzeichnis = probeRepository(context, { ...GRUNDSTAND, ...EINGEFROREN });
  runIn(verzeichnis, "git", ["mv", JSON_SPEICHER, "src/store/json.ts"]);
  writeFiles(verzeichnis, { "src/store/json.ts": speicher("load", "save", "markiere") });
  commitAll(verzeichnis, "umbenannt");
  const ergebnis = runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
  istRot(ergebnis, /src\/store\/json\.ts: neuer Export „markiere“/);
});

test("sammeldateien: ohne eingefrorene Liste gibt es keinen Befund", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [JSON_SPEICHER]: speicher("load") },
    nachher: { [JSON_SPEICHER]: speicher("load", "markiere") },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.doesNotMatch(ergebnis.stdout, /Sammeldateien, eingefroren/);
});

const STATE_OPS = "src/store/state-ops.js";
const MIT_STATE_OPS = `${JSON.stringify([`${JSON_SPEICHER}#load`, `${JSON_SPEICHER}#save`, `${STATE_OPS}#anlegen`])}\n`;
const NUR_STATE_OPS = `${JSON.stringify([`${STATE_OPS}#anlegen`])}\n`;
const JSON_TS = "src/store/json.ts";

function nachLoeschung(context, { vorher, geloescht, nachher = {}, konfiguration = [] }) {
  const verzeichnis = probeRepository(context, { ...GRUNDSTAND, ...vorher });
  for (const pfad of geloescht) rmSync(join(verzeichnis, pfad));
  for (const [schluessel, wert] of konfiguration) runIn(verzeichnis, "git", ["config", schluessel, wert]);
  writeFiles(verzeichnis, nachher);
  commitAll(verzeichnis, "geloescht");
  return runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
}

test("sammeldateien: alle Einträge einer Datei gestrichen, die noch exportiert, ist rot", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: {
      [LISTE]: MIT_STATE_OPS,
      [JSON_SPEICHER]: speicher("load", "save"),
      [STATE_OPS]: speicher("anlegen"),
    },
    nachher: { [LISTE]: NUR_STATE_OPS },
  });
  istRot(ergebnis, /src\/store\/json\.js: neuer Export „load“/);
  assert.match(ergebnis.stderr, /src\/store\/json\.js: neuer Export „save“/);
  assert.doesNotMatch(ergebnis.stderr, /state-ops\.js: neuer Export/);
});

test("sammeldateien: eine ganz gelöschte Liste bei Dateien, die noch exportieren, ist rot", (context) => {
  const ergebnis = nachLoeschung(context, { vorher: EINGEFROREN, geloescht: [LISTE] });
  istRot(ergebnis, /src\/store\/json\.js: neuer Export „load“/);
});

test("sammeldateien: eine entfernte Sammeldatei samt ihren Einträgen ist grün", (context) => {
  const ergebnis = nachLoeschung(context, {
    vorher: EINGEFROREN,
    geloescht: [JSON_SPEICHER],
    nachher: { [LISTE]: liste() },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
});

test("sammeldateien: ein neuer destrukturierter Export ist rot und nennt jeden gebundenen Namen", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: EINGEFROREN,
    nachher: { [JSON_SPEICHER]: `${speicher("load", "save")}export const { markiere, zaehle } = quelle;\n` },
  });
  istRot(ergebnis, /src\/store\/json\.js: neuer Export „markiere“/);
  assert.match(ergebnis.stderr, /src\/store\/json\.js: neuer Export „zaehle“/);
  assert.doesNotMatch(ergebnis.stderr, /neuer Export „\{/);
});

function verschobeneSammeldatei(context, { ziel, text, von = JSON_SPEICHER, konfiguration = [] }) {
  return nachLoeschung(context, {
    vorher: { [LISTE]: EINGEFROREN[LISTE], [von]: speicher("load", "save") },
    geloescht: [von],
    nachher: { "src/app.js": "export const app = false;\n", [ziel]: text },
    konfiguration,
  });
}

test("sammeldateien: eine auf einen anderen Namen umbenannte Sammeldatei ist rot, auch ohne neuen Export", (context) => {
  const ergebnis = verschobeneSammeldatei(context, { ziel: "src/store/json-speicher.js", text: speicher("load", "save") });
  istRot(ergebnis, /src\/store\/json\.js: Die Sammeldatei wird nach src\/store\/json-speicher\.js umbenannt/);
  assert.match(ergebnis.stderr, /nicht umbenannt, sondern aufgelöst: Datei und ihre Einträge in tools\/basis\/sammeldatei-exporte\.json zusammen entfernen/);
  assert.match(ergebnis.stderr, /die Funktionen kommen an ihren Ort\. Eine neue Speicherfunktion kommt als reine Funktion/);
});

test("sammeldateien: eine in einen anderen Ordner verschobene Sammeldatei mit neuem Export ist rot", (context) => {
  const ergebnis = verschobeneSammeldatei(context, { ziel: "src/store/alt/json.js", text: speicher("load", "save", "markiere") });
  istRot(ergebnis, /src\/store\/json\.js: Die Sammeldatei wird nach src\/store\/alt\/json\.js umbenannt/);
});

test("sammeldateien: die Umbenennung in .ts am selben Ort ohne neuen Export ist grün", (context) => {
  const ergebnis = verschobeneSammeldatei(context, { ziel: JSON_TS, text: speicher("load", "save") });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
});

const UMBENANNT_NACH = /src\/store\/json\.js: Die Sammeldatei wird nach src\/store\/json-speicher\.ts umbenannt/;

test("sammeldateien: eine als .ts vorhandene Sammeldatei, die auf einen anderen Namen umbenannt wird, ist rot", (context) => {
  const ergebnis = verschobeneSammeldatei(context, { ziel: "src/store/json-speicher.ts", text: speicher("load", "save"), von: JSON_TS });
  istRot(ergebnis, UMBENANNT_NACH);
});

test("sammeldateien: eine als .ts vorhandene Sammeldatei, die mit neuem Export umbenannt wird, ist rot", (context) => {
  const ergebnis = verschobeneSammeldatei(context, { ziel: "src/store/json-speicher.ts", text: speicher("load", "save", "markiere"), von: JSON_TS });
  istRot(ergebnis, UMBENANNT_NACH);
});

test("sammeldateien: eine schon als .ts vorhandene Sammeldatei bekommt keinen neuen Export", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [LISTE]: EINGEFROREN[LISTE], [JSON_TS]: speicher("load", "save") },
    nachher: { [JSON_TS]: speicher("load", "save", "markiere") },
  });
  istRot(ergebnis, /src\/store\/json\.ts: neuer Export „markiere“\. Die Sammeldatei bekommt keinen neuen Export und keinen entfernten zurück\. Eine neue Speicherfunktion kommt/);
});

test("sammeldateien: liegen .js und .ts nebeneinander, zählen die Exporte beider Dateien", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: EINGEFROREN,
    nachher: { [JSON_TS]: speicher("markiere") },
  });
  istRot(ergebnis, /src\/store\/json\.ts: neuer Export „markiere“/);
  assert.doesNotMatch(ergebnis.stderr, /neuer Export „load“/);
});

test("sammeldateien: liegen .js und .ts schon auf der Basis nebeneinander, zählen die Exporte beider Dateien", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: {
      [LISTE]: liste("load", "save", "markiere"),
      [JSON_SPEICHER]: speicher("load", "save"),
      [JSON_TS]: speicher("markiere"),
    },
    nachher: { "src/app.js": "export const app = false;\n" },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^3 Exporte von 1 Sammeldateien, eingefroren in tools\/basis\/sammeldatei-exporte\.json; 0 davon/m);
});

test("sammeldateien: eine eingefrorene Datei, die es auf der Basis nicht gab, hat nur neue Exporte", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: {},
    nachher: { [LISTE]: liste("load", "save"), [JSON_SPEICHER]: speicher("load", "save") },
  });
  istRot(ergebnis, /src\/store\/json\.js: neuer Export „load“/);
  assert.match(ergebnis.stderr, /src\/store\/json\.js: neuer Export „save“/);
});

test("sammeldateien: eine Liste, die es auf der Basis noch nicht gibt, gilt als neu angelegt", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [JSON_SPEICHER]: speicher("load", "save") },
    nachher: { [LISTE]: liste("load", "save") },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^2 Exporte von 1 Sammeldateien, eingefroren in tools\/basis\/sammeldatei-exporte\.json; 0 davon/m);
});

test("sammeldateien: eine gelöschte Sammeldatei mit stehengebliebenen Einträgen ist grün und die Einträge werden zum Streichen genannt", (context) => {
  const ergebnis = nachLoeschung(context, { vorher: EINGEFROREN, geloescht: [JSON_SPEICHER] });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /; 2 davon gibt es nicht mehr, sie können gestrichen werden$/m);
});

test("sammeldateien: eine umbenannte Sammeldatei mit auf den neuen Pfad umgestellter Liste ist rot", (context) => {
  const neueListe = ["load", "save"].map((name) => `src/store/json-speicher.js#${name}`);
  const ergebnis = nachLoeschung(context, {
    vorher: EINGEFROREN,
    geloescht: [JSON_SPEICHER],
    nachher: { "src/store/json-speicher.js": speicher("load", "save"), [LISTE]: `${JSON.stringify(neueListe)}\n` },
  });
  istRot(ergebnis, /src\/store\/json\.js: Die Sammeldatei wird nach src\/store\/json-speicher\.js umbenannt/);
  assert.match(ergebnis.stderr, /darf nur kürzer werden, neu eingefroren ist: src\/store\/json-speicher\.js#load/);
});

test("sammeldateien: eine Umbenennung wird auch gefunden, wenn Git das Erkennen von Umbenennungen abgeschaltet hat", (context) => {
  const ergebnis = verschobeneSammeldatei(context, {
    ziel: "src/store/json-speicher.js",
    text: speicher("load", "save"),
    konfiguration: [["diff.renames", "false"]],
  });
  istRot(ergebnis, /src\/store\/json\.js: Die Sammeldatei wird nach src\/store\/json-speicher\.js umbenannt/);
});

const ORTE = [
  ["src/store/state-ops.js", /zurück\. Eine neue Speicherfunktion kommt als reine Funktion/],
  ["src/store/json.js", /zurück\. Eine neue Speicherfunktion kommt als reine Funktion/],
  ["src/store/pg.js", /zurück\. Eine neue Speicherfunktion kommt als reine Funktion/],
  ["src/store/defaults.js", /zurück\. Eine neue Konstante steht in der Datei/],
  ["src/config.js", /zurück\. Ein neuer Konfigurationswert ist ein Schlüssel/],
  ["src/mcp-tools.js", /zurück\. Neue Werte und Hilfen eines Werkzeugs stehen/],
];

function neuerExportIn(context, datei) {
  return nachAenderung(context, {
    vorher: { [LISTE]: `${JSON.stringify([`${datei}#alt`])}\n`, [datei]: speicher("alt") },
    nachher: { [datei]: speicher("alt", "neu") },
  });
}

test("sammeldateien: die Meldung nennt je Sammeldatei den Ort, an den der Code gehört", (context) => {
  for (const [datei, ort] of ORTE) {
    const ergebnis = neuerExportIn(context, datei);
    assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
    assert.ok(ergebnis.stderr.includes(`${datei}: neuer Export „neu“.`), datei);
    assert.match(ergebnis.stderr, ort, datei);
  }
});

test("sammeldateien: eine Datei ohne bekannten Ort bekommt eine Meldung ohne Ortstext", (context) => {
  const ergebnis = neuerExportIn(context, "src/andere.js");
  istRot(ergebnis, /src\/andere\.js: neuer Export „neu“\. Die Sammeldatei bekommt keinen neuen Export und keinen entfernten zurück\.$/m);
  assert.doesNotMatch(ergebnis.stderr, /undefined/);
});

test("sammeldateien: eine umbenannte Datei ohne bekannten Ort bekommt eine Meldung ohne Ortstext", (context) => {
  const ergebnis = nachLoeschung(context, {
    vorher: { [LISTE]: `${JSON.stringify(["src/andere.js#alt"])}\n`, "src/andere.js": speicher("alt") },
    geloescht: ["src/andere.js"],
    nachher: { "src/andere-neu.js": speicher("alt"), "src/app.js": "export const app = false;\n" },
  });
  istRot(ergebnis, /src\/andere\.js: Die Sammeldatei wird nach src\/andere-neu\.js umbenannt\..* kommen an ihren Ort\.$/m);
  assert.doesNotMatch(ergebnis.stderr, /undefined/);
});

test("sammeldateien: zwei umbenannte Sammeldateien in einem Schritt sind beide rot", (context) => {
  const ergebnis = nachLoeschung(context, {
    vorher: {
      [LISTE]: `${JSON.stringify([`${JSON_SPEICHER}#load`, `${STATE_OPS}#anlegen`])}\n`,
      [JSON_SPEICHER]: speicher("load"),
      [STATE_OPS]: speicher("anlegen"),
    },
    geloescht: [JSON_SPEICHER, STATE_OPS],
    nachher: { "src/store/json-speicher.js": speicher("load"), "src/store/ops.js": speicher("anlegen") },
  });
  istRot(ergebnis, /src\/store\/json\.js: Die Sammeldatei wird nach src\/store\/json-speicher\.js umbenannt/);
  assert.match(ergebnis.stderr, /src\/store\/state-ops\.js: Die Sammeldatei wird nach src\/store\/ops\.js umbenannt/);
});

const STERN_MIT_RAUTE = {
  [LISTE]: `${JSON.stringify([`${JSON_SPEICHER}#*:./a#b.js`])}\n`,
  [JSON_SPEICHER]: 'export * from "./a#b.js";\n',
  "src/store/a#b.js": "export const x = 1;\n",
};

test("sammeldateien: ein Stern-Export mit # im Modulpfad steht in der Liste und die Datei wird geprüft", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: STERN_MIT_RAUTE,
    nachher: { [JSON_SPEICHER]: `${STERN_MIT_RAUTE[JSON_SPEICHER]}export function markiere() {}\n` },
  });
  istRot(ergebnis, /src\/store\/json\.js: neuer Export „markiere“/);
  assert.doesNotMatch(ergebnis.stderr, /neuer Export „\*:/);
});

test("sammeldateien: ein Stern-Export mit # im Modulpfad zählt in der Zusammenfassung als vorhanden", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: STERN_MIT_RAUTE,
    nachher: { "src/app.js": "export const app = false;\n" },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^1 Exporte von 1 Sammeldateien, eingefroren in tools\/basis\/sammeldatei-exporte\.json; 0 davon/m);
});
