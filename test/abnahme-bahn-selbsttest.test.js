// Selbsttests der Abnahme-Bahn ("npm run test:abnahme"). Die Bahn existiert NOCH NICHT -
// diese Datei ist ihre ausfuehrbare Fertig-Definition und deshalb ABSICHTLICH ROT. Sie
// wird gruen, sobald die Bahn nach dem hier festgelegten Vertrag gebaut ist; bis dahin
// nennt jede Fehlermeldung, was fehlt ("NOCH NICHT GEBAUT: ...").
//
// WARUM EINE DRITTE BAHN (Eigentuemer-Entscheidung): "Rot bleibt rot" schuetzt den
// Regressionslauf - die Aussage "etwas, das lief, ist kaputt". Ein noch nicht gebautes
// Abnahmekriterium ist keine Regression, sondern ein Rueckstandsposten mit ausfuehrbarer
// Fertig-Definition. Es laeuft, es urteilt, sein Rot bedeutet nur etwas anderes.
//
// VERTRAG, ueber den diese Datei urteilt (bewusst nah am i18n-Praezedenzfall,
// test/i18n-catalog-run.mjs + test/i18n-catalog-run.test.js):
//
// 1. KENNUNG: Ein Abnahmekriterium ist EIN test()-Fall, dessen Name mit "ABNAHME-<ID>"
//    beginnt (Kennung als Literal am Namensanfang, exakt die Zuordnungsregel des i18n-
//    Katalogs). Das Muster steht als EINE Quelle in package.json unter
//    "config.abnahmePattern" (neben "config.i18nCatalogPattern"), verankert mit "^".
//    Die drei Mengen sind disjunkt, weil die Kennung am Namensanfang steht: ein Name
//    traegt entweder eine Katalog-ID, oder die Abnahme-Kennung, oder keines von beidem.
//
// 2. BAHNEN: Drei Modi ueber dasselbe Wrapper-Muster wie beim i18n-Split (node:test
//    --test-skip-pattern / --test-name-pattern, mehrfach angebbar - am Node dieses Repos
//    gemessen). Der Wrapper wird ueber die package.json-Skripte gefunden, nicht ueber
//    einen festen Pfad: "npm test" -> Modus regression (skippt i18n-Katalog UND Abnahme),
//    "npm run test:gates" -> Modus gates, "npm run test:abnahme" -> Modus abnahme (faehrt
//    NUR Kriterien). Der Wrapper exportiert dafuer patternFlagsFor(modus) -> string[] und
//    darf beim blossen Import KEINEN Lauf starten (Praezedenzfall: isMainModule-Wache).
//
// 3. AUSGEWANDERT-LISTE (R2-Ratsche): test/abnahme-ausgewandert.json, ein JSON-Array.
//    Ein Eintrag traegt { id, file, test, seit }: id = Kriterium-ID (z.B. "A8-SUMMARY"),
//    file = Testdatei repo-relativ, test = exakter Testname NACH der Auswanderung,
//    seit = ISO-Datum (YYYY-MM-DD). Der ausgewanderte Testname traegt die Kennung nicht
//    mehr, dafuer das Siegel "[abgenommen <ID>]" - zwei unabhaengige Aufzeichnungen, die
//    uebereinstimmen muessen. Damit faengt der REGRESSIONSLAUF alle drei Wege, auf denen
//    die Zahl sinken koennte: Kriterium wandert zurueck (Kennung wieder da), Test
//    geloescht/umbenannt (Eintrag zeigt ins Leere), Eintrag entfernt (Siegel ohne Eintrag).
//
// 4. GRUND-ZEILE (R3): Der Grund haengt am TESTNAMEN, nicht in einer Nebendatei - dann
//    steht er in jeder TAP-Zeile und in jeder Bahn-Ausgabe, und er kann nicht von seinem
//    Kriterium wegdriften. Form:
//      ABNAHME-<ID>: <Kriterium> | ROT WEIL: <Grund> | FIX: <Fix>
//    Der Wrapper zerlegt das mit reasonOf(testName) -> { why, fix } bzw. null, wenn Grund
//    oder Fix fehlt oder leer ist. Ein Kriterium ohne Grund-Zeile ist ein Fehler.
//
// 5. R1-ZAHL: Der Wrapper exportiert abnahmeScoreLine(tapText, migratedCount) und gibt
//    die Zeile im Abnahme-Lauf aus. Sie zaehlt die AUSGEWANDERTEN mit - sonst faellt die
//    Zahl, sobald ein Kriterium gruen wird und umzieht, und misst damit das Gegenteil von
//    Fortschritt. Die Datei-Wrapper-Korrektur des i18n-Praezedenzfalls gilt hier ebenso
//    (leergefilterte Dateien zaehlen sonst als Kriterien mit).
//
// Die Namen IN dieser Datei tragen bewusst weder eine i18n-Katalog-ID noch die Abnahme-
// Kennung: die Selbsttests sind Regressionsschutz und gehoeren in "npm test" (Lehre
// catalog-id-prefix-misroutes-tests). Test 4 prueft genau das mit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const SELF_FILE = "abnahme-bahn-selbsttest.test.js";
const MIGRATED_LIST = "test/abnahme-ausgewandert.json";

