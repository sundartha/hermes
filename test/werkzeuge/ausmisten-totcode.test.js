import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chdir, cwd, env, execPath } from "node:process";
import { test } from "node:test";

import { ausgabenAus } from "../../tools/tests-ausmisten/ausgaben.mjs";
import { pruefsummenZeile } from "../../tools/tests-ausmisten/festgehalten.mjs";
import {
  BENUTZER,
  PROTOKOLL_VORSATZ,
  RUNNER_SYSTEM,
  untraut,
} from "../../tools/tests-ausmisten/totcode-untraut.mjs";
import { EINGANG_QUELLE, GATE_TEST, ausmistenRepo, starte } from "./ausmisten/hilfen.mjs";
import { testDatei } from "./ausmisten/messung.mjs";
import { EXIT_GRUEN, EXIT_ROT, leseStufe, schritt, totcodeLauf } from "./ausmisten/totcode.mjs";
import { isolatedEnvironment, probeDirectory } from "./probe-repo.js";

const EINRUECKUNG = 2;
const RECHTE = 0o777;
const OKTAL = 8;
const EINGANG_TEST = "test/post/eingang.test.js";
const LEER_TEST = "test/post/leer.test.js";
const LEER_HILFE = "test/hilfe/leer.js";
const LEER_QUELLE = "src/post/leer.js";
const SPERRE = "src/sperre.js";
const ZWEITER_GATE_TEST = "test/gate-zwei.test.js";
const SPERRE_NUTZER = "test/sperre-nutzer.test.js";
const LEER_FALL = "erkennt den leeren Eingang";
const LEBENDER_FALL = "kürzt den Eingang";
const LEER_PRUEFUNG = 'assert.equal(modul.leer(""), true);';
const EINGANG = "export function eingang(text) {\n  return text.trim();\n}\n";
const LEER_FUNKTION = "export function leer(text) {\n  return text.length === 0;\n}\n";
const MIT_LEER = `${LEER_FUNKTION}\n${EINGANG}`;
const IST_LEER = "export function istLeer(text) {\n  return text.length === 0;\n}\n";
const EINGANG_IMPORT = "../../src/post/eingang.js";
const NEUE_QUELLE = "src/post/kurz.js";
const NAMENS_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  `import { leer } from ${JSON.stringify(EINGANG_IMPORT)};`,
  "",
  `test(${JSON.stringify(LEER_FALL)}, () => {`,
  '  assert.equal(leer(""), true);',
  "});",
  "",
].join("\n");
const ALTE_SPERRE = "export function alteSperre(ziel) {\n  return ziel === '+900';\n}\n\n";
const SPERRE_TEXT = "export function gesperrt(ziel) {\n  return ziel.startsWith('+900');\n}\n";

const LEER_MUTANT = {
  datei: EINGANG_QUELLE,
  text: "text.length === 0",
  mutator: "EqualityOperator",
  ersatz: "text.length !== 0",
  toetend: [LEER_TEST],
};

function trimMutant(toetend) {
  return {
    datei: EINGANG_QUELLE,
    text: "text.trim()",
    mutator: "MethodExpression",
    ersatz: "text",
    toetend,
  };
}

function leerTest(importPfad, weitere = "") {
  return `${testDatei(importPfad, LEER_FALL, LEER_PRUEFUNG)}${weitere}`;
}

const LEBENDER_TEST = testDatei(
  EINGANG_IMPORT,
  LEBENDER_FALL,
  'assert.equal(modul.eingang(" a "), "a");',
);
const BEIDE_FAELLE = leerTest(EINGANG_IMPORT, LEBENDER_TEST.slice(LEBENDER_TEST.indexOf("test(")));

const TOTER_LEER_TEST = {
  basis: { [EINGANG_QUELLE]: MIT_LEER, [LEER_TEST]: leerTest(EINGANG_IMPORT) },
  kopf: { [EINGANG_QUELLE]: EINGANG },
  weg: [LEER_TEST],
  liste: [LEER_TEST],
};

function gateTests(tests) {
  return `${JSON.stringify({ Denylist: { module: [SPERRE], tests } }, null, EINRUECKUNG)}\n`;
}

function erwarteUrteil(lauf, urteil) {
  const text = JSON.stringify(lauf.ergebnis, null, EINRUECKUNG);
  const ausgaben = Object.values(lauf.laeufe).map(({ ausgabe }) => ausgabe);
  assert.equal(lauf.ergebnis?.urteil, urteil, `${text}\n${ausgaben.join("\n")}`);
  const status = urteil === "grün" ? EXIT_GRUEN : EXIT_ROT;
  assert.equal(lauf.laeufe.entscheiden.status, status, lauf.laeufe.entscheiden.ausgabe);
}

function erwarteGrund(lauf, ...teile) {
  const treffer = lauf.ergebnis.gruende.some((grund) =>
    teile.every((teil) => grund.includes(teil)),
  );
  assert.ok(treffer, JSON.stringify(lauf.ergebnis.gruende, null, EINRUECKUNG));
}

