import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { probeRepository, REPO_ROOT, runIn, writeFiles } from "./probe-repo.js";

const COMPARE_TOOL = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const GENERATOR = join(REPO_ROOT, "tools/hinweise-erzeugen.mjs");
const GENERATE_COMMAND = "npm run hinweise";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const MAP_FILE = "tools/bausteine.json";
const HAND_TEXT = "Handgeschriebene Regel.\n";
const FREE_LINE = "Freie neue Regel.\n";
const MAP = {
  schichten: [["basis"], ["fach"], ["neu"]],
  bausteine: [
    {
      baustein: "basis",
      zweck: "Reine Hilfen ohne Fachwissen.",
      quellen: ["src/basis/", "src/fach/hilfe.js"],
      eingaenge: "alle",
      nutzt: [],
    },
    {
      baustein: "fach",
      zweck: "Fachliche Abläufe.",
      quellen: ["src/fach/", "src/fach-zwei/"],
      eingaenge: ["src/fach/tor.js"],
      nutzt: [],
    },
    {
      baustein: "neu",
      zweck: "Ein später angelegter Baustein.",
      quellen: ["src/neu/"],
      eingaenge: [],
      nutzt: ["fach"],
    },
  ],
  altlast: [],
};
const FILES = {
  [MAP_FILE]: `${JSON.stringify(MAP, null, 2)}\n`,
  "src/basis/a.js": "export const a = 1;\n",
  "src/fach/tor.js": "export const tor = 1;\n",
  "src/fach/hilfe.js": "export const hilfe = 1;\n",
  "src/fach/CLAUDE.md": HAND_TEXT,
  "src/fach-zwei/z.js": "export const z = 1;\n",
  "src/neu/n.js": "export const n = 1;\n",
  "src/neu/CLAUDE.md": "Handtext des neuen Bausteins.\n",
};