const SCRIPT_REGRESSION = "test";
const SCRIPT_GATES = "test:gates";
const SCRIPT_ABNAHME = "test:abnahme";

// Beispielnamen des Vertrags. Sie stehen bewusst NICHT in test()-Position, damit die
// Namensernte unten sie nicht als echte Kriterien einsammelt.
const CRITERION_NAME =
  "ABNAHME-A8-SUMMARY: Datum, Uhrzeit und Preis als eigene Angabe | " +
  "ROT WEIL: fuer die drei Werte gibt es kein Feld, sie leben nur im Freitext | " +
  "FIX: eigene Felder in src/conversation/outcome-to-mcp-fields.js";
const CRITERION_NAME_2 = "ABNAHME-B2-TOOL: Werkzeugwahl | ROT WEIL: doppelt | FIX: Prompt";
const REGRESSION_NAME = "schlichter Bestandstest ohne Kennung";
const GATES_NAME = "GAP-99 i18n-Katalogfall";

// Die drei Faelle der Wegwerf-Datei aus Test 3 - je einer pro Bank.
const FIXTURE_CASES = Object.freeze([REGRESSION_NAME, GATES_NAME, CRITERION_NAME]);
// Erfundener Stand ausgewanderter Kriterien fuer die R1-Rechnung in Test 5.
const MIGRATED_SAMPLE = 4;

const SCORE_LINE = /^\d+ von \d+ Abnahmekriterien erfuellt$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CRITERION_ID = /^[A-Z][A-Z0-9-]*$/;
const SEAL_IN_NAME = /\[abgenommen ([A-Z][A-Z0-9-]*)\]/;

// Untergrenzen der Namensernte - Positiv-Kontrollen gegen einen Ernter, der nichts mehr
// findet und deshalb jede Mengenaussage trivial bestehen wuerde. Gemessen 2026-08-13:
// 4286 geerntete Namen, davon 128 mit i18n-Katalog-ID.
const MIN_HARVESTED = 2000;
const MIN_GATES_NAMES = 50;

function readPackageJson() {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
}

function mustExist(value, hint) {
  assert.ok(value !== undefined && value !== null && value !== "", `NOCH NICHT GEBAUT: ${hint}`);
  return value;
}

function abnahmePatternSource() {
  const source = readPackageJson().config?.abnahmePattern;
  mustExist(source, `package.json config.abnahmePattern (Muster der Abnahme-Kennung) fehlt`);
  assert.equal(typeof source, "string", "config.abnahmePattern ist ein Regex-String");
  assert.doesNotThrow(() => new RegExp(source), "config.abnahmePattern ist ein gueltiger Regex");
  return source;
}

function i18nPatternSource() {
  return mustExist(
    readPackageJson().config?.i18nCatalogPattern,
    "package.json config.i18nCatalogPattern (Bestand) fehlt",
  );
}

