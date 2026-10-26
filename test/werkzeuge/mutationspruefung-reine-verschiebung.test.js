import assert from "node:assert/strict";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { testumbauPruefung } from "../../tools/mutationspruefung/testumbau.mjs";
import { probeRepository, writeFiles } from "./probe-repo.js";

const EXIT_GRUEN = 0;
const ALTE_HILFE = "test/helfer/zahl-hilfe.js";
const NEUE_HILFE = "test/zahlen/zahl-hilfe.js";
const TIEFE_HILFE = "test/zahlen/tief/zahl-hilfe.js";
const ERKANNT = "reine Verschiebung: keine Testumbau-Mutation (Dateien ";
const HILFE = ['import { einordnen } from "../../src/zahl.js";', "export function negativ() {", "  return einordnen(-1);", "}", ""].join("\n");

function zahlTest({ hilfe = "./helfer/zahl-hilfe.js", sicher = "node:assert/strict", positiv = 1 } = {}) {
  return [
    `import assert from "${sicher}";`,
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    `import { negativ } from "${hilfe}";`,
    'test("negativ", () => assert.equal(negativ(), "negativ"));',
    `test("positiv", () => assert.equal(einordnen(${positiv}), "positiv"));`,
    "",
  ].join("\n");
}

function randTest(hilfe = "../helfer/zahl-hilfe.js") {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { negativ } from "${hilfe}";`,
    'test("rand", () => assert.equal(negativ(), "negativ"));',
    "",
  ].join("\n");
}

const PROBE = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/zahl.js": 'export function einordnen(zahl) {\n  if (zahl < 0) return "negativ";\n  return "positiv";\n}\n',
  "test/helfer/werte.js": "export const MINUS = -1;\n",
  [ALTE_HILFE]: HILFE,
  "test/zahl.test.js": zahlTest(),
  "test/zahlen/rand.test.js": randTest(),
};

function zaehlendesWerkzeug() {
  const aufrufe = [];
  return {
    aufrufe,
    alterStand: () => () => {},
    durchgang: async (datei) => {
      aufrufe.push(datei);
      return [];
    },
    ueberlebt: ({ status }) => status === "Survived",
  };
}

function dateienNachVerschiebung({ probe = PROBE, ziel = NEUE_HILFE, zahl = zahlTest({ hilfe: "./zahlen/zahl-hilfe.js" }), rand = randTest("./zahl-hilfe.js"), ...rest }) {
  return rest.dateien ?? { [ziel]: rest.hilfe ?? probe[ALTE_HILFE], "test/zahl.test.js": zahl, "test/zahlen/rand.test.js": rand };
}

function verschobenesRepo(context, optionen) {
  const { probe = PROBE, von = ALTE_HILFE, links = {} } = optionen;
  const repo = probeRepository(context, probe);
  for (const pfad of [von].flat()) rmSync(join(repo, pfad));
  writeFiles(repo, dateienNachVerschiebung(optionen));
  for (const [pfad, auf] of Object.entries(links)) {
    rmSync(join(repo, pfad));
    symlinkSync(auf, join(repo, pfad));
  }
  return repo;
}

async function nachVerschiebung(context, optionen = {}) {
  const repo = verschobenesRepo(context, optionen);
  const werkzeug = zaehlendesWerkzeug();
  const ausgabe = context.mock.method(console, "log", () => {});
  const vorher = cwd();
  chdir(repo);
  try {
    const ergebnis = await testumbauPruefung("HEAD", werkzeug);
    return { ergebnis, aufrufe: werkzeug.aufrufe, zeilen: ausgabe.mock.calls.map(({ arguments: [zeile] }) => String(zeile)) };
  } finally {
    chdir(vorher);
  }
}

function vollGeprueft({ aufrufe, zeilen }) {
  assert.deepEqual(aufrufe, ["src/zahl.js"], zeilen.join("\n"));
  nichtErkannt(zeilen);
}

function verschobeneHilfeMit(context, kopf) {
  return nachVerschiebung(context, { probe: { ...PROBE, [ALTE_HILFE]: `${kopf}\n${HILFE}` } });
}

function erkannt({ aufrufe, zeilen }) {
  assert.deepEqual(aufrufe, [], zeilen.join("\n"));
  assert.ok(zeilen.some((zeile) => zeile.startsWith(ERKANNT)), zeilen.join("\n"));
}

function nichtErkannt(zeilen) {
  assert.ok(!zeilen.some((zeile) => zeile.startsWith(ERKANNT)), zeilen.join("\n"));
}

test("Reine Verschiebung: eine Testhilfe mit gleichem Inhalt in gleicher Tiefe verschoben und in den Nutzern nur die Importpfade nachgezogen, startet keine Testumbau-Mutation und nennt die Dateien", async (context) => {
  const { ergebnis, aufrufe, zeilen } = await nachVerschiebung(context);
  assert.equal(ergebnis, EXIT_GRUEN, zeilen.join("\n"));
  assert.deepEqual(aufrufe, [], zeilen.join("\n"));
  const zeile = zeilen.find((text) => text.startsWith(ERKANNT));
  assert.ok(zeile, zeilen.join("\n"));
  assert.ok(zeile.includes(`${ALTE_HILFE} → ${NEUE_HILFE}`), zeile);
  assert.ok(zeile.includes("test/zahl.test.js") && zeile.includes("test/zahlen/rand.test.js"), zeile);
});

test("Reine Verschiebung: eine weitere geänderte Zeile in einer Testdatei führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await nachVerschiebung(context, { zahl: zahlTest({ hilfe: "./zahlen/zahl-hilfe.js", positiv: 2 }) }));
});

test("Reine Verschiebung: eine verschobene Hilfe mit geändertem Inhalt führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await nachVerschiebung(context, { hilfe: `${HILFE}// verschoben\n` }));
});

