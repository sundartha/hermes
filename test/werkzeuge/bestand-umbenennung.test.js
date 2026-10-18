import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { commitAll, isolatedEnvironment, probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const SCRIPT = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const BESTAENDE = join(REPO_ROOT, "tools/abhaengigkeiten/bestaende.mjs");
const RUECKFUEHRUNG = join(REPO_ROOT, "tools/bestand-rueckfuehrung.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXECUTABLE_MODE = 0o755;
const CREATE = "--basis-anlegen";
const BASIS = ["--basis", "HEAD"];
const NICHT_AUF_DER_BASIS = "nicht auf der Basis";
const NUR_MIT_FREIGABE = "kommt nur mit Freigabe (Approve eines Code-Owners) durch";
const BASISLINIE_FEHLT = "gibt es auf der Basis";
const ANDERE_VERSION = "0.0.0";
const ANDERE_VERSION_MELDUNG = "gilt für eine andere Version als auf der Basis";
const UNGEMELDETER_EINTRAG = "src/eins.js|src/zwei.js|999";
const REPO_JSCPD_CONFIG = readFileSync(join(REPO_ROOT, ".jscpd.json"), "utf8");
const REPO_KNIP_CONFIG = readFileSync(join(REPO_ROOT, "knip.json"), "utf8");
const BLOCK = `export function summe(werte) {
  let ergebnis = 0;
  for (const wert of werte) ergebnis += wert * 2 + 1;
  const mittel = ergebnis / werte.length;
  return { ergebnis, mittel, anzahl: werte.length, leer: werte.length === 0 };
}
`;
const BLOCK_MIT_TYPEN = BLOCK.replace("summe(werte)", "summe(werte: number[])");
const BLOCK_GEAENDERT = BLOCK_MIT_TYPEN.replace("wert * 2", "wert * 3");
const JSCPD = { ".jscpd.json": REPO_JSCPD_CONFIG, "src/eins.js": BLOCK, "src/zwei.js": BLOCK };
const KNIP = {
  "knip.json": REPO_KNIP_CONFIG,
  "package.json": '{"name":"probe","type":"module"}',
  "src/server.js": 'import { genutzt } from "./teil.js";\nconsole.log(genutzt);\n',
  "src/teil.js": "export const genutzt = 1;\nexport function alt(wert) {\n  return wert + 1;\n}\n",
};
const INJECTION = "export const lauf = (befehl) => exec(befehl);\n";
const FAKE_SEMGREP = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) return console.log("1.0.0");
const found = (path, text = fs.readFileSync(path, "utf8")) => [...text.matchAll(/exec\\(/g)].map(({ index }) => ({ check_id: "probe", path, start: { line: 1, offset: index }, end: { offset: index + 5 } }));
console.log(JSON.stringify({ errors: [], results: fs.readdirSync("src").flatMap((name) => found("src/" + name)) }));
`;
const SEMGREP = { "bin/semgrep": FAKE_SEMGREP, "src/befehl.js": INJECTION };
const ORDNER = { "src/eins.js": BLOCK, "tools/basis/.gitkeep": "" };
const SELBSTPRUEFUNG = `import assert from "node:assert/strict";
import { test } from "node:test";
test("immer", () => {
  assert.ok(true);
});
`;
const SELBST = {
  "eslint.config.js": 'export default [{ files: ["test/**/*.{js,ts}"] }];\n',
  "test/alt.test.js": SELBSTPRUEFUNG,
};

function environmentFor(directory) {
  return {
    ...isolatedEnvironment(),
    PATH: `${join(directory, "bin")}${delimiter}${process.env.PATH}`,
  };
}

function run(directory, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: environmentFor(directory),
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

function expectStatus(result, status, shows) {
  assert.equal(result.status, status, result.output);
  if (shows !== undefined) assert.ok(result.output.includes(shows), result.output);
}

function expectHeldForApproval(result, entry = NICHT_AUF_DER_BASIS) {
  expectStatus(result, EXIT_OK, NUR_MIT_FREIGABE);
  assert.ok(result.output.includes(entry), result.output);
}

function baselinePath(directory, tool) {
  return join(directory, `tools/basis/${tool}.json`);
}

function typescriptPath(path) {
  return path.replace(/\.js$/, ".ts");
}

function moveEntries(directory, tool, from) {
  const path = baselinePath(directory, tool);
  writeFileSync(path, readFileSync(path, "utf8").replaceAll(from, typescriptPath(from)));
}

function frozen(context, files, tool) {
  const directory = probeRepository(context, files);
  if (files === SEMGREP) chmodSync(join(directory, "bin/semgrep"), EXECUTABLE_MODE);
  expectStatus(run(directory, [tool, CREATE]), EXIT_OK);
  commitAll(directory, "Basislinie");
  return directory;
}

function rename(directory, from, content) {
  rmSync(join(directory, from));
  writeFileSync(join(directory, typescriptPath(from)), content);
}

test("bestand-umbenennung: eine Kopie zwischen .js und .ts ist mit der Konfiguration des Repos rot", (context) => {
  const directory = frozen(
    context,
    { ...JSCPD, "src/zwei.js": "export const anderes = 1;\n" },
    "jscpd",
  );
  writeFileSync(join(directory, "src/zwei.ts"), BLOCK_MIT_TYPEN);
  expectStatus(run(directory, ["jscpd"]), EXIT_FINDING, "src/zwei.ts");
});

test("bestand-umbenennung: jscpd mit --basis, Umbenennung nur mit Typen und verschobenem Eintrag ist grün", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  rename(directory, "src/zwei.js", BLOCK_MIT_TYPEN);
  moveEntries(directory, "jscpd", "src/zwei.js");
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_OK);
});

test("bestand-umbenennung: jscpd mit --basis, verschobener Eintrag bei geänderter Rechnung geht nur über die Freigabe", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  rename(directory, "src/zwei.js", BLOCK_GEAENDERT);
  moveEntries(directory, "jscpd", "src/zwei.js");
  expectHeldForApproval(run(directory, ["jscpd", ...BASIS]));
});

test("bestand-umbenennung: jscpd mit --basis, verschobener Eintrag ohne Umbenennung ist rot", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  writeFileSync(join(directory, "src/zwei.ts"), BLOCK_MIT_TYPEN);
  moveEntries(directory, "jscpd", "src/zwei.js");
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_FINDING, NICHT_AUF_DER_BASIS);
});

test("bestand-umbenennung: jscpd mit --basis, ein nicht verschobener Eintrag deckt die umbenannte Datei nicht", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  rename(directory, "src/zwei.js", BLOCK_MIT_TYPEN);
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_FINDING, "neue Befunde von jscpd");
});

function addEntries(directory, tool, keys) {
  const path = baselinePath(directory, tool);
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...baseline, befunde: [...baseline.befunde, ...keys] }));
}

function jscpdKeys(directory) {
  return JSON.parse(readFileSync(baselinePath(directory, "jscpd"), "utf8")).befunde;
}

test("bestand-umbenennung: jscpd mit --basis, eine neue Kopie in einer .js-Datei einzufrieren geht nur über die Freigabe", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  writeFileSync(join(directory, "src/drei.js"), BLOCK);
  const neu = run(directory, ["jscpd"]);
  assert.equal(neu.status, EXIT_FINDING, neu.output);
  rmSync(baselinePath(directory, "jscpd"));
  expectStatus(run(directory, ["jscpd", CREATE]), EXIT_OK);
  assert.ok(jscpdKeys(directory).some((key) => key.includes("src/drei.js")));
  commitAll(directory, "eingefroren");
  expectHeldForApproval(run(directory, ["jscpd", "--basis", "HEAD~1"]));
});

test("bestand-umbenennung: jscpd mit --basis, ein Eintrag ohne heutigen Befund in unveränderten Dateien geht nur über die Freigabe", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  addEntries(directory, "jscpd", [UNGEMELDETER_EINTRAG]);
  expectHeldForApproval(run(directory, ["jscpd", ...BASIS]), UNGEMELDETER_EINTRAG);
});

test("bestand-umbenennung: jscpd mit --basis, ohne Basislinie auf der Basis entfällt der Vergleich nur dort", (context) => {
  const directory = probeRepository(context, JSCPD);
  expectStatus(run(directory, ["jscpd", CREATE]), EXIT_OK);
  commitAll(directory, "Basislinie");
  addEntries(directory, "jscpd", [UNGEMELDETER_EINTRAG]);
  expectStatus(run(directory, ["jscpd", "--basis", "HEAD~1"]), EXIT_OK, BASISLINIE_FEHLT);
  expectHeldForApproval(run(directory, ["jscpd", ...BASIS]));
});

test("bestand-umbenennung: jscpd mit --basis, nur nach einem echten Versionswechsel entfällt der Vergleich", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  const path = baselinePath(directory, "jscpd");
  const aktuell = readFileSync(path, "utf8");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(aktuell), version: ANDERE_VERSION }));
  commitAll(directory, "Basislinie einer anderen Version");
  writeFileSync(path, aktuell);
  addEntries(directory, "jscpd", [UNGEMELDETER_EINTRAG]);
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_OK, ANDERE_VERSION_MELDUNG);
  expectHeldForApproval(run(directory, ["jscpd", "--basis", "HEAD~1"]));
});

test("bestand-umbenennung: jscpd mit --basis, eine erst mit der neuen Einstellung gefundene Kopie in unveränderten Dateien darf eingefroren werden", (context) => {
  const ohneFormatgrenze = { ...JSON.parse(REPO_JSCPD_CONFIG), crossFormats: [] };
  const directory = frozen(
    context,
    {
      ...JSCPD,
      ".jscpd.json": JSON.stringify(ohneFormatgrenze),
      "src/zwei.js": "export const anderes = 1;\n",
      "src/zwei.ts": BLOCK_MIT_TYPEN,
    },
    "jscpd",
  );
  assert.deepEqual(jscpdKeys(directory), []);
  writeFileSync(join(directory, ".jscpd.json"), REPO_JSCPD_CONFIG);
  rmSync(baselinePath(directory, "jscpd"));
  expectStatus(run(directory, ["jscpd", CREATE]), EXIT_OK);
  assert.equal(jscpdKeys(directory).length, 1);
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_OK, "die Prüfung findet mehr");
});

function neuerOrdner(context, tool, { datei, eintrag }) {
  const directory = frozen(context, ORDNER, tool);
  mkdirSync(join(directory, dirname(datei)), { recursive: true });
  writeFileSync(join(directory, datei), BLOCK);
  addEntries(directory, tool, [eintrag]);
  return run(directory, [tool, ...BASIS]);
}

test("bestand-umbenennung: wurzel mit --basis, ein neuer Ordner in der Wurzel geht nur über die Freigabe", (context) => {
  const eintrag = "neu|wurzel-eintrag";
  const result = neuerOrdner(context, "wurzel", { datei: "neu/teil.js", eintrag });
  expectHeldForApproval(result);
});

test("bestand-umbenennung: anweisungen mit --basis, ein neuer Ordner unter src ohne eigene Regeln geht nur über die Freigabe", (context) => {
  const eintrag = "src/neu|ohne-eigene-regeln";
  const result = neuerOrdner(context, "anweisungen", { datei: "src/neu/teil.js", eintrag });
  expectHeldForApproval(result);
});

test("bestand-umbenennung: --basis mit einem unbekannten Commit bricht ab", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  expectStatus(
    run(directory, ["jscpd", "--basis", "gibt-es-nicht"]),
    EXIT_FINDING,
    "gibt-es-nicht",
  );
});

test("bestand-umbenennung: --basis lässt sich nicht mit --basis-kuerzen verbinden", (context) => {
  const directory = frozen(context, JSCPD, "jscpd");
  expectStatus(run(directory, ["jscpd", "--basis-kuerzen", ...BASIS]), EXIT_FINDING, "Aufruf:");
});

test("bestand-umbenennung: eine ungenutzte .ts-Datei ist mit der Konfiguration des Repos rot (knip)", (context) => {
  const directory = frozen(context, KNIP, "knip");
  writeFileSync(join(directory, "src/neu.ts"), "export const neu: number = 1;\n");
  expectStatus(run(directory, ["knip"]), EXIT_FINDING, "src/neu.ts");
});

test("bestand-umbenennung: knip mit --basis, Umbenennung nur mit Typen und verschobenem Eintrag ist grün", (context) => {
  const directory = frozen(context, KNIP, "knip");
  const typed = KNIP["src/teil.js"].replace("alt(wert)", "alt(wert: number): number");
  rename(directory, "src/teil.js", typed);
  writeFileSync(
    join(directory, "src/server.js"),
    KNIP["src/server.js"].replace("./teil.js", "./teil.ts"),
  );
  moveEntries(directory, "knip", "src/teil.js");
  expectStatus(run(directory, ["knip", ...BASIS]), EXIT_OK);
});

test("bestand-umbenennung: knip mit --basis, eine ungenutzte Datei nur mit Typen umbenannt und verschoben ist grün", (context) => {
  const directory = frozen(
    context,
    { ...KNIP, "src/ungenutzt.js": "export const wert = true;\n" },
    "knip",
  );
  rename(directory, "src/ungenutzt.js", "export const wert: boolean = true;\n");
  moveEntries(directory, "knip", "src/ungenutzt.js");
  expectStatus(run(directory, ["knip", ...BASIS]), EXIT_OK);
});

test("bestand-umbenennung: knip mit --basis, verschobener Eintrag bei geändertem Code geht nur über die Freigabe", (context) => {
  const directory = frozen(context, KNIP, "knip");
  const changed = KNIP["src/teil.js"]
    .replace("alt(wert)", "alt(wert: number): number")
    .replace("+ 1", "+ 2");
  rename(directory, "src/teil.js", changed);
  writeFileSync(
    join(directory, "src/server.js"),
    KNIP["src/server.js"].replace("./teil.js", "./teil.ts"),
  );
  moveEntries(directory, "knip", "src/teil.js");
  expectHeldForApproval(run(directory, ["knip", ...BASIS]));
});

test("bestand-umbenennung: knip mit --basis, ein neuer Eintrag in einer unveränderten Datei, den eine Änderung anderswo auslöst, geht nur über die Freigabe", (context) => {
  const directory = frozen(context, KNIP, "knip");
  writeFileSync(
    join(directory, "src/server.js"),
    KNIP["src/server.js"].replaceAll("genutzt", "alt"),
  );
  rmSync(baselinePath(directory, "knip"));
  expectStatus(run(directory, ["knip", CREATE]), EXIT_OK);
  expectHeldForApproval(run(directory, ["knip", ...BASIS]));
});

test("bestand-umbenennung: semgrep mit --basis, Umbenennung nur mit Typen und verschobenem Eintrag ist grün", (context) => {
  const directory = frozen(context, SEMGREP, "semgrep");
  rename(directory, "src/befehl.js", INJECTION.replace("(befehl)", "(befehl: string)"));
  moveEntries(directory, "semgrep", "src/befehl.js");
  expectStatus(run(directory, ["semgrep", ...BASIS]), EXIT_OK);
});

test("bestand-umbenennung: semgrep mit --basis, verschobener Eintrag bei geändertem Code geht nur über die Freigabe", (context) => {
  const directory = frozen(context, SEMGREP, "semgrep");
  rename(
    directory,
    "src/befehl.js",
    INJECTION.replace("(befehl)", "(befehl: string)").replace("lauf", "start"),
  );
  moveEntries(directory, "semgrep", "src/befehl.js");
  expectHeldForApproval(run(directory, ["semgrep", ...BASIS]));
});

test("bestand-umbenennung: Testbestand mit --basis, umbenannte Testdatei nur mit Typen und verschobenem Eintrag ist grün", (context) => {
  const directory = frozen(context, SELBST, "selbstpruefung");
  rename(directory, "test/alt.test.js", SELBSTPRUEFUNG);
  moveEntries(directory, "selbstpruefung", "test/alt.test.js");
  expectStatus(run(directory, ["selbstpruefung", ...BASIS]), EXIT_OK);
});

test("bestand-umbenennung: Testbestand mit --basis, verschobener Eintrag bei geändertem Test geht nur über die Freigabe", (context) => {
  const directory = frozen(context, SELBST, "selbstpruefung");
  rename(directory, "test/alt.test.js", SELBSTPRUEFUNG.replace('"immer"', '"anders"'));
  moveEntries(directory, "selbstpruefung", "test/alt.test.js");
  expectHeldForApproval(run(directory, ["selbstpruefung", ...BASIS]));
});

const ALT = "test/alt.test.js|0123456789abcdef";
const VERSCHOBEN = "test/alt.test.ts|0123456789abcdef";

function bestaendeNachUmbenennung(context, inhalt) {
  const liste = (eintrag) => `${JSON.stringify({ befunde: [eintrag] })}\n`;
  const directory = probeRepository(context, {
    "tools/basis/selbstpruefung.json": liste(ALT),
    "test/alt.test.js": SELBSTPRUEFUNG,
  });
  rename(directory, "test/alt.test.js", inhalt);
  writeFileSync(join(directory, "tools/basis/selbstpruefung.json"), liste(VERSCHOBEN));
  const script = [
    `import { bestaendeNurKuerzer } from ${JSON.stringify(BESTAENDE)};`,
    `import { rueckfuehrung } from ${JSON.stringify(RUECKFUEHRUNG)};`,
    'const ohne = bestaendeNurKuerzer("HEAD");',
    'const mit = bestaendeNurKuerzer("HEAD", await rueckfuehrung("HEAD"));',
    "console.log(JSON.stringify({ ohne, mit }));",
  ].join("\n");
  const result = runIn(directory, process.execPath, ["--input-type=module", "-e", script]);
  assert.equal(result.status, EXIT_OK, result.stderr);
  return JSON.parse(result.stdout);
}

test("bestand-umbenennung: bestaendeNurKuerzer führt einen verschobenen Eintrag nur bei „nur Typen“ zurück", (context) => {
  const { ohne, mit } = bestaendeNachUmbenennung(context, SELBSTPRUEFUNG);
  assert.equal(ohne.length, 1);
  assert.deepEqual(mit, []);
});

test("bestand-umbenennung: bestaendeNurKuerzer bleibt rot, wenn die umbenannte Testdatei Code ändert", (context) => {
  const { ohne, mit } = bestaendeNachUmbenennung(
    context,
    SELBSTPRUEFUNG.replace('"immer"', '"anders"'),
  );
  assert.equal(ohne.length, 1);
  assert.equal(mit.length, 1);
  assert.match(mit[0], /test\/alt\.test\.ts\|0123456789abcdef/);
});

const DREI_KOPIEN = { ...JSCPD, "src/drei.js": BLOCK };
const NACHZIEHEN = "--umbenennung-nachziehen";
const FREMDES_PAAR = "src/eins.js|src/zwei.js|58";
const UMBENANNTE_BASIS = "bestehen aber schon auf der Basis HEAD mit denselben reinen Umbenennungen";
const NEUE_JSCPD_BEFUNDE = "neue Befunde von jscpd, die nicht in tools/basis/jscpd.json stehen";
const NICHT_GEWACHSEN = "die Liste ist nicht gewachsen";
const WAECHST_NICHT = "Die Liste wächst durch Umbenennungen nicht";

function dreiKopien(context) {
  const directory = frozen(context, DREI_KOPIEN, "jscpd");
  assert.ok(!jscpdKeys(directory).includes(FREMDES_PAAR), jscpdKeys(directory).join("\n"));
  return directory;
}

function writeJscpdKeys(directory, befunde) {
  const baseline = JSON.parse(readFileSync(baselinePath(directory, "jscpd"), "utf8"));
  writeFileSync(baselinePath(directory, "jscpd"), JSON.stringify({ ...baseline, befunde }));
}

test("bestand-umbenennung: jscpd, ein fremdes Paar aus einer reinen Umbenennung ist rot, bis die Basislinie nachgezogen ist", (context) => {
  const directory = dreiKopien(context);
  rename(directory, "src/drei.js", BLOCK);
  moveEntries(directory, "jscpd", "src/drei.js");
  const vorher = run(directory, ["jscpd", ...BASIS]);
  expectStatus(vorher, EXIT_FINDING, UMBENANNTE_BASIS);
  assert.ok(!vorher.output.includes(NEUE_JSCPD_BEFUNDE), vorher.output);
  expectStatus(run(directory, ["jscpd", ...BASIS, NACHZIEHEN]), EXIT_OK);
  assert.ok(jscpdKeys(directory).includes(FREMDES_PAAR), jscpdKeys(directory).join("\n"));
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_OK, NICHT_GEWACHSEN);
});

test("bestand-umbenennung: jscpd, nachgezogen wird auch ohne Listenumzug, und die Liste wächst nicht", (context) => {
  const directory = dreiKopien(context);
  const vorher = jscpdKeys(directory).length;
  rename(directory, "src/drei.js", BLOCK);
  expectStatus(run(directory, ["jscpd", ...BASIS, NACHZIEHEN]), EXIT_OK);
  assert.ok(jscpdKeys(directory).length <= vorher, jscpdKeys(directory).join("\n"));
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_OK);
});

test("bestand-umbenennung: jscpd, eine neue Kopie neben einer reinen Umbenennung bleibt rot und wird nicht nachgezogen", (context) => {
  const directory = dreiKopien(context);
  rename(directory, "src/drei.js", BLOCK);
  writeFileSync(join(directory, "src/vier.js"), BLOCK);
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_FINDING, NEUE_JSCPD_BEFUNDE);
  expectStatus(run(directory, ["jscpd", ...BASIS, NACHZIEHEN]), EXIT_OK);
  assert.ok(!jscpdKeys(directory).some((key) => key.includes("src/vier.js")), jscpdKeys(directory).join("\n"));
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_FINDING, "src/vier.js");
});

test("bestand-umbenennung: jscpd, eine Umbenennung mit geändertem Inhalt misst nicht gegen die umbenannte Basis", (context) => {
  const directory = dreiKopien(context);
  rename(directory, "src/drei.js", BLOCK_MIT_TYPEN);
  const result = run(directory, ["jscpd", ...BASIS]);
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.ok(!result.output.includes(UMBENANNTE_BASIS), result.output);
});

test("bestand-umbenennung: jscpd, nachziehen bricht ab, wenn die Liste wachsen würde", (context) => {
  const directory = probeRepository(context, DREI_KOPIEN);
  expectStatus(run(directory, ["jscpd", CREATE]), EXIT_OK);
  writeJscpdKeys(directory, jscpdKeys(directory).slice(0, 1));
  commitAll(directory, "gekürzte Basislinie");
  const vorher = readFileSync(baselinePath(directory, "jscpd"), "utf8");
  rename(directory, "src/drei.js", BLOCK);
  expectStatus(run(directory, ["jscpd", ...BASIS, NACHZIEHEN]), EXIT_FINDING, WAECHST_NICHT);
  assert.equal(readFileSync(baselinePath(directory, "jscpd"), "utf8"), vorher);
});

test("bestand-umbenennung: jscpd, in einer gewachsenen Liste zählt ein Paar nicht als Eintrag der umbenannten Basis", (context) => {
  const directory = dreiKopien(context);
  rename(directory, "src/drei.js", BLOCK);
  moveEntries(directory, "jscpd", "src/drei.js");
  addEntries(directory, "jscpd", [FREMDES_PAAR]);
  const result = run(directory, ["jscpd", ...BASIS]);
  expectStatus(result, EXIT_OK, "betreffen aber nur seit der Basis unveränderte Dateien");
  assert.ok(!result.output.includes(NICHT_GEWACHSEN), result.output);
});

test("bestand-umbenennung: jscpd, ein Paar der umbenannten Basis zwischen geänderten Dateien wird nicht nachgezogen", (context) => {
  const directory = dreiKopien(context);
  rename(directory, "src/drei.js", BLOCK);
  const andererBlock = BLOCK.replaceAll("summe", "produkt").replace("wert * 2 + 1", "wert * 5 - 4");
  writeFileSync(join(directory, "src/eins.js"), `${BLOCK}\n${andererBlock}`);
  writeFileSync(join(directory, "src/zwei.js"), andererBlock);
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_FINDING, NEUE_JSCPD_BEFUNDE);
  expectStatus(run(directory, ["jscpd", ...BASIS, NACHZIEHEN]), EXIT_OK);
  assert.ok(!jscpdKeys(directory).includes(FREMDES_PAAR), jscpdKeys(directory).join("\n"));
  expectStatus(run(directory, ["jscpd", ...BASIS]), EXIT_FINDING, NEUE_JSCPD_BEFUNDE);
});

test("bestand-umbenennung: jscpd, ohne Liste auf der Basis wird nichts nachgezogen", (context) => {
  const directory = probeRepository(context, DREI_KOPIEN);
  expectStatus(run(directory, ["jscpd", CREATE]), EXIT_OK);
  rename(directory, "src/drei.js", BLOCK);
  expectStatus(run(directory, ["jscpd", ...BASIS, NACHZIEHEN]), EXIT_FINDING, "ohne sie wird nichts nachgezogen");
});

test("bestand-umbenennung: jscpd, nachziehen braucht --basis", (context) => {
  const directory = dreiKopien(context);
  expectStatus(run(directory, ["jscpd", NACHZIEHEN]), EXIT_FINDING, "Aufruf:");
});