// Findet Wrapper-Modul und Modus zu einem npm-Skript. Ueber das SKRIPT statt ueber einen
// festen Pfad: geprueft wird, was "npm run <skript>" tatsaechlich ausfuehrt - und der
// Bauende bleibt frei, die Bahn im bestehenden Wrapper oder in einem eigenen Modul
// unterzubringen.
async function laneOf(scriptName) {
  const command = mustExist(
    readPackageJson().scripts?.[scriptName],
    `package.json scripts["${scriptName}"] fehlt`,
  );
  const tokens = command.split(/\s+/);
  const index = tokens.findIndex((token) => /\.m?js$/.test(token));
  assert.notEqual(index, -1, `NOCH NICHT GEBAUT: kein Lauf-Modul im Befehl "${command}"`);
  const modulePath = join(PROJECT_ROOT, tokens[index]);
  assert.ok(existsSync(modulePath), `NOCH NICHT GEBAUT: ${tokens[index]} existiert nicht`);
  const mode = tokens[index + 1];
  assert.ok(
    mode && !mode.startsWith("-"),
    `NOCH NICHT GEBAUT: "${command}" nennt keinen Modus hinter dem Lauf-Modul`,
  );
  return { mode, module: await import(pathToFileURL(modulePath).href), modulePath };
}

async function flagsOf(scriptName) {
  const { mode, module } = await laneOf(scriptName);
  const patternFlagsFor = mustExist(
    module.patternFlagsFor,
    `das Lauf-Modul von "${scriptName}" exportiert patternFlagsFor(modus) nicht`,
  );
  const flags = patternFlagsFor(mode);
  assert.ok(Array.isArray(flags), `patternFlagsFor("${mode}") liefert eine Flag-Liste`);
  return flags;
}

// node:test-Semantik der beiden Filter-Flags, am Node dieses Repos gemessen (2026-08-13):
// --test-skip-pattern SCHLIESST AUS (der Fall taucht in "# tests" nicht mehr auf, er wird
// nicht als skipped gezaehlt), beide Flags sind mehrfach angebbar, skip schlaegt name.
function runsUnder(testName, flags) {
  const patternsOf = (flag) =>
    flags
      .filter((entry) => entry.startsWith(`${flag}=`))
      .map((entry) => new RegExp(entry.slice(flag.length + 1)));
  const namePatterns = patternsOf("--test-name-pattern");
  const skipPatterns = patternsOf("--test-skip-pattern");
  if (namePatterns.length > 0 && !namePatterns.some((pattern) => pattern.test(testName)))
    return false;
  return !skipPatterns.some((pattern) => pattern.test(testName));
}

// Statische Namensernte ueber alle Testdateien. Erfasst test(...)/it(...) mit literalem
// Namen (auch verschachtelte t.test(...)-Aufrufe). Bei Template-Namen zaehlt der literale
// Kopf bis zur ersten Interpolation - ein Name, der MIT einer Interpolation beginnt, hat
// keinen entscheidbaren Kopf und kann per Vertrag keine Kennung tragen (Kennung ist ein
// Literal am Namensanfang).
function harvestTestNames() {
  const call = /\b(?:test|it)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  const harvested = [];
  for (const file of readdirSync(TEST_DIR).filter((name) => name.endsWith(".test.js"))) {
    const source = readFileSync(join(TEST_DIR, file), "utf8");
    for (const [, , raw] of source.matchAll(call)) {
      harvested.push({ file, raw, head: raw.split("${")[0].replace(/\\(.)/g, "$1") });
    }
  }
  return harvested;
}