function erwarteEinzigenGrund(lauf, ...teile) {
  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, ...teile);
  assert.equal(lauf.ergebnis.gruende.length, 1, lauf.ergebnis.gruende.join("\n"));
}

function probeFaelle({ kopf }) {
  return kopf.rotprobe.faelle.map(({ name, rot }) => [name, rot]);
}

function eigenePruefsumme({ pruefsumme, ...inhalt }) {
  return [pruefsumme, createHash("sha256").update(JSON.stringify(inhalt)).digest("hex")];
}

test("ausmisten-totcode: ein gelöschter Test, dessen Mutanten entfallen oder im Kopf von übrigen Tests getötet werden, ist grün", async (context) => {
  const regeln = [LEER_MUTANT, trimMutant([LEER_TEST, EINGANG_TEST])];
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, regeln });

  erwarteUrteil(lauf, "grün");
  for (const name of ["planen", "basis", "kopf"])
    assert.equal(lauf.laeufe[name].status, EXIT_GRUEN, lauf.laeufe[name].ausgabe);
  assert.deepEqual(lauf.ergebnis.gruende, []);
  assert.deepEqual(lauf.ergebnis.liste, [LEER_TEST]);
  assert.equal(lauf.ergebnis.basis, lauf.repo.master);
  assert.equal(lauf.ergebnis.kopf, lauf.kopfSha);
  assert.deepEqual(Object.values(lauf.basis.mutanten), ["Killed", "Killed"]);
  assert.deepEqual(Object.keys(lauf.kopf.mutanten), [
    `${EINGANG_QUELLE}:2:9-2:20 MethodExpression → text`,
  ]);
  const [geschrieben, berechnet] = eigenePruefsumme(lauf.ergebnis);
  assert.equal(geschrieben, berechnet);
});

test("ausmisten-totcode: ein abgebildeter Mutant, der im Kopf überlebt, ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    regeln: [LEER_MUTANT, trimMutant([LEER_TEST])],
  });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Mutant im Kopf nicht getötet (Survived)", `${EINGANG_QUELLE}:6:9-6:20`);
});

test("ausmisten-totcode: ein Gate-Mutant, den im Kopf nur ein Nicht-Gate-Test tötet, ist rot", async (context) => {
  const gateTest = testDatei(
    "../src/sperre.js",
    "sperrt alte Ziele",
    "assert.equal(modul.alteSperre('+900'), true);",
  );
  const nutzer = testDatei(
    "../src/sperre.js",
    "kennt die Sperre",
    "assert.equal(modul.gesperrt('+900'), true);",
  );
  const regel = {
    datei: SPERRE,
    text: "ziel.startsWith('+900')",
    mutator: "MethodExpression",
    ersatz: "ziel.endsWith('+900')",
    toetend: [GATE_TEST, SPERRE_NUTZER],
  };
  const lauf = await totcodeLauf(context, {
    basis: {
      [SPERRE]: `${ALTE_SPERRE}${SPERRE_TEXT}`,
      [GATE_TEST]: gateTest,
      [ZWEITER_GATE_TEST]: testDatei("../src/sperre.js", "sperrt", "assert.ok(modul.gesperrt);"),
      [SPERRE_NUTZER]: nutzer,
    },
    kopf: { [SPERRE]: SPERRE_TEXT, "tools/gate-tests.json": gateTests([ZWEITER_GATE_TEST]) },
    weg: [GATE_TEST],
    liste: [GATE_TEST, "Denylist"],
    regeln: [regel],
  });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Gate Denylist: Mutant im Kopf nicht getötet (Survived)", SPERRE);
  assert.ok(
    lauf.ergebnis.gruende.every((grund) => grund.startsWith("Gate Denylist: ")),
    lauf.ergebnis.gruende.join("\n"),
  );
  assert.deepEqual(Object.values(lauf.kopf.mutanten), ["Killed"]);
});

test("ausmisten-totcode: ein Fall der gelöschten Datei, der im Kopf grün ist, ist ein lebender Test und rot mit Fallname", async (context) => {
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: BEIDE_FAELLE };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Rotprobe", LEER_TEST, `„${LEBENDER_FALL}“`, "lebender Test");
  assert.equal(lauf.ergebnis.gruende.length, 1, lauf.ergebnis.gruende.join("\n"));
});

test("ausmisten-totcode: ein Ladefehler, weil eine gelöschte Datei unter src/ fehlt, zählt als rot, das Urteil ist grün", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: {
      [LEER_QUELLE]: LEER_FUNKTION,
      [LEER_TEST]: leerTest("../../src/post/leer.js"),
    },
    weg: [LEER_QUELLE, LEER_TEST],
    liste: [LEER_TEST],
    regeln: [{ ...LEER_MUTANT, datei: LEER_QUELLE }],
  });

  erwarteUrteil(lauf, "grün");
  assert.deepEqual(lauf.kopf.rotprobe.verstoesse, []);
  assert.deepEqual(probeFaelle(lauf), [[LEER_TEST, true]]);
});