function compare(directory) {
  const result = runIn(directory, process.execPath, [COMPARE_TOOL, "anweisungen"]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function generate(directory) {
  const result = runIn(directory, process.execPath, [GENERATOR]);
  assert.equal(
    result.status,
    EXIT_OK,
    `Der Erzeuger legt den Kartenteil nicht an: ${result.stdout}${result.stderr}`,
  );
}

function probe(context) {
  const directory = probeRepository(context, FILES);
  const created = runIn(directory, process.execPath, [
    COMPARE_TOOL,
    "anweisungen",
    "--basis-anlegen",
  ]);
  assert.equal(created.status, EXIT_OK, created.stderr);
  return directory;
}

function read(directory, path) {
  return readFileSync(join(directory, path), "utf8");
}

function generated(context) {
  const directory = probe(context);
  generate(directory);
  return directory;
}

test("hinweise: der Erzeuger legt je Ordner der Karte einen Kartenteil an und lässt den Handtext stehen", (context) => {
  const directory = probe(context);
  generate(directory);
  const fach = read(directory, "src/fach/CLAUDE.md");
  assert.ok(fach.startsWith(HAND_TEXT), fach);
  for (const erwartet of [
    "fach",
    "Fachliche Abläufe.",
    "tor.js",
    "basis",
    "hilfe.js",
    GENERATE_COMMAND,
  ]) {
    assert.ok(fach.includes(erwartet), `${erwartet} fehlt:\n${fach}`);
  }
  const basis = read(directory, "src/basis/CLAUDE.md");
  assert.ok(basis.includes("Reine Hilfen ohne Fachwissen."), basis);
  const neu = read(directory, "src/neu/CLAUDE.md");
  assert.ok(neu.startsWith("Handtext des neuen Bausteins.\n"), neu);
  assert.ok(neu.includes("fach"), neu);
});

test("hinweise: ein zweiter Lauf ändert keine Datei", (context) => {
  const directory = generated(context);
  const paths = ["src/basis/CLAUDE.md", "src/fach/CLAUDE.md", "src/neu/CLAUDE.md"];
  const before = paths.map((path) => read(directory, path));
  generate(directory);
  assert.deepEqual(
    paths.map((path) => read(directory, path)),
    before,
  );
});

test("anweisungen: fehlt der Kartenteil, ist es rot und die Meldung nennt den Befehl, danach grün", (context) => {
  const directory = probe(context);
  const before = compare(directory);
  assert.equal(before.status, EXIT_FINDING, before.output);
  assert.ok(before.output.includes("src/neu"), before.output);
  assert.ok(before.output.includes(GENERATE_COMMAND), before.output);
  generate(directory);
  const after = compare(directory);
  assert.equal(after.status, EXIT_OK, after.output);
});

test("anweisungen: eine Änderung der Karte ohne neues Erzeugen ist rot, danach grün", (context) => {
  const directory = generated(context);
  const changed = {
    ...MAP,
    bausteine: MAP.bausteine.map((eintrag) =>
      eintrag.baustein === "fach" ? { ...eintrag, zweck: "Andere Abläufe." } : eintrag,
    ),
  };
  writeFiles(directory, { [MAP_FILE]: `${JSON.stringify(changed, null, 2)}\n` });
  const stale = compare(directory);
  assert.equal(stale.status, EXIT_FINDING, stale.output);
  assert.ok(stale.output.includes("src/fach"), stale.output);
  assert.ok(stale.output.includes(GENERATE_COMMAND), stale.output);
  generate(directory);
  const fresh = compare(directory);
  assert.equal(fresh.status, EXIT_OK, fresh.output);
});

test("anweisungen: eine von Hand geänderte Zeile im Kartenteil ist rot", (context) => {
  const directory = generated(context);
  const text = read(directory, "src/fach/CLAUDE.md");
  writeFiles(directory, {
    "src/fach/CLAUDE.md": text.replace("Fachliche Abläufe.", "Eigene Abläufe."),
  });
  const result = compare(directory);
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.ok(result.output.includes("src/fach/CLAUDE.md"), result.output);
});

test("anweisungen: eine freie neue Zeile neben dem Kartenteil ist rot", (context) => {
  const directory = generated(context);
  const text = read(directory, "src/fach/CLAUDE.md");
  writeFiles(directory, { "src/fach/CLAUDE.md": `${text}\n${FREE_LINE}` });
  const separate = compare(directory);
  assert.equal(separate.status, EXIT_FINDING, separate.output);
  assert.ok(separate.output.includes("src/fach/CLAUDE.md"), separate.output);
  writeFiles(directory, { "src/fach/CLAUDE.md": `${text}${FREE_LINE}` });
  const attached = compare(directory);
  assert.equal(attached.status, EXIT_FINDING, attached.output);
});

test("hinweise: bei einem Baustein mit zwei Ordnern steht der Zweck nur im ersten und der zweite verweist darauf", (context) => {
  const directory = generated(context);
  const first = read(directory, "src/fach/CLAUDE.md");
  const second = read(directory, "src/fach-zwei/CLAUDE.md");
  assert.ok(first.includes("Fachliche Abläufe."), first);
  assert.ok(!second.includes("Fachliche Abläufe."), second);
  assert.ok(second.includes("src/fach/CLAUDE.md"), second);
  assert.ok(second.includes("src/fach-zwei/"), second);
  const result = compare(directory);
  assert.equal(result.status, EXIT_OK, result.output);
});

test("anweisungen: ein @-Import im erzeugten Kartenteil ist rot", (context) => {
  const withImport = {
    ...MAP,
    bausteine: MAP.bausteine.map((eintrag) =>
      eintrag.baustein === "fach"
        ? { ...eintrag, zweck: "Fachliche Abläufe, Regeln in @docs/regeln.md." }
        : eintrag,
    ),
  };
  const directory = probeRepository(context, {
    ...FILES,
    [MAP_FILE]: `${JSON.stringify(withImport, null, 2)}\n`,
  });
  const created = runIn(directory, process.execPath, [
    COMPARE_TOOL,
    "anweisungen",
    "--basis-anlegen",
  ]);
  assert.equal(created.status, EXIT_OK, created.stderr);
  generate(directory);
  const result = compare(directory);
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.ok(result.output.includes("@-Import"), result.output);
});

test("hinweise: ein Ordner der Karte, den es nicht gibt, bekommt keine Datei und ist kein Verweisziel", (context) => {
  const withMissing = {
    ...MAP,
    bausteine: MAP.bausteine.map((eintrag) =>
      eintrag.baustein === "fach"
        ? { ...eintrag, quellen: ["src/fehlt/", "src/fach/", "src/fach-zwei/"] }
        : eintrag,
    ),
  };
  const directory = probeRepository(context, {
    ...FILES,
    [MAP_FILE]: `${JSON.stringify(withMissing, null, 2)}\n`,
  });
  generate(directory);
  const first = read(directory, "src/fach/CLAUDE.md");
  const second = read(directory, "src/fach-zwei/CLAUDE.md");
  assert.ok(first.includes("Fachliche Abläufe."), first);
  assert.ok(!second.includes("src/fehlt/"), second);
  assert.ok(second.includes("src/fach/CLAUDE.md"), second);
});