function parseTap(tapText) {
  const total = tapText.match(/^# tests (\d+)$/m);
  return {
    tests: total ? Number(total[1]) : null,
    names: [...tapText.matchAll(/^ok \d+ - (.+)$/gm)].map(([, name]) => name),
  };
}

// Faehrt einen echten node:test-Lauf gegen eine Wegwerf-Datei mit drei Faellen - EIN
// Bestandsfall, EIN i18n-Katalogfall, EIN Abnahmekriterium. Klein genug fuer den
// Regressionslauf und trotzdem eine Messung an der echten Filter-Semantik statt an
// meinem Nachbau.
// NODE_TEST_CONTEXT muss raus: der Kindprozess erbt es sonst aus DIESEM Testlauf, haelt
// sich fuer einen Reporter-Kindprozess und verweigert die Arbeit ("node:test run() is
// being called recursively within a test file. skipping running files") - stdout bleibt
// leer, ohne dass der Aufruf fehlschlaegt. Am Node dieses Repos gemessen.
function runFixture(flags, fixturePath) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", ...flags, fixturePath],
    { encoding: "utf8", env },
  );
  assert.ok(result.stdout, `der Probelauf lieferte keine TAP-Ausgabe: ${result.stderr ?? ""}`);
  return parseTap(result.stdout);
}

function writeFixture(directory) {
  const lines = ['import { test } from "node:test";'];
  for (const name of FIXTURE_CASES) lines.push(`test(${JSON.stringify(name)}, () => {});`);
  const fixturePath = join(directory, "abnahme-split-probe.test.js");
  writeFileSync(fixturePath, `${lines.join("\n")}\n`);
  return fixturePath;
}

function sealOf(id) {
  return `[abgenommen ${id}]`;
}

function namesPerFileOf(harvested) {
  const namesPerFile = new Map();
  for (const entry of harvested) {
    const file = `test/${entry.file}`;
    if (!namesPerFile.has(file)) namesPerFile.set(file, new Set());
    namesPerFile.get(file).add(entry.head);
  }
  return namesPerFile;
}

// Ein Listeneintrag gegen den Bestand: zurueckgewandert, Siegel weg, Test weg.
function entryViolations(entry, namesPerFile, kennung) {
  const violations = [];
  if (kennung.test(entry.test)) {
    violations.push(`${entry.id}: traegt die Abnahme-Kennung wieder - zurueckgewandert`);
  }
  if (!entry.test.includes(sealOf(entry.id))) {
    violations.push(`${entry.id}: Testname ohne Siegel ${sealOf(entry.id)}`);
  }
  if (!namesPerFile.get(entry.file)?.has(entry.test)) {
    violations.push(`${entry.id}: Test "${entry.test}" existiert in ${entry.file} nicht mehr`);
  }
  return violations;
}

// Die Gegenrichtung: ein Test traegt sein Siegel, die Liste kennt ihn nicht mehr.
function orphanSealViolations(harvested, listedIds) {
  const violations = [];
  for (const entry of harvested) {
    const seal = entry.head.match(SEAL_IN_NAME);
    if (seal && !listedIds.has(seal[1])) {
      violations.push(`test/${entry.file}: Siegel ${sealOf(seal[1])} ohne Eintrag in der Liste`);
    }
  }
  return violations;
}

// Die R2-Ratsche. Rein, damit sie mit erfundenen Eingaben in beide Richtungen geprueft
// werden kann (Test 6) und danach auf die echten Daten losgelassen wird (Test 7).
// kennung = Regex der Abnahme-Kennung, harvested = Ernte aus den Testdateien.
function ratchetViolations({ migrated, harvested, kennung }) {
  const namesPerFile = namesPerFileOf(harvested);
  const listedIds = new Set(migrated.map((entry) => entry.id));
  return [
    ...migrated.flatMap((entry) => entryViolations(entry, namesPerFile, kennung)),
    ...orphanSealViolations(harvested, listedIds),
  ];
}

function readMigratedList() {
  const path = join(PROJECT_ROOT, MIGRATED_LIST);
  assert.ok(existsSync(path), `NOCH NICHT GEBAUT: ${MIGRATED_LIST} fehlt (leeres Array anlegen)`);
  const list = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(Array.isArray(list), `${MIGRATED_LIST} ist ein JSON-Array`);
  return list;
}