test("ausmisten-totcode: ein Ladefehler ohne fehlendes Modul unter src/, scripts/ oder tools/ ist rot", async (context) => {
  const fehlt = 'import "../hilfe/fehlt.js";\n';
  const basis = {
    ...TOTER_LEER_TEST.basis,
    [LEER_TEST]: `${fehlt}${leerTest(EINGANG_IMPORT)}`,
  };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Rotprobe", LEER_TEST, "beim Laden", "test/hilfe/fehlt.js");
});

test("ausmisten-totcode: eine mitgelöschte Testhilfe wird für die Rotprobe zurückgelegt, der Fall ist rot statt ein Ladefehler", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: {
      [EINGANG_QUELLE]: MIT_LEER,
      [LEER_HILFE]: `export * from ${JSON.stringify(EINGANG_IMPORT)};\n`,
      [LEER_TEST]: leerTest("../hilfe/leer.js"),
    },
    kopf: { [EINGANG_QUELLE]: EINGANG },
    weg: [LEER_TEST, LEER_HILFE],
    liste: [LEER_TEST, LEER_HILFE],
    regeln: [LEER_MUTANT],
  });

  erwarteUrteil(lauf, "grün");
  assert.deepEqual(probeFaelle(lauf), [[LEER_FALL, true]]);
});

test("ausmisten-totcode: ein Kopf-Ergebnis, das nicht zur Prüfsumme passt, macht entscheiden rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    regeln: [LEER_MUTANT, trimMutant([LEER_TEST])],
  });
  erwarteUrteil(lauf, "rot");
  const datei = join(lauf.daten, "kopf", "kopf.json");
  const kopf = JSON.parse(readFileSync(datei, "utf8"));
  for (const schluessel of Object.keys(kopf.mutanten)) kopf.mutanten[schluessel] = "Killed";
  writeFileSync(datei, `${JSON.stringify(kopf, null, EINRUECKUNG)}\n`);

  const entscheiden = await schritt(lauf, ["entscheiden", "ergebnis"]);

  assert.equal(entscheiden.status, EXIT_ROT, entscheiden.ausgabe);
  const ergebnis = leseStufe(lauf.daten, "ergebnis");
  assert.equal(ergebnis.urteil, "rot");
  assert.deepEqual(ergebnis.gruende, ["kopf.json passt nicht zur Prüfsumme"]);
});

test("ausmisten-totcode: ein fehlender benannter Export aus src/, den es in der Basis gab, zählt als rot, das Urteil ist grün", async (context) => {
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: NAMENS_TEST };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteUrteil(lauf, "grün");
  assert.deepEqual(lauf.kopf.rotprobe.verstoesse, []);
  assert.deepEqual(probeFaelle(lauf), [[LEER_TEST, true]]);
});

test("ausmisten-totcode: ein fehlender Export, den eine neue Datei unter src/ deklariert, ist umgezogener Code und rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    basis: { ...TOTER_LEER_TEST.basis, [LEER_TEST]: NAMENS_TEST },
    kopf: { [EINGANG_QUELLE]: EINGANG, [NEUE_QUELLE]: "export const leer = (text) => !text;\n" },
    regeln: [LEER_MUTANT],
  });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "Code umgezogen", "leer", NEUE_QUELLE);
});

test("ausmisten-totcode: ein gelöschtes Modul, dessen genutzte Namen eine neue Datei unter src/ exportiert, ist umgezogener Code und rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: { [LEER_QUELLE]: LEER_FUNKTION, [LEER_TEST]: leerTest("../../src/post/leer.js") },
    kopf: { [NEUE_QUELLE]: 'export const leer = (eingabe) => eingabe === "";\n' },
    weg: [LEER_QUELLE, LEER_TEST],
    liste: [LEER_TEST],
    regeln: [{ ...LEER_MUTANT, datei: LEER_QUELLE }],
  });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "Code umgezogen", LEER_QUELLE, NEUE_QUELLE);
});

test("ausmisten-totcode: eine neue Datei unter tools/ in einem PR mit Totcode-Liste ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    kopf: { ...TOTER_LEER_TEST.kopf, "tools/neu.mjs": "export const neu = 1;\n" },
    regeln: [LEER_MUTANT],
  });

  assert.equal(lauf.laeufe.planen.status, EXIT_ROT, lauf.laeufe.planen.ausgabe);
  assert.equal(lauf.laeufe.basis, undefined);
  const treffer = lauf.plan.verstoesse.filter(({ datei }) => datei === "tools/neu.mjs");
  assert.equal(treffer.length, 1, JSON.stringify(lauf.plan.verstoesse, null, EINRUECKUNG));
});

