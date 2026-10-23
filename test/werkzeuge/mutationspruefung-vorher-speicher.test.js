import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { cruise } from "dependency-cruiser";

import {
  mitVorherSpeicher,
  vorherSchluessel,
  werkzeugEingaben,
} from "../../tools/mutationspruefung/vorher-speicher.mjs";
import { commitAll, probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const ERGEBNIS = {
  tests: ["test/a.test.js"],
  quellen: ["src/a.js"],
  getoetet: [{ schluessel: "src/a.js:1 Mutant", datei: "src/a.js" }],
};
const GEAENDERT = ["test/a.test.js"];
const BANK_DATEI = "test/testbaenke-run.mjs";
const MODULSTAND = "node_modules/.package-lock.json";
const WERKZEUG = "tools/mutationspruefung.mjs";
const EIGENE_DATEI = /^(?:tools|src|test)\/|^[^/]+\.json$/;
const ERSTER_LAUF = 1;
const GLEICHER_STAND = 0;
const NEUER_STAND = 1;

function stand(context) {
  return probeRepository(context, {
    "src/a.js": "export const a = 1;\n",
    "test/a.test.js": "import '../src/a.js';\n",
    "test/hilfe.js": "export const hilfe = 1;\n",
    [BANK_DATEI]: "export const muster = 'alt';\n",
    "tools/werkzeug.mjs": "export const w = 1;\n",
    "package.json": "{}\n",
    "package-lock.json": "{}\n",
    "stryker.config.json": "{}\n",
    ".gitignore": "node_modules/\n",
    [MODULSTAND]: "{}\n",
  });
}

function kopf(root) {
  return runIn(root, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

function zaehler() {
  const aufrufe = { anzahl: 0 };
  aufrufe.rechne = async () => {
    aufrufe.anzahl += 1;
    return ERGEBNIS;
  };
  return aufrufe;
}

async function nacheinander(root, geaendert, staende) {
  const basis = kopf(root);
  const rechnen = zaehler();
  for (const herstellen of staende) {
    herstellen();
    await mitVorherSpeicher({ basis, geaendert, root }, rechnen.rechne);
  }
  return rechnen.anzahl;
}

async function zweimal(root, basisVorher, { aendern, geaendertDanach = GEAENDERT }) {
  const rechnen = zaehler();
  const erstes = await mitVorherSpeicher(
    { basis: basisVorher, geaendert: GEAENDERT, root },
    rechnen.rechne,
  );
  const basisDanach = aendern();
  const zweites = await mitVorherSpeicher(
    { basis: basisDanach, geaendert: geaendertDanach, root },
    rechnen.rechne,
  );
  return { anzahl: rechnen.anzahl, erstes, zweites };
}

test("Vorher-Speicher: gleicher Stand rechnet die Vorher-Seite nur einmal und liefert dasselbe Ergebnis", async (context) => {
  const root = stand(context);
  const basis = kopf(root);
  const { anzahl, erstes, zweites } = await zweimal(root, basis, { aendern: () => basis });
  assert.equal(anzahl, ERSTER_LAUF + GLEICHER_STAND);
  assert.deepEqual(erstes, ERGEBNIS);
  assert.deepEqual(zweites, ERGEBNIS);
});

test("Vorher-Speicher: eine geänderte Quelldatei der Basis trifft nicht, auch bei gleichem Kopf", async (context) => {
  const root = stand(context);
  const basisOhneAenderung = kopf(root);
  writeFileSync(join(root, "src/a.js"), "export const a = 2;\n");
  commitAll(root, "Quelle");
  const { anzahl } = await zweimal(root, basisOhneAenderung, { aendern: () => kopf(root) });
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: eine geänderte Testhilfe der Basis trifft nicht, auch bei gleichem Kopf", async (context) => {
  const root = stand(context);
  const basisOhneAenderung = kopf(root);
  writeFileSync(join(root, "test/hilfe.js"), "export const hilfe = 2;\n");
  commitAll(root, "Hilfe");
  const { anzahl } = await zweimal(root, basisOhneAenderung, { aendern: () => kopf(root) });
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: eine geänderte Lockdatei trifft nicht, auch bei gleicher Basis", async (context) => {
  const root = stand(context);
  const basis = kopf(root);
  const { anzahl } = await zweimal(root, basis, {
    aendern: () => {
      writeFileSync(join(root, "package-lock.json"), '{"neu": true}\n');
      commitAll(root, "Lock");
      return basis;
    },
  });
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: eine andere Menge geänderter Testdateien trifft nicht", async (context) => {
  const root = stand(context);
  const basis = kopf(root);
  const { anzahl } = await zweimal(root, basis, {
    aendern: () => basis,
    geaendertDanach: [...GEAENDERT, "test/b.test.js"],
  });
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: eine ungespeicherte Änderung am Werkzeug trifft nicht, auch bei gleicher Basis", async (context) => {
  const root = stand(context);
  const werkzeug = () => writeFileSync(join(root, "tools/werkzeug.mjs"), "export const w = 2;\n");
  const anzahl = await nacheinander(root, GEAENDERT, [() => {}, werkzeug]);
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: eine geänderte stryker.config.json am Kopf trifft nicht, auch bei gleicher Basis", async (context) => {
  const root = stand(context);
  const basis = kopf(root);
  const { anzahl } = await zweimal(root, basis, {
    aendern: () => {
      writeFileSync(join(root, "stryker.config.json"), '{"timeoutMS": 1}\n');
      commitAll(root, "Stryker");
      return basis;
    },
  });
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: eine ungespeicherte Änderung an test/testbaenke-run.mjs trifft nicht, auch außerhalb der geänderten Testdateien", async (context) => {
  const root = stand(context);
  const anzahl = await nacheinander(root, GEAENDERT, [() => {}, schreibeBank(root, "neu")]);
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: der umgebaute Test selbst darf ungespeichert sein, die Wiederholung trifft", async (context) => {
  const root = stand(context);
  const basis = kopf(root);
  writeFileSync(
    join(root, "test/a.test.js"),
    "import '../src/a.js';\nexport const umgebaut = 1;\n",
  );
  const { anzahl } = await zweimal(root, basis, { aendern: () => basis });
  assert.equal(anzahl, ERSTER_LAUF + GLEICHER_STAND);
});

function schreibeBank(root, fassung) {
  return () => writeFileSync(join(root, BANK_DATEI), `export const muster = '${fassung}';\n`);
}

test("Vorher-Speicher: ein anderer ungespeicherter Inhalt von test/testbaenke-run.mjs trifft nicht, auch unter den geänderten Testdateien", async (context) => {
  const root = stand(context);
  const anzahl = await nacheinander(
    root,
    [BANK_DATEI, ...GEAENDERT],
    [schreibeBank(root, "fassung-a"), schreibeBank(root, "fassung-b")],
  );
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: derselbe ungespeicherte Inhalt von test/testbaenke-run.mjs trifft", async (context) => {
  const root = stand(context);
  const fassung = schreibeBank(root, "fassung-a");
  const anzahl = await nacheinander(root, [BANK_DATEI, ...GEAENDERT], [fassung, fassung]);
  assert.equal(anzahl, ERSTER_LAUF + GLEICHER_STAND);
});

test("Vorher-Speicher: eine ungespeichert gelöschte Werkzeugdatei trifft beim gleichen Stand und nicht bei neuem Inhalt", async (context) => {
  const root = stand(context);
  const loeschen = () => unlinkSync(join(root, BANK_DATEI));
  const anzahl = await nacheinander(
    root,
    [BANK_DATEI, ...GEAENDERT],
    [loeschen, () => {}, schreibeBank(root, "fassung-a")],
  );
  assert.equal(anzahl, ERSTER_LAUF + GLEICHER_STAND + NEUER_STAND);
});

test("Vorher-Speicher: eine ungespeicherte Verknüpfung unter den Werkzeugdateien schaltet den Speicher ab", async (context) => {
  const root = stand(context);
  const verknuepfen = () => symlinkSync("werkzeug.mjs", join(root, "tools/verknuepft.mjs"));
  const anzahl = await nacheinander(root, GEAENDERT, [verknuepfen, () => {}]);
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

function schreibeTest(root, fassung) {
  return () => writeFileSync(join(root, "test/a.test.js"), `import '../src/a.js';\nexport const fassung = '${fassung}';\n`);
}

test("Vorher-Speicher: neue Fassungen einer geänderten Testdatei treffen, ungespeichert wie eingecheckt", async (context) => {
  const root = stand(context);
  const anzahl = await nacheinander(root, GEAENDERT, [
    schreibeTest(root, "fassung-a"),
    schreibeTest(root, "fassung-b"),
    () => {
      schreibeTest(root, "fassung-c")();
      commitAll(root, "Fassung c");
    },
  ]);
  assert.equal(anzahl, ERSTER_LAUF + GLEICHER_STAND + GLEICHER_STAND);
});

test("Vorher-Speicher: eine ungespeicherte Änderung an einer Quelldatei außerhalb der Werkzeugdateien trifft", async (context) => {
  const root = stand(context);
  const quelle = (wert) => () => writeFileSync(join(root, "src/a.js"), `export const a = ${wert};\n`);
  const anzahl = await nacheinander(root, GEAENDERT, [quelle(2), quelle(3)]);
  assert.equal(anzahl, ERSTER_LAUF + GLEICHER_STAND);
});

test("Vorher-Speicher: anders installierte Module treffen nicht, auch bei gleicher Basis und gleicher Lockdatei", async (context) => {
  const root = stand(context);
  const module = () => writeFileSync(join(root, MODULSTAND), '{"neu": true}\n');
  const anzahl = await nacheinander(root, GEAENDERT, [() => {}, module]);
  assert.equal(anzahl, ERSTER_LAUF + NEUER_STAND);
});

test("Vorher-Speicher: jede eigene Datei, die das Werkzeug lädt, gehört zu den Eingaben des Schlüssels", async () => {
  const { output } = await cruise([WERKZEUG], { baseDir: REPO_ROOT, doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] });
  const geladen = output.modules.map(({ source }) => source).filter((pfad) => EIGENE_DATEI.test(pfad));
  const eingaben = new Set(werkzeugEingaben(REPO_ROOT));
  assert.deepEqual(geladen.filter((pfad) => !eingaben.has(pfad)), []);
  assert.ok(geladen.includes(WERKZEUG));
  assert.ok(eingaben.has("stryker.config.json"));
});

function zwischendatei(root, basis) {
  const gemeinsam = resolve(
    root,
    runIn(root, "git", ["rev-parse", "--git-common-dir"]).stdout.trim(),
  );
  const schluessel = vorherSchluessel(basis, GEAENDERT, root);
  return join(gemeinsam, "hermes", "testumbau-vorher", `${schluessel}.json.neu`);
}

test("Vorher-Speicher: eine fremde Zwischendatei unter dem festen Namen verhindert das Ablegen nicht", async (context) => {
  const root = stand(context);
  const basis = kopf(root);
  mkdirSync(zwischendatei(root, basis), { recursive: true });
  const { anzahl } = await zweimal(root, basis, { aendern: () => basis });
  assert.equal(anzahl, ERSTER_LAUF + GLEICHER_STAND);
});