test("Selbsttest Abnahme-Bahn: die Kennung ist ein eigenes Muster und ueberschneidet sich nicht mit dem i18n-Katalog", () => {
  const kennung = new RegExp(abnahmePatternSource());
  const katalog = new RegExp(i18nPatternSource());

  assert.ok(
    abnahmePatternSource().startsWith("^"),
    "die Kennung steht am Namensanfang, verankert mit ^",
  );
  for (const name of [CRITERION_NAME, CRITERION_NAME_2]) {
    assert.ok(kennung.test(name), `Kennung erkennt "${name}"`);
    assert.ok(!katalog.test(name), "ein Abnahmekriterium ist kein i18n-Katalogfall");
  }
  for (const name of [
    REGRESSION_NAME,
    GATES_NAME,
    "A8-Abschluss: Bestandsname",
    "Charakterisierung PAY-03 x",
  ]) {
    assert.ok(!kennung.test(name), `Kennung greift NICHT bei "${name}"`);
  }
  // Ohne Bindestrich ist es keine Kennung - sonst faengt das Muster Prosa-Namen ein.
  assert.ok(!kennung.test("ABNAHMEFALL: ohne Bindestrich"), "die Kennung verlangt ABNAHME-<ID>");
});

test("Selbsttest Abnahme-Bahn: npm test schliesst Kriterien aus, npm run test:abnahme faehrt nur sie", async () => {
  const kennung = abnahmePatternSource();
  const regression = await flagsOf(SCRIPT_REGRESSION);
  const abnahme = await flagsOf(SCRIPT_ABNAHME);
  const gates = await flagsOf(SCRIPT_GATES);

  assert.ok(
    regression.includes(`--test-skip-pattern=${kennung}`),
    `der Regressionslauf skippt die Abnahme-Kennung (Flags: ${regression.join(" ")})`,
  );
  assert.ok(
    regression.includes(`--test-skip-pattern=${i18nPatternSource()}`),
    "der Regressionslauf skippt weiterhin den i18n-Katalog (Bestand bleibt unberuehrt)",
  );
  assert.ok(
    abnahme.includes(`--test-name-pattern=${kennung}`),
    `die Abnahme-Bahn waehlt genau die Kennung aus (Flags: ${abnahme.join(" ")})`,
  );

  // Gegenstueck zu jedem Ausschluss: der Filter laesst auch etwas durch.
  assert.ok(!runsUnder(CRITERION_NAME, regression), "Kriterium laeuft NICHT im Regressionslauf");
  assert.ok(runsUnder(REGRESSION_NAME, regression), "der Bestandsfall laeuft weiterhin mit");
  assert.ok(runsUnder(CRITERION_NAME, abnahme), "das Kriterium laeuft in der Abnahme-Bahn");
  assert.ok(!runsUnder(REGRESSION_NAME, abnahme), "die Abnahme-Bahn faehrt NUR Kriterien");
  assert.ok(!runsUnder(GATES_NAME, abnahme), "der i18n-Katalog bleibt aus der Abnahme-Bahn heraus");
  assert.ok(
    !runsUnder(CRITERION_NAME, gates),
    "ein Kriterium verirrt sich nicht in den Gates-Lauf",
  );
});