test("ausmisten-totcode: ein Mutant in Code, der innerhalb der Datei verschoben wurde, gilt nicht als entfallen und ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    kopf: { [EINGANG_QUELLE]: `${EINGANG}\n${IST_LEER}` },
    regeln: [LEER_MUTANT],
  });

  erwarteEinzigenGrund(lauf, "verschobener Code", `${EINGANG_QUELLE}:2:`);
});

test("ausmisten-totcode: ein Mutant in Code, der in eine andere Datei verschoben wurde, gilt nicht als entfallen und ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    ...TOTER_LEER_TEST,
    kopf: { [EINGANG_QUELLE]: EINGANG, [NEUE_QUELLE]: IST_LEER },
    regeln: [LEER_MUTANT],
  });

  erwarteEinzigenGrund(lauf, "verschobener Code", `${EINGANG_QUELLE}:2:`);
});

test("ausmisten-totcode: ein einzeln entfernter Fall, der im Kopf rot ist, reicht; die übrigen Fälle der Datei zählen nicht", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: { [EINGANG_QUELLE]: MIT_LEER, [LEER_TEST]: BEIDE_FAELLE },
    kopf: { [EINGANG_QUELLE]: EINGANG, [LEER_TEST]: LEBENDER_TEST },
    liste: [`${LEER_TEST}: ${LEER_FALL}`],
    regeln: [LEER_MUTANT],
  });

  erwarteUrteil(lauf, "grün");
  assert.deepEqual(probeFaelle(lauf), [[LEER_FALL, true]]);
});

test("ausmisten-totcode: ein einzeln entfernter Fall, der im Kopf grün ist, ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: { [EINGANG_QUELLE]: MIT_LEER, [LEER_TEST]: BEIDE_FAELLE },
    kopf: { [EINGANG_QUELLE]: EINGANG, [LEER_TEST]: leerTest(EINGANG_IMPORT) },
    liste: [`${LEER_TEST}: ${LEBENDER_FALL}`],
    regeln: [LEER_MUTANT],
  });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, `„${LEBENDER_FALL}“`, "lebender Test");
  assert.deepEqual(probeFaelle(lauf), [[LEBENDER_FALL, false]]);
});

test("ausmisten-totcode: ein Mutant in einem gelöschten Modul, dessen Code umbenannt in eine neue Datei wandert, ist rot", async (context) => {
  const weitere =
    "\nexport function laenge(text) {\n  return text.length;\n}\n\nexport function erstes(text) {\n  return text[0];\n}\n";
  const lauf = await totcodeLauf(context, {
    basis: { [LEER_QUELLE]: LEER_FUNKTION, [LEER_TEST]: leerTest("../../src/post/leer.js") },
    kopf: { [NEUE_QUELLE]: `${IST_LEER}${weitere}` },
    weg: [LEER_QUELLE, LEER_TEST],
    liste: [LEER_TEST],
    regeln: [{ ...LEER_MUTANT, datei: LEER_QUELLE }],
  });

  erwarteEinzigenGrund(lauf, "verschobener Code", `${LEER_QUELLE}:2:`);
  assert.deepEqual(lauf.kopf.rotprobe.verstoesse, []);
});

test("ausmisten-totcode: ein Ladefehler an einem Modul unter src/, das der PR nicht löscht, ist rot", async (context) => {
  const fehlt = 'import "../../src/post/fehlt.js";\n';
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: `${fehlt}${leerTest(EINGANG_IMPORT)}` };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "src/post/fehlt.js", "löscht es nicht");
});

test("ausmisten-totcode: ein übersprungener Fall der gelöschten Datei ist in der Rotprobe rot", async (context) => {
  const ruht = 'test.skip("ruht", () => {});\n';
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: leerTest(EINGANG_IMPORT, ruht) };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "„ruht“", "übersprungen");
});

test("ausmisten-totcode: eine gelöschte Datei, die im Kopf keinen Fall liefert, ist rot", async (context) => {
  const ohneFall = `import * as modul from ${JSON.stringify(EINGANG_IMPORT)};\n\nmodul.leer("");\n`;
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: ohneFall };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteUrteil(lauf, "rot");
  erwarteGrund(lauf, "Rotprobe", LEER_TEST);
});

test("ausmisten-totcode: ein fehlender Export, den es in der Basis nicht gab, ist rot", async (context) => {
  const nieTest = NAMENS_TEST.replace("import { leer }", "import { leer, nie }");
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: nieTest };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "nie", "in der Basis nicht");
});

test("ausmisten-totcode: ein Rotprobe-Lauf, der nicht regulär endet, ist rot", async (context) => {
  const abbruch = 'test("bricht ab", () => {\n  process.kill(process.ppid, "SIGKILL");\n});\n';
  const basis = { ...TOTER_LEER_TEST.basis, [LEER_TEST]: leerTest(EINGANG_IMPORT, abbruch) };
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, basis, regeln: [LEER_MUTANT] });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "nicht regulär");
});