test("Reine Verschiebung: eine Verschiebung in eine andere Verzeichnistiefe führt zur vollen Testumbau-Mutation", async (context) => {
  const ohneRelativeImporte = { ...PROBE, [ALTE_HILFE]: 'export function negativ() {\n  return "negativ";\n}\n' };
  const tief = { probe: ohneRelativeImporte, ziel: TIEFE_HILFE, zahl: zahlTest({ hilfe: "./zahlen/tief/zahl-hilfe.js" }), rand: randTest("./tief/zahl-hilfe.js") };
  vollGeprueft(await nachVerschiebung(context, tief));
});

test("Reine Verschiebung: ein geänderter Importpfad, der nicht auf die verschobene Datei zeigt, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await nachVerschiebung(context, { zahl: zahlTest({ hilfe: "./zahlen/zahl-hilfe.js", sicher: "node:assert" }) }));
});

test("Reine Verschiebung: zeigt ein relativer Import der verschobenen Hilfe am neuen Ort auf eine andere Datei, folgt die volle Testumbau-Mutation", async (context) => {
  const probe = { ...PROBE, "test/zahlen/werte.js": "export const MINUS = 1;\n", [ALTE_HILFE]: `import { MINUS } from "./werte.js";\n${HILFE}` };
  vollGeprueft(await nachVerschiebung(context, { probe }));
});

test("Reine Verschiebung: eine verschobene Testdatei mit gleichem Inhalt in gleicher Tiefe führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await nachVerschiebung(context, { von: "test/zahlen/rand.test.js", dateien: { "test/andere/rand.test.js": randTest() } }));
});

test("Reine Verschiebung: eine Testdatei, die durch Umbenennen nicht mehr als Test läuft, führt nicht zum Überspringen der Testumbau-Mutation", async (context) => {
  const { zeilen } = await nachVerschiebung(context, { von: "test/zahl.test.js", dateien: { "test/zahl-alt.js": zahlTest() } });
  nichtErkannt(zeilen);
});

test("Reine Verschiebung: eine verschobene Hilfe, die import.meta liest, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await verschobeneHilfeMit(context, "export const HIER = import.meta.url;"));
});

test("Reine Verschiebung: eine verschobene Hilfe, die __dirname liest, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await verschobeneHilfeMit(context, "export const HIER = __dirname;"));
});

test("Reine Verschiebung: eine verschobene Hilfe mit dynamischem Import ohne festen Pfad führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await verschobeneHilfeMit(context, 'const WERTE = "./werte.js";\nexport const werte = () => import(WERTE);'));
});

test("Reine Verschiebung: eine verschobene Vorlage ohne Code mit gleichem Inhalt in gleicher Tiefe startet keine Testumbau-Mutation", async (context) => {
  const vorlage = '{ "minus": -1 }\n';
  const probe = { ...PROBE, "test/helfer/werte.json": vorlage };
  const { aufrufe, zeilen } = await nachVerschiebung(context, { probe, von: "test/helfer/werte.json", dateien: { "test/zahlen/werte.json": vorlage } });
  assert.deepEqual(aufrufe, [], zeilen.join("\n"));
  assert.ok(zeilen.some((zeile) => zeile.startsWith(ERKANNT) && zeile.includes("test/helfer/werte.json → test/zahlen/werte.json")), zeilen.join("\n"));
});

test("Reine Verschiebung: eine angepasste Datei ohne Code führt zur vollen Testumbau-Mutation, auch wenn sich darin nur ein Pfad auf die verschobene Hilfe ändert", async (context) => {
  const probe = { ...PROBE, "test/zahlen/vorlage.txt": 'import { negativ } from "../helfer/zahl-hilfe.js";\n' };
  const dateien = { [NEUE_HILFE]: HILFE, "test/zahl.test.js": zahlTest({ hilfe: "./zahlen/zahl-hilfe.js" }), "test/zahlen/rand.test.js": randTest("./zahl-hilfe.js"), "test/zahlen/vorlage.txt": 'import { negativ } from "./zahl-hilfe.js";\n' };
  vollGeprueft(await nachVerschiebung(context, { probe, dateien }));
});

test("Reine Verschiebung: eine inhaltsgleich umbenannte Quelldatei unter src/ führt nicht zum Überspringen der Testumbau-Mutation", async (context) => {
  const { zeilen } = await nachVerschiebung(context, { von: "src/zahl.js", dateien: { "src/zahl-neu.js": PROBE["src/zahl.js"] } });
  nichtErkannt(zeilen);
});

