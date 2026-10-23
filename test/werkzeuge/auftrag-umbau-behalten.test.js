import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { exitCodes } from "./auftrag-lauf-hilfen.js";
import { mitErsatzWerkzeugen } from "./ersatz-werkzeuge.js";
import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const PATCH = ".git/auftrag-umbau/probe/A1.patch";
const TEST_COMMIT = "Halte Verhalten vor Umbau A1 fest";
const UMBAU_COMMIT = "Räume src auf";
const LEER_MUTANT = "src/text.js:2:10 MethodExpression → text";
const UMLAUT_MUTANT = 'src/text.js:2:15 StringLiteral → ""';
const GLEICHWERTIG = `Gleichwertig: ${UMLAUT_MUTANT}, weil der Wert dort nie beobachtbar ist`;
const ALT = "export function gross(text) {\n  return text.toUpperCase();\n}\n";
const NEU = "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n";

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const argumente = process.argv.slice(2);
const sitzung = argumente[argumente.indexOf(argumente.includes("--resume") ? "--resume" : "--session-id") + 1];
const rolle = process.env.HERMES_ROLLE;
const ordner = dirname(process.env.ERSATZ_DREHBUCH);
const nummer = readdirSync(ordner).filter((name) => name.startsWith("prompt-" + rolle + "-")).length;
const eintrag = (JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"))[rolle] ?? [])[nummer] ?? {};
const lies = (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf8") : null);
const stand = { patch: lies(${JSON.stringify(PATCH)}), text: lies("src/text.js") };
writeFileSync(join(ordner, "stand-" + rolle + "-" + nummer + ".json"), JSON.stringify(stand));
writeFileSync(join(ordner, "prompt-" + rolle + "-" + nummer + ".txt"), readFileSync(0, "utf8"));
for (const [pfad, inhalt] of Object.entries(eintrag.dateien ?? {})) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
const projekt = join(homedir(), ".claude", "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(projekt, { recursive: true });
const verbrauch = { message: { id: "antwort", usage: { input_tokens: 10, output_tokens: 5 } } };
writeFileSync(join(projekt, sitzung + ".jsonl"), JSON.stringify(verbrauch) + "\\n");
console.log(JSON.stringify({ type: "result", result: eintrag.antwort ?? "" }));
`;

const ERSATZ_MUTATION = `import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const MUTANTEN = ${JSON.stringify([[LEER_MUTANT, "leer"], [UMLAUT_MUTANT, "umlaut"]])};
const argumente = process.argv.slice(2);
const basis = argumente.includes("--basis") ? argumente[argumente.indexOf("--basis") + 1] : "HEAD";
const testdatei = readFileSync("test/text.test.js", "utf8");
const umgebaut = spawnSync("git", ["diff", "--quiet", basis, "--", "src/"]).status !== 0;
const pruefen = argumente.includes("--alter-stand") && umgebaut;
const gemeldet = argumente.filter((_, stelle) => argumente[stelle - 1] === "--gleichwertig");
const offen = pruefen ? MUTANTEN.filter(([mutant, fall]) => !testdatei.includes('"' + fall + '"') && !gemeldet.includes(mutant)) : [];
for (const [mutant] of offen) console.log("Verstoß: Mutant überlebt: " + mutant);
if (offen.length === 0) console.log("grün: keiner überlebt");
process.exitCode = offen.length > 0 ? 1 : 0;
`;

const FAELLE = {
  leer: 'test("leer", () => assert.equal(gross(""), ""));',
  umlaut: 'test("umlaut", () => assert.equal(gross("ä"), "Ä"));',
  nichts: 'test("nichts", () => assert.ok(true));',
};

function textTest(...namen) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { gross } from "../src/text.js";',
    'test("gross", () => assert.equal(gross("a"), "A"));',
    ...namen.map((name) => FAELLE[name]),
    "",
  ].join("\n");
}

const BASIS = {
  "package.json": JSON.stringify({
    type: "module",
    scripts: {
      test: "node --test --test-reporter=tap",
      lint: "node -e 0",
      "test:betroffen": "node -e 0 --",
      "test:mutation": "node mutation.mjs",
    },
  }),
  ".gitignore": ".fortschritt/\n",
  "mutation.mjs": ERSATZ_MUTATION,
  "src/text.js": ALT,
  "test/text.test.js": textTest(),
};

const ISSUE = 54;
const GH_OHNE_WIRKUNG = "true";
const PHASE = {
  phase: "probe",
  issue: ISSUE,
  entwurf: { "src/": "Entwurf." },
  auftraege: [
    {
      id: "A1",
      art: "umbau",
      ziel: UMBAU_COMMIT,
      bereich: "src/",
      erwarteteDateien: ["src/text.js"],
      vorbild: "src/text.js",
      abnahme: "test/text.test.js",
    },
  ],
};

const BAU = { dateien: { "src/text.js": NEU } };
const ABSATZ = "Zweck mutation alter Stand: Drehbuchtext des Ersatz-Agenten.";

function testEintrag(...namen) {
  return { dateien: { "test/text.test.js": textTest(...namen) }, antwort: ABSATZ };
}

function gitAusgabe(repo, ...argumente) {
  return runIn(repo, "git", argumente).stdout;
}

function starte(context, drehbuch) {
  const repo = probeRepository(context, BASIS);
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  const werkzeug = probeDirectory(context, {
    "phase.json": JSON.stringify(PHASE),
    "drehbuch.json": JSON.stringify(drehbuch),
  });
  writeFileSync(join(werkzeug, "claude.mjs"), ERSATZ_CLAUDE, { mode: AUSFUEHRBAR });
  const umgebung = {
    ...isolatedEnvironment(),
    ERSATZ_DREHBUCH: join(werkzeug, "drehbuch.json"),
    HERMES_CLAUDE: join(werkzeug, "claude.mjs"),
    HERMES_GH: GH_OHNE_WIRKUNG,
    HOME: werkzeug,
    ...mitErsatzWerkzeugen(werkzeug),
  };
  const basis = gitAusgabe(repo, "rev-parse", "HEAD").trim();
  const lauf = spawnSync(process.execPath, [EINSTIEG, "lauf", join(werkzeug, "phase.json")], {
    cwd: repo,
    encoding: "utf8",
    env: umgebung,
  });
  const belegDatei = join(repo, ".fortschritt/probe/A1.json");
  const ausgabe = lauf.stdout + lauf.stderr;
  if (!existsSync(belegDatei)) assert.fail(`keine Belegdatei: ${ausgabe}`);
  return { repo, werkzeug, lauf, basis, ausgabe, beleg: JSON.parse(readFileSync(belegDatei, "utf8")) };
}

function agentenMit(beleg, rolle) {
  return beleg.agenten.filter((agent) => agent.rolle === rolle);
}

function lesePrompt(werkzeug, nummer) {
  return readFileSync(join(werkzeug, `prompt-test-${nummer}.txt`), "utf8");
}

function pruefeGesichert(werkzeug, nummer) {
  const stand = JSON.parse(readFileSync(join(werkzeug, `stand-test-${nummer}.json`), "utf8"));
  assert.ok(stand.patch?.includes("toLocaleUpperCase"), `der Umbau war beim Test-Agenten nicht als Patch gesichert: ${stand.patch}`);
  assert.equal(stand.text, ALT, "der Arbeitsbaum stand beim Test-Agenten nicht auf dem Stand vor dem Bau");
}

function commitBetreffe(repo, basis) {
  return gitAusgabe(repo, "log", "--reverse", "--format=%s", `${basis}..HEAD`).split("\n").filter(Boolean);
}

test("auftrag-umbau-behalten: eine gefundene Lücke wird mit dem gesicherten Umbau geschlossen, ohne den Bau-Agenten noch einmal zu rufen", (context) => {
  const { repo, werkzeug, lauf, beleg, ausgabe } = starte(context, { bau: [BAU], test: [testEintrag("leer", "umlaut")] });
  assert.equal(lauf.status, 0, ausgabe);
  assert.equal(agentenMit(beleg, "bau").length, 1, "der Bau-Agent wurde mehr als einmal gerufen");
  pruefeGesichert(werkzeug, 0);
  const aufgabe = lesePrompt(werkzeug, 0);
  for (const erwartet of ["Überlebende Mutanten", "auf dem alten Stand", LEER_MUTANT, UMLAUT_MUTANT]) {
    assert.ok(aufgabe.includes(erwartet), `der Test-Agent bekam nicht: ${erwartet}`);
  }
  assert.deepEqual(exitCodes(beleg, "mutation alter Stand"), [EXIT_ROT, 0]);
  assert.equal(gitAusgabe(repo, "show", "HEAD:src/text.js"), NEU);
  assert.equal(beleg.ergebnis, "grün");
});

test("auftrag-umbau-behalten: die Tests des Test-Agenten stehen als eigener Commit unter dem Umbau-Commit", (context) => {
  const { repo, lauf, basis, ausgabe } = starte(context, { bau: [BAU], test: [testEintrag("leer", "umlaut")] });
  assert.equal(lauf.status, 0, ausgabe);
  const testNachricht = gitAusgabe(repo, "log", "-1", "--format=%B", "HEAD^");
  assert.equal(testNachricht.split("\n")[0], TEST_COMMIT);
  assert.match(testNachricht, /^Auftrag: probe\/A1$/m);
  assert.doesNotMatch(testNachricht, /^Art: umbau$/m);
  assert.deepEqual(gitAusgabe(repo, "show", "--name-only", "--format=", "HEAD^").trim().split("\n"), ["test/text.test.js"]);
  const festgehalten = gitAusgabe(repo, "show", "HEAD^:test/text.test.js");
  assert.ok(festgehalten.includes('test("leer"') && festgehalten.includes('test("umlaut"'), festgehalten);
  const umbauNachricht = gitAusgabe(repo, "log", "-1", "--format=%B", "HEAD");
  assert.match(umbauNachricht, /^Auftrag: probe\/A1$/m);
  assert.match(umbauNachricht, /^Art: umbau$/m);
  assert.ok(gitAusgabe(repo, "show", "--name-only", "--format=", "HEAD").split("\n").includes("src/text.js"));
  assert.equal(gitAusgabe(repo, "rev-parse", "HEAD~2").trim(), basis);
});

test("auftrag-umbau-behalten: senkt jede Runde die Zahl der Überlebenden, bleibt es bei einem Bau-Agenten und je Runde einem Test-Commit", (context) => {
  const drehbuch = { bau: [BAU], test: [testEintrag("leer"), testEintrag("leer", "umlaut")] };
  const { repo, werkzeug, lauf, basis, beleg, ausgabe } = starte(context, drehbuch);
  assert.equal(lauf.status, 0, ausgabe);
  assert.equal(agentenMit(beleg, "bau").length, 1, "der Bau-Agent wurde mehr als einmal gerufen");
  assert.equal(agentenMit(beleg, "test").length, 2);
  assert.deepEqual(exitCodes(beleg, "mutation alter Stand"), [EXIT_ROT, EXIT_ROT, 0]);
  assert.deepEqual(commitBetreffe(repo, basis), [TEST_COMMIT, TEST_COMMIT, UMBAU_COMMIT]);
  for (const nummer of [0, 1]) pruefeGesichert(werkzeug, nummer);
  assert.ok(lesePrompt(werkzeug, 1).includes(UMLAUT_MUTANT));
  assert.equal(gitAusgabe(repo, "show", "HEAD:src/text.js"), NEU);
});

function pruefeEntscheidung(ergebnis, ueberlebende) {
  const { repo, basis, beleg, ausgabe, lauf } = ergebnis;
  assert.equal(lauf.status, EXIT_ROT, ausgabe);
  assert.ok(lauf.stdout.includes("Auftrag A1: Entscheidung nötig."), ausgabe);
  const text = beleg.entscheidung?.text ?? "";
  assert.ok(text.includes("## Entscheidung nötig"), text);
  for (const mutant of ueberlebende) assert.ok(text.split("\n").includes(`- ${mutant}`), `${mutant} fehlt in: ${text}`);
  assert.deepEqual(beleg.runden, []);
  assert.equal(agentenMit(beleg, "bau").length, 1, "der Bau-Agent wurde mehr als einmal gerufen");
  assert.equal(gitAusgabe(repo, "status", "--porcelain").trim(), "");
  assert.equal(gitAusgabe(repo, "show", "HEAD:src/text.js"), ALT);
  assert.doesNotMatch(gitAusgabe(repo, "log", `${basis}..HEAD`, "--format=%B"), /^Art: umbau$/m);
  return text;
}

test("auftrag-umbau-behalten: senkt eine Runde die Zahl nicht, verlangt der Auftrag eine Entscheidung und lässt den alten Stand stehen", (context) => {
  const drehbuch = {
    bau: [BAU, BAU, BAU, BAU],
    test: [testEintrag("leer"), { ...testEintrag("leer", "nichts"), antwort: `${ABSATZ}\n\n${GLEICHWERTIG}` }],
    notiz: [{ antwort: "Notiz des Ersatzes." }],
  };
  const lauf = starte(context, drehbuch);
  const text = pruefeEntscheidung(lauf, [UMLAUT_MUTANT]);
  assert.ok(text.split("\n").includes(GLEICHWERTIG), text);
  const betreffe = commitBetreffe(lauf.repo, lauf.basis);
  assert.ok(betreffe.length > 0 && betreffe.every((betreff) => betreff === TEST_COMMIT), betreffe.join(" | "));
  assert.ok(gitAusgabe(lauf.repo, "show", "HEAD:test/text.test.js").includes('test("leer"'));
});

test("auftrag-umbau-behalten: ändert der Test-Agent nichts, verlangt der Auftrag ebenfalls eine Entscheidung", (context) => {
  const gleichwertig = `Gleichwertig: ${LEER_MUTANT}, weil die Methode dort nie beobachtbar ist`;
  const lauf = starte(context, { bau: [BAU], test: [{ antwort: gleichwertig }], notiz: [{ antwort: "Notiz des Ersatzes." }] });
  const text = pruefeEntscheidung(lauf, [LEER_MUTANT, UMLAUT_MUTANT]);
  assert.ok(text.split("\n").includes(gleichwertig), text);
  assert.deepEqual(commitBetreffe(lauf.repo, lauf.basis), []);
});

test("auftrag-umbau-behalten: passt der gesicherte Umbau nicht mehr auf den Stand, baut der Bau-Agent ihn neu", (context) => {
  const kaputt = { ...testEintrag("leer", "umlaut"), dateien: { ...testEintrag("leer", "umlaut").dateien, [PATCH]: "kein gültiger Patch\n" } };
  const { repo, werkzeug, lauf, basis, beleg, ausgabe } = starte(context, { bau: [BAU, BAU], test: [kaputt] });
  assert.equal(lauf.status, 0, ausgabe);
  pruefeGesichert(werkzeug, 0);
  const einspielen = beleg.pruefungen.filter(({ name }) => name === "umbau einspielen");
  assert.ok(einspielen.some(({ exitCode }) => exitCode !== 0), JSON.stringify(beleg.pruefungen.map(({ name }) => name)));
  assert.equal(agentenMit(beleg, "bau").length, 2);
  assert.deepEqual(commitBetreffe(repo, basis), [TEST_COMMIT, UMBAU_COMMIT]);
  assert.equal(gitAusgabe(repo, "show", "HEAD:src/text.js"), NEU);
  assert.equal(beleg.ergebnis, "grün");
});