test("ausmisten-totcode: ein zweites fehlendes Modul außerhalb von src/ hinter einem gelöschten Modul ist rot", async (context) => {
  const lauf = await totcodeLauf(context, {
    basis: {
      [LEER_QUELLE]: LEER_FUNKTION,
      [LEER_TEST]: `${leerTest("../../src/post/leer.js")}import "../hilfe/fehlt.js";\n`,
    },
    weg: [LEER_QUELLE, LEER_TEST],
    liste: [LEER_TEST],
    regeln: [{ ...LEER_MUTANT, datei: LEER_QUELLE }],
  });

  erwarteEinzigenGrund(lauf, "Rotprobe", LEER_TEST, "test/hilfe/fehlt.js");
});

const SHA_LAENGE = 40;
const SHA256_HEX_LAENGE = 64;
const FALSCHE_PRUEFSUMME = "0".repeat(SHA256_HEX_LAENGE);

function summeDer(daten, name) {
  return createHash("sha256")
    .update(readFileSync(join(daten, name, `${name}.json`)))
    .digest("hex");
}

function paketSchritt(lauf, { befehl, paket, summen = {} }) {
  const name = `${befehl}-${paket}`;
  const args = [befehl, "--daten", lauf.daten, "--paket", paket, "--aus", join(lauf.daten, name)];
  const umgebung = { ...lauf.umgebung, ...lauf.summen, ...summen };
  return starte("tools/tests-ausmisten/totcode.mjs", { args, cwd: lauf.repo.ordner, umgebung });
}

test("ausmisten-totcode: mit --paket misst jeder Schritt nur sein Paket aus dem Plan, die Rotprobe ist ein eigener Schritt", async (context) => {
  const regeln = [LEER_MUTANT, trimMutant([LEER_TEST, EINGANG_TEST])];
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, regeln });
  assert.deepEqual(
    lauf.plan.pakete.map(({ dateien }) => dateien),
    [[EINGANG_QUELLE]],
  );
  assert.equal(ausgabenAus(join(lauf.daten, "plan.txt")).pakete, "[0]");

  const basis = await paketSchritt(lauf, { befehl: "basis", paket: "0" });
  assert.equal(basis.status, EXIT_GRUEN, basis.ausgabe);
  const basisSumme = summeDer(lauf.daten, "basis-0");
  assert.ok(basis.ausgabe.includes(pruefsummenZeile(0, basisSumme)), basis.ausgabe);
  const basisTeil = leseStufe(lauf.daten, "basis-0");
  assert.equal(basisTeil.paket, 0);
  assert.deepEqual(basisTeil.dateien, [EINGANG_QUELLE]);
  assert.deepEqual(basisTeil.mutanten, lauf.basis.mutanten);

  const summen = { BASIS_PRUEFSUMME: basisSumme };
  const kopf = await paketSchritt(lauf, { befehl: "kopf", paket: "0", summen });
  assert.equal(kopf.status, EXIT_GRUEN, kopf.ausgabe);
  const kopfSumme = summeDer(lauf.daten, "kopf-0");
  assert.ok(kopf.ausgabe.includes(pruefsummenZeile(0, kopfSumme, "kopf")), kopf.ausgabe);
  const kopfTeil = leseStufe(lauf.daten, "kopf-0");
  assert.deepEqual(kopfTeil.mutanten, lauf.kopf.mutanten);
  assert.equal(kopfTeil.rotprobe, undefined);

  const probe = await schritt(lauf, ["rotprobe", "rotprobe"]);
  assert.equal(probe.status, EXIT_GRUEN, probe.ausgabe);
  const rotprobe = leseStufe(lauf.daten, "rotprobe");
  assert.equal(rotprobe.art, "totcode-rotprobe");
  assert.deepEqual(rotprobe.faelle, lauf.kopf.rotprobe.faelle);

  const fremd = await paketSchritt(lauf, { befehl: "kopf", paket: "1", summen });
  assert.equal(fremd.status, EXIT_ROT, fremd.ausgabe);
  assert.match(fremd.ausgabe, /Paket 1 steht nicht im Plan/);
  const falsch = await paketSchritt(lauf, {
    befehl: "kopf",
    paket: "0",
    summen: { BASIS_PRUEFSUMME: FALSCHE_PRUEFSUMME },
  });
  assert.equal(falsch.status, EXIT_ROT, falsch.ausgabe);
  assert.match(falsch.ausgabe, /basis-0\.json passt nicht zur Prüfsumme/);
});

function probeSystem(zusatz, schritte) {
  return {
    legeBenutzerAn: () => schritte.push("Benutzer angelegt"),
    uebergib: () => schritte.push("übergeben"),
    teileKanal: (kanal) =>
      schritte.push(`Kanal ${(statSync(kanal).mode & RECHTE).toString(OKTAL)}`),
    starte(befehl, { cwd: ordner, umgebung, stdio }) {
      schritte.push({ befehl, umgebung });
      const [programm, ...args] = befehl;
      return spawn(programm, args, { cwd: ordner, stdio, env: { ...zusatz, ...umgebung } });
    },
    beendeAlle: () => schritte.push("alle beendet"),
    raeumeAuf: (ordner) => rmSync(ordner, { recursive: true, force: true }),
  };
}