test("Reine Verschiebung: eine zusätzliche neue Testdatei ohne gelöschtes Gegenstück führt zur vollen Testumbau-Mutation", async (context) => {
  const dateien = { [NEUE_HILFE]: HILFE, "test/zahl.test.js": zahlTest({ hilfe: "./zahlen/zahl-hilfe.js" }), "test/zahlen/rand.test.js": randTest("./zahl-hilfe.js"), "test/zahlen/neu.test.js": randTest("./zahl-hilfe.js") };
  vollGeprueft(await nachVerschiebung(context, { dateien }));
});

test("Reine Verschiebung: zwei inhaltsgleiche Hilfen, die zu einer neuen Datei zusammengelegt werden, führen auch neben einer weiteren neuen Datei zur vollen Testumbau-Mutation", async (context) => {
  const probe = { ...PROBE, "test/helfer/zwei-hilfe.js": HILFE, "test/zahlen/rand.test.js": randTest("../helfer/zwei-hilfe.js") };
  const von = [ALTE_HILFE, "test/helfer/zwei-hilfe.js"];
  const dateien = { [NEUE_HILFE]: HILFE, "test/zahlen/weitere.js": "export const EINS = 1;\n", "test/zahl.test.js": zahlTest({ hilfe: "./zahlen/zahl-hilfe.js" }), "test/zahlen/rand.test.js": randTest("./zahl-hilfe.js") };
  vollGeprueft(await nachVerschiebung(context, { probe, von, dateien }));
});

test("Reine Verschiebung: eine verschobene Hilfe, deren relatives require am neuen Ort auf eine andere Datei zeigt, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await verschobeneHilfeMit(context, 'export const { MINUS } = require("./werte.js");'));
});

test("Reine Verschiebung: eine verschobene Hilfe mit require ohne festen Pfad führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await verschobeneHilfeMit(context, 'const WERTE = "./werte.js";\nexport const werte = () => require(WERTE);'));
});

test("Reine Verschiebung: eine verschobene Hilfe, die sich nicht lesen lässt, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await verschobeneHilfeMit(context, "export const = ;"));
});

test("Reine Verschiebung: eine angepasste Testdatei, die sich vorher wie nachher nicht lesen lässt, führt zur vollen Testumbau-Mutation", async (context) => {
  const kaputt = "export const = ;\n";
  const probe = { ...PROBE, "test/zahl.test.js": `${zahlTest()}${kaputt}` };
  const dateien = { [NEUE_HILFE]: HILFE, "test/zahl.test.js": `${zahlTest({ hilfe: "./zahlen/zahl-hilfe.js" })}${kaputt}`, "test/zahlen/rand.test.js": randTest("./zahl-hilfe.js") };
  vollGeprueft(await nachVerschiebung(context, { probe, dateien }));
});

test("Reine Verschiebung: eine angepasste Testdatei, in der sich nur die Anführungszeichen eines Pfads ändern, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await nachVerschiebung(context, { zahl: zahlTest().replace('"node:test"', "'node:test'") }));
});

test("Reine Verschiebung: eine verschobene Hilfe mit Import eines Pakets statt einer Datei startet keine Testumbau-Mutation", async (context) => {
  erkannt(await verschobeneHilfeMit(context, 'import { strictEqual } from "node:assert";\nexport const gleich = strictEqual;'));
});

test("Reine Verschiebung: zwei gemeinsam verschobene Hilfen, von denen eine die andere relativ importiert, starten keine Testumbau-Mutation", async (context) => {
  const probe = { ...PROBE, [ALTE_HILFE]: `import { MINUS } from "./werte.js";\n${HILFE}` };
  const dateien = { [NEUE_HILFE]: probe[ALTE_HILFE], "test/zahlen/werte.js": PROBE["test/helfer/werte.js"], "test/zahl.test.js": zahlTest({ hilfe: "./zahlen/zahl-hilfe.js" }), "test/zahlen/rand.test.js": randTest("./zahl-hilfe.js") };
  erkannt(await nachVerschiebung(context, { probe, von: [ALTE_HILFE, "test/helfer/werte.js"], dateien }));
});

test("Reine Verschiebung: ersetzt neben der Verschiebung ein Symlink eine Testdatei, folgt die volle Testumbau-Mutation", async (context) => {
  vollGeprueft(await nachVerschiebung(context, { links: { "test/helfer/werte.js": "../zahlen/zahl-hilfe.js" } }));
});

test("Reine Verschiebung: eine verschobene Hilfe, die einen Pfad über require.resolve auflöst, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await verschobeneHilfeMit(context, 'export const WERTE = require.resolve("./werte.js");'));
});

test("Reine Verschiebung: eine verschobene Hilfe, die require weiterreicht, führt zur vollen Testumbau-Mutation", async (context) => {
  vollGeprueft(await verschobeneHilfeMit(context, 'const laden = require;\nexport const werte = () => laden("./werte.js");'));
});