test("Selbsttest Abnahme-Bahn: an node:test gemessen - der Dreier-Split verliert und dupliziert nichts", async () => {
  const flagsPerLane = {
    regression: await flagsOf(SCRIPT_REGRESSION),
    gates: await flagsOf(SCRIPT_GATES),
    abnahme: await flagsOf(SCRIPT_ABNAHME),
  };
  const directory = mkdtempSync(join(tmpdir(), "abnahme-split-"));
  try {
    const fixturePath = writeFixture(directory);
    const full = runFixture([], fixturePath);
    const perLane = Object.fromEntries(
      Object.entries(flagsPerLane).map(([lane, flags]) => [lane, runFixture(flags, fixturePath)]),
    );

    assert.equal(
      full.tests,
      FIXTURE_CASES.length,
      "die Wegwerf-Datei haelt je einen Fall pro Bank - ungefilterter Lauf",
    );
    // Rechnerisch, nicht durch Zusehen: Summe der drei Baenke == ungefilterter Bestand,
    // und die Vereinigung der Namen ist genau der ungefilterte Namensbestand (kein Fall
    // faellt zwischen die Baenke, keiner laeuft doppelt).
    const sum = perLane.regression.tests + perLane.gates.tests + perLane.abnahme.tests;
    assert.equal(
      sum,
      full.tests,
      `Summe der Baenke (${sum}) == ungefilterter Lauf (${full.tests})`,
    );
    const union = new Set([
      ...perLane.regression.names,
      ...perLane.gates.names,
      ...perLane.abnahme.names,
    ]);
    assert.equal(union.size, sum, "kein Name laeuft in zwei Baenken");
    assert.deepEqual(
      [...union].sort(),
      [...full.names].sort(),
      "die Baenke ergeben den ganzen Bestand",
    );
    // Positiv-Kontrolle je Bank: jede laesst genau ihren Fall durch.
    assert.deepEqual(perLane.regression.names, [REGRESSION_NAME]);
    assert.deepEqual(perLane.gates.names, [GATES_NAME]);
    assert.deepEqual(perLane.abnahme.names, [CRITERION_NAME]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Selbsttest Abnahme-Bahn: kein Testname des Bestands faellt zwischen die drei Baenke", async () => {
  const flagsPerLane = {
    regression: await flagsOf(SCRIPT_REGRESSION),
    gates: await flagsOf(SCRIPT_GATES),
    abnahme: await flagsOf(SCRIPT_ABNAHME),
  };
  const harvested = harvestTestNames();
  assert.ok(
    harvested.length >= MIN_HARVESTED,
    `die Namensernte findet noch Namen (${harvested.length} < ${MIN_HARVESTED} heisst: der Ernter ist kaputt, nicht der Bestand)`,
  );

  const dynamic = harvested.filter((entry) => entry.head === "");
  for (const entry of dynamic) {
    assert.ok(
      entry.raw.startsWith("${"),
      `nur ein Name, der mit einer Interpolation BEGINNT, ist statisch unentscheidbar (${entry.file}: ${entry.raw})`,
    );
  }

  const decidable = harvested.filter((entry) => entry.head !== "");
  const buckets = { regression: [], gates: [], abnahme: [] };
  const misrouted = [];
  for (const entry of decidable) {
    const lanes = Object.keys(buckets).filter((lane) => runsUnder(entry.head, flagsPerLane[lane]));
    if (lanes.length === 1) buckets[lanes[0]].push(entry);
    else misrouted.push(`${entry.file}: "${entry.head}" laeuft in ${lanes.length} Baenken`);
  }

  assert.deepEqual(misrouted, [], "jeder Name laeuft in GENAU einer Bank");
  const sum = buckets.regression.length + buckets.gates.length + buckets.abnahme.length;
  assert.equal(
    sum + dynamic.length,
    harvested.length,
    "die Baenke plus die unentscheidbaren ergeben den Bestand",
  );
  assert.ok(buckets.gates.length >= MIN_GATES_NAMES, "der i18n-Katalog ist weiterhin besetzt");
  assert.ok(
    buckets.regression.length >= MIN_HARVESTED - buckets.gates.length,
    "der Regressionslauf traegt den Rest",
  );
  assert.ok(
    buckets.abnahme.length >= 1,
    "die Abnahme-Bahn haelt mindestens EIN Kriterium - eine leere Bahn besteht jede Filterpruefung",
  );
  for (const entry of harvested.filter((candidate) => candidate.file === SELF_FILE)) {
    assert.ok(
      runsUnder(entry.head, flagsPerLane.regression),
      `die Selbsttests selbst gehoeren in den Regressionslauf ("${entry.head}")`,
    );
  }
});

test("Selbsttest Abnahme-Bahn: R1 - die Zahl 'x von y Abnahmekriterien erfuellt' zaehlt die Ausgewanderten mit", async () => {
  const { module, modulePath } = await laneOf(SCRIPT_ABNAHME);
  const abnahmeScoreLine = mustExist(
    module.abnahmeScoreLine,
    "das Lauf-Modul der Abnahme-Bahn exportiert abnahmeScoreLine(tapText, migratedCount) nicht",
  );

  const plain = ["# tests 3", "# pass 1", "# fail 2"].join("\n");
  assert.equal(abnahmeScoreLine(plain, 0), "1 von 3 Abnahmekriterien erfuellt");
  assert.match(abnahmeScoreLine(plain, 0), SCORE_LINE, "genau das von R1 verlangte Format");

  // Ausgewanderte zaehlen mit: sonst SINKT die Zahl, sobald ein Kriterium gruen wird und
  // umzieht - sie wuerde das Gegenteil von Fortschritt messen.
  assert.equal(abnahmeScoreLine(plain, MIGRATED_SAMPLE), "5 von 7 Abnahmekriterien erfuellt");

  // Leergefilterte Dateien melden bei node:test einen Datei-Wrapper ohne echten Test
  // (i18n-Praezedenzfall). Er darf weder als Kriterium noch als erfuellt zaehlen.
  const withWrapper = [
    "1..0",
    "# Subtest: test/leer-gefiltert.test.js",
    "ok 1 - test/leer-gefiltert.test.js",
    "# tests 5",
    "# pass 2",
    "# fail 3",
  ].join("\n");
  assert.equal(abnahmeScoreLine(withWrapper, MIGRATED_SAMPLE), "5 von 8 Abnahmekriterien erfuellt");

  // R1 verlangt "IMMER SICHTBAR": die Zahl muss auf dem Abnahme-Pfad auch ausgegeben
  // werden. Geprueft wird die Verdrahtung - eine Aufrufstelle ausserhalb der Definition.
  const source = readFileSync(modulePath, "utf8").replace(
    /function\s+abnahmeScoreLine/g,
    "DEFINITION",
  );
  assert.ok(source.includes("abnahmeScoreLine("), "die Bahn ruft abnahmeScoreLine auch auf");
});

test("Selbsttest Abnahme-Bahn: R2 - die Ratsche faengt zurueckgewanderte, geloeschte und ausgetragene Kriterien", () => {
  const kennung = /^ABNAHME-[A-Z0-9]/;
  const clean = {
    id: "A8-SUMMARY",
    file: "test/a8-abschluss-zusammenfassung.test.js",
    test: `A8-Zusammenfassung: Datum, Uhrzeit und Preis ${sealOf("A8-SUMMARY")}`,
    seit: "2026-08-13",
  };
  const harvestOf = (file, head) => [{ file: file.replace(/^test\//, ""), raw: head, head }];

  // Positiv-Kontrolle: ein sauberes Paar aus Liste und Bestand loest NICHTS aus - eine
  // Ratsche, die alles anschlaegt, besteht jede Verletzungspruefung.
  assert.deepEqual(
    ratchetViolations({ migrated: [clean], harvested: harvestOf(clean.file, clean.test), kennung }),
    [],
  );

  // (a) zurueckgewandert: der Name traegt die Kennung wieder.
  const returned = { ...clean, test: `ABNAHME-A8-SUMMARY: zurueck ${sealOf("A8-SUMMARY")}` };
  assert.ok(
    ratchetViolations({
      migrated: [returned],
      harvested: harvestOf(returned.file, returned.test),
      kennung,
    }).some((violation) => violation.includes("zurueckgewandert")),
    "ein Kriterium, das die Kennung wieder traegt, ist ein Blocker",
  );

  // (b) geloescht/umbenannt: der Eintrag zeigt ins Leere.
  assert.ok(
    ratchetViolations({
      migrated: [clean],
      harvested: harvestOf(clean.file, "ganz anderer Name"),
      kennung,
    }).some((violation) => violation.includes("existiert")),
    "ein Eintrag ohne zugehoerigen Test ist ein Blocker",
  );

  // (c) ausgetragen: der Test traegt sein Siegel, die Liste kennt ihn nicht mehr.
  assert.ok(
    ratchetViolations({ migrated: [], harvested: harvestOf(clean.file, clean.test), kennung }).some(
      (violation) => violation.includes("ohne Eintrag"),
    ),
    "ein Siegel ohne Listeneintrag ist ein Blocker - sonst sinkt die Zahl unbemerkt",
  );
});

test("Selbsttest Abnahme-Bahn: R2 - jedes ausgewanderte Kriterium existiert noch und traegt die Kennung nicht mehr", () => {
  const kennung = new RegExp(abnahmePatternSource());
  const migrated = readMigratedList();

  for (const entry of migrated) {
    assert.match(
      entry.id ?? "",
      CRITERION_ID,
      `Eintrag ohne brauchbare id: ${JSON.stringify(entry)}`,
    );
    assert.match(entry.seit ?? "", ISO_DATE, `${entry.id}: seit ist ein ISO-Datum (YYYY-MM-DD)`);
    assert.equal(typeof entry.test, "string", `${entry.id}: test ist der exakte Testname`);
    assert.ok(
      existsSync(join(PROJECT_ROOT, entry.file ?? "")),
      `${entry.id}: file zeigt auf eine Testdatei`,
    );
  }
  const ids = migrated.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "jede Kriterium-ID steht genau einmal in der Liste");

  assert.deepEqual(
    ratchetViolations({ migrated, harvested: harvestTestNames(), kennung }),
    [],
    "die Zahl der ausgewanderten Kriterien darf NIE sinken",
  );
});

test("Selbsttest Abnahme-Bahn: R3 - der Grund haengt am Testnamen und wird in Grund und Fix zerlegt", async () => {
  const { module } = await laneOf(SCRIPT_ABNAHME);
  const reasonOf = mustExist(
    module.reasonOf,
    "das Lauf-Modul der Abnahme-Bahn exportiert reasonOf(testName) nicht",
  );

  assert.deepEqual(reasonOf(CRITERION_NAME), {
    why: "fuer die drei Werte gibt es kein Feld, sie leben nur im Freitext",
    fix: "eigene Felder in src/conversation/outcome-to-mcp-fields.js",
  });
  assert.deepEqual(reasonOf(CRITERION_NAME_2), { why: "doppelt", fix: "Prompt" });

  assert.equal(
    reasonOf("ABNAHME-A8-SUMMARY: Kriterium ohne Grund"),
    null,
    "ohne Grund-Zeile: null",
  );
  assert.equal(reasonOf("ABNAHME-A8-SUMMARY: x | ROT WEIL: y"), null, "Grund ohne Fix: null");
  assert.equal(reasonOf("ABNAHME-A8-SUMMARY: x | ROT WEIL:  | FIX: y"), null, "leerer Grund: null");
  assert.equal(reasonOf("ABNAHME-A8-SUMMARY: x | ROT WEIL: y | FIX:   "), null, "leerer Fix: null");
});

test("Selbsttest Abnahme-Bahn: R3 - kein Abnahmekriterium im Bestand ohne Grund-Zeile", async () => {
  const { module } = await laneOf(SCRIPT_ABNAHME);
  const reasonOf = mustExist(
    module.reasonOf,
    "das Lauf-Modul der Abnahme-Bahn exportiert reasonOf(testName) nicht",
  );
  const kennung = new RegExp(abnahmePatternSource());

  // Positiv-Kontrolle, dass die Pruefung ueberhaupt greifen KANN: sie erkennt eine
  // fehlende Grund-Zeile an einem erfundenen Namen. Ohne sie waere die Schleife unten
  // still gruen, solange die Bahn leer ist (die Besetzung prueft Test 4).
  assert.equal(reasonOf("ABNAHME-PROBE-1: ohne Grund"), null);

  const ohneGrund = harvestTestNames()
    .filter((entry) => kennung.test(entry.head) && reasonOf(entry.head) === null)
    .map((entry) => `${entry.file}: "${entry.head}"`);
  assert.deepEqual(
    ohneGrund,
    [],
    "jedes rote Kriterium nennt seinen Grund im Namen: '| ROT WEIL: ... | FIX: ...'",
  );
});