async function untrautIn(context, { ordner, umgebung, auftrag, system }) {
  const vorher = {
    verzeichnis: cwd(),
    werte: Object.keys(umgebung).map((name) => [name, env[name]]),
  };
  const zeilen = [];
  const ausgabe = context.mock.method(console, "log", (zeile) => zeilen.push(zeile));
  Object.assign(env, umgebung);
  chdir(ordner);
  try {
    return { ergebnis: await untraut(auftrag, system).catch((fehler) => fehler), zeilen };
  } finally {
    chdir(vorher.verzeichnis);
    for (const [name, wert] of vorher.werte)
      if (wert === undefined) delete env[name];
      else env[name] = wert;
    ausgabe.mock.restore();
  }
}

test("ausmisten-totcode: als eigener Benutzer liefert der Kopf eines Pakets sein Ergebnis nur über den Kanal, die Prüfsumme kommt erst nach dem Beenden aller Prozesse", async (context) => {
  const regeln = [LEER_MUTANT, trimMutant([LEER_TEST, EINGANG_TEST])];
  const lauf = await totcodeLauf(context, { ...TOTER_LEER_TEST, regeln });
  const basis = await paketSchritt(lauf, { befehl: "basis", paket: "0" });
  assert.equal(basis.status, EXIT_GRUEN, basis.ausgabe);
  const aus = join(lauf.daten, "kopf-0");
  const schritte = [];
  const ausgabe = join(lauf.daten, "untraut.txt");
  writeFileSync(ausgabe, "");
  const umgebung = {
    PLAN_PRUEFSUMME: lauf.summen.PLAN_PRUEFSUMME,
    BASIS_PRUEFSUMME: summeDer(lauf.daten, "basis-0"),
    GITHUB_OUTPUT: ausgabe,
  };
  const zusatz = { ...isolatedEnvironment(), ...lauf.umgebung };
  const { ergebnis, zeilen } = await untrautIn(context, {
    ordner: lauf.repo.ordner,
    umgebung,
    auftrag: { schritt: "kopf", daten: lauf.daten, paket: "0", aus },
    system: probeSystem(zusatz, schritte),
  });

  assert.equal(ergebnis, EXIT_GRUEN, `${ergebnis?.stack ?? ""}\n${zeilen.join("\n")}`);
  const kopfTeil = leseStufe(lauf.daten, "kopf-0");
  assert.deepEqual(kopfTeil.mutanten, lauf.kopf.mutanten);
  const summe = summeDer(lauf.daten, "kopf-0");
  assert.equal(ausgabenAus(ausgabe).pruefsumme, summe);
  const summenZeile = zeilen.indexOf(pruefsummenZeile(0, summe, "kopf"));
  assert.ok(summenZeile >= 0, zeilen.join("\n"));
  assert.ok(
    zeilen.slice(0, summenZeile).every((zeile) => zeile.startsWith(PROTOKOLL_VORSATZ)),
    zeilen.join("\n"),
  );
  const start = schritte.findIndex((eintrag) => eintrag.befehl !== undefined);
  assert.deepEqual(schritte.slice(0, start), [
    "Benutzer angelegt",
    "übergeben",
    "übergeben",
    "Kanal 620",
  ]);
  assert.deepEqual(schritte.slice(start + 1), ["alle beendet"]);
  const { befehl, umgebung: kindUmgebung } = schritte[start];
  assert.deepEqual(befehl.slice(befehl.indexOf("--kanal") - 1, -1), ["0", "--kanal"]);
  assert.deepEqual(
    Object.keys(kindUmgebung).sort(),
    ["BASIS_PRUEFSUMME", "HOME", "LANG", "NODE_ENV", "PATH", "PLAN_PRUEFSUMME", "TMPDIR"].filter(
      (name) => name !== "LANG" || env.LANG !== undefined,
    ),
  );
});

const PLAN_SHA = { basis: "1".repeat(SHA_LAENGE), kopf: "2".repeat(SHA_LAENGE) };

function geschriebenerPlan(context) {
  const plan = { art: "totcode-plan", ...PLAN_SHA, pakete: [{ dateien: [EINGANG_QUELLE] }] };
  const text = `${JSON.stringify(plan, null, EINRUECKUNG)}\n`;
  const daten = probeDirectory(context, { "plan/plan.json": text });
  return { daten, summe: createHash("sha256").update(text).digest("hex") };
}

function kanalSchreiber(text, { exit = 0, ausgabe = "" } = {}, schritte = []) {
  const system = probeSystem({}, schritte);
  system.starte = (befehl, { cwd: ordner, stdio }) => {
    const kanal = befehl[befehl.indexOf("--kanal") + 1];
    const skript = `process.stdout.write(process.argv[4]); require("node:fs").writeFileSync(process.argv[1], process.argv[2]); process.exit(Number(process.argv[3]));`;
    const args = ["-e", skript, kanal, text, String(exit), ausgabe];
    return spawn(execPath, args, { cwd: ordner, stdio });
  };
  return system;
}

const KOPF_ZEILE = `${JSON.stringify({ art: "totcode-kopf", ...PLAN_SHA, paket: 0, dateien: [EINGANG_QUELLE], teil: null, mutanten: {} })}\n`;

test("ausmisten-totcode: eine zweite oder unlesbare Ergebniszeile, ein fremdes Ergebnis oder ein Abbruch als eigener Benutzer schreibt keine Stufe", async (context) => {
  const repo = ausmistenRepo(context);
  const { daten, summe } = geschriebenerPlan(context);
  const aus = join(daten, "kopf-0");
  const faelle = [
    [`${KOPF_ZEILE}${KOPF_ZEILE}`, 0, /enthält 2 Zeilen, erwartet ist genau eine/],
    ["", 0, /enthält 0 Zeilen/],
    ["kein JSON\n", 0, /Ergebniszeile im Ergebniskanal ist unlesbar/],
    [KOPF_ZEILE.replace('"paket":0', '"paket":1'), 0, /gehört nicht zu dieser Messung/],
    [KOPF_ZEILE, 3, /endete mit Exit 3/],
  ];
  for (const [text, exit, fehler] of faelle) {
    const schritte = [];
    const { ergebnis, zeilen } = await untrautIn(context, {
      ordner: repo.ordner,
      umgebung: { PLAN_PRUEFSUMME: summe },
      auftrag: { schritt: "kopf", daten, paket: "0", aus },
      system: kanalSchreiber(text, { exit }, schritte),
    });
    assert.match(ergebnis?.message ?? "", fehler, String(ergebnis));
    assert.ok(schritte.includes("alle beendet"), JSON.stringify(schritte));
    assert.equal(existsSync(aus), false);
    assert.ok(!zeilen.some((zeile) => zeile.includes("Prüfsumme")), zeilen.join("\n"));
  }

  const { ergebnis } = await untrautIn(context, {
    ordner: repo.ordner,
    umgebung: { PLAN_PRUEFSUMME: summe },
    auftrag: { schritt: "kopf", daten, paket: "0", aus },
    system: kanalSchreiber(KOPF_ZEILE),
  });
  assert.equal(ergebnis, EXIT_GRUEN, String(ergebnis?.stack));
  assert.deepEqual(leseStufe(daten, "kopf-0"), JSON.parse(KOPF_ZEILE));
});

const KOPF_AUFTRAG = { schritt: "kopf", paket: "0", name: "kopf-0" };
const ROTPROBE_AUFTRAG = { schritt: "rotprobe", name: "rotprobe" };
const ROTPROBE_ZEILE = `${JSON.stringify({ art: "totcode-rotprobe", ...PLAN_SHA, faelle: [], verstoesse: [] })}\n`;

async function alsBenutzer(context, system, { schritt, paket, name } = KOPF_AUFTRAG) {
  const repo = ausmistenRepo(context);
  const { daten, summe } = geschriebenerPlan(context);
  const lauf = await untrautIn(context, {
    ordner: repo.ordner,
    umgebung: { PLAN_PRUEFSUMME: summe },
    auftrag: { schritt, daten, paket, aus: join(daten, name) },
    system,
  });
  return { ...lauf, daten };
}

test("ausmisten-totcode: die Ausgabe des eigenen Benutzers erscheint nur mit Vorsatz und ohne Steuerzeichen, ein Workflow-Befehl hinter einem Wagenrücklauf wird keiner", async (context) => {
  const ausgabe = "Messung\r::set-output name=pruefsumme::gefaelscht\nzwei\u0007\r\n";
  const { ergebnis, zeilen } = await alsBenutzer(context, kanalSchreiber(KOPF_ZEILE, { ausgabe }));

  assert.equal(ergebnis, EXIT_GRUEN, String(ergebnis?.stack));
  const gezeigt = zeilen.filter((zeile) => zeile.startsWith(PROTOKOLL_VORSATZ));
  assert.deepEqual(gezeigt, [
    `${PROTOKOLL_VORSATZ}Messung`,
    `${PROTOKOLL_VORSATZ}::set-output name=pruefsumme::gefaelscht`,
    `${PROTOKOLL_VORSATZ}zwei `,
  ]);
  assert.equal(zeilen.length, gezeigt.length + 1, zeilen.join("\n"));
});

test("ausmisten-totcode: bricht die Messung als eigener Benutzer ab, erscheint ihre Ausgabe trotzdem mit Vorsatz", async (context) => {
  const { ergebnis, zeilen } = await alsBenutzer(
    context,
    kanalSchreiber("", { exit: 3, ausgabe: "Messung brach ab\n" }),
  );

  assert.match(ergebnis?.message ?? "", /endete mit Exit 3/, String(ergebnis));
  assert.deepEqual(zeilen, [`${PROTOKOLL_VORSATZ}Messung brach ab`]);
});

test("ausmisten-totcode: als eigener Benutzer nimmt die Rotprobe nur eine Ergebniszeile der Rotprobe an", async (context) => {
  const fremd = await alsBenutzer(context, kanalSchreiber(KOPF_ZEILE), ROTPROBE_AUFTRAG);
  assert.match(
    fremd.ergebnis?.message ?? "",
    /gehört nicht zu dieser Messung/,
    String(fremd.ergebnis),
  );
  assert.equal(leseStufe(fremd.daten, "rotprobe"), undefined);

  const passend = await alsBenutzer(context, kanalSchreiber(ROTPROBE_ZEILE), ROTPROBE_AUFTRAG);
  assert.equal(passend.ergebnis, EXIT_GRUEN, String(passend.ergebnis?.stack));
  assert.deepEqual(leseStufe(passend.daten, "rotprobe"), JSON.parse(ROTPROBE_ZEILE));
});

test("ausmisten-totcode: kopf und rotprobe brechen ab, wenn nicht genau eines von --aus und --kanal genannt ist", async (context) => {
  const repo = ausmistenRepo(context);
  const { daten } = geschriebenerPlan(context);
  const beide = ["--aus", join(daten, "ziel"), "--kanal", join(daten, "kanal")];
  for (const befehl of ["kopf", "rotprobe"])
    for (const ziel of [[], beide]) {
      const lauf = await starte("tools/tests-ausmisten/totcode.mjs", {
        args: [befehl, "--daten", daten, ...ziel],
        cwd: repo.ordner,
        umgebung: { NODE_ENV: "test" },
      });
      assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
      assert.match(lauf.ausgabe, /Abbruch: Genau eins von --aus und --kanal angeben\./);
      assert.equal(existsSync(join(daten, "ziel")), false);
    }
});

const SUDO_ATTRAPPE = [
  "#!/bin/sh",
  'ordner=$(dirname "$0")',
  'printf "%s\\n" "$*" >> "$ordner/aufrufe.txt"',
  'if [ -f "$ordner/$2" ]; then',
  '  ende=$(head -n 1 "$ordner/$2")',
  '  tail -n +2 "$ordner/$2" > "$ordner/rest" && mv "$ordner/rest" "$ordner/$2"',
  '  exit "$ende"',
  "fi",
  "",
].join("\n");
const AUSFUEHRBAR = 0o755;
const PKILL_TRAF = 0;
const PKILL_KEINER = 1;
const PKILL_FEHLER = 2;

async function mitAttrappe(ordner, aufgabe) {
  const vorher = env.PATH;
  env.PATH = `${ordner}:${vorher}`;
  try {
    return await aufgabe();
  } finally {
    env.PATH = vorher;
  }
}

test("ausmisten-totcode: der Runner startet untrauten Code nur per sudo als eigener Benutzer mit leerer Umgebung und beendet danach jeden seiner Prozesse", async (context) => {
  const ordner = probeDirectory(context, {
    sudo: SUDO_ATTRAPPE,
    pkill: `${PKILL_TRAF}\n${PKILL_KEINER}\n`,
  });
  chmodSync(join(ordner, "sudo"), AUSFUEHRBAR);
  const umgebung = { HOME: "/heim", NODE_ENV: "test" };
  await mitAttrappe(ordner, async () => {
    RUNNER_SYSTEM.legeBenutzerAn();
    RUNNER_SYSTEM.uebergib("/arbeit");
    RUNNER_SYSTEM.teileKanal("/kanal");
    const kind = RUNNER_SYSTEM.starte(["node", "messung.mjs"], {
      cwd: ordner,
      umgebung,
      stdio: "ignore",
    });
    assert.deepEqual(await once(kind, "exit"), [0, null]);
    RUNNER_SYSTEM.beendeAlle();
  });

  assert.deepEqual(readFileSync(join(ordner, "aufrufe.txt"), "utf8").trim().split("\n"), [
    `-n useradd --system --user-group --no-create-home ${BENUTZER}`,
    `-n chown -R --no-dereference ${BENUTZER}: /arbeit`,
    `-n chown --no-dereference :${BENUTZER} /kanal`,
    `-n -u ${BENUTZER} -- env -i HOME=/heim NODE_ENV=test node messung.mjs`,
    `-n pkill -KILL -u ${BENUTZER}`,
    `-n pkill -KILL -u ${BENUTZER}`,
  ]);
  writeFileSync(join(ordner, "pkill"), `${PKILL_FEHLER}\n`);
  await mitAttrappe(ordner, () =>
    assert.throws(() => RUNNER_SYSTEM.beendeAlle(), {
      message: `pkill -u ${BENUTZER} endete mit Exit ${PKILL_FEHLER}.`,
    }),
  );
});
