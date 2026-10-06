import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { gitSchutzLage, schutzGrund } from "../../tools/ziele/schutz.mjs";
import { REPO_ROOT } from "./probe-repo.js";
import {
  arbeitsordner,
  botIssue,
  eigenerPr,
  ersatzProgramm,
  gelesen,
  githubAttrappe,
  quelltext,
  starteZiele,
  testFuer,
  umgebung,
  zieleRepo,
} from "./ziele/hilfen.mjs";

const TAG_MS = 86_400_000;
const MORGEN = new Date(Date.now() + TAG_MS).toISOString();
const ZWEI_TAGE_MS = 172_800_000;
const ZWEI_BEFUNDE = 2;
const KNIP_PR = 7;
const BEFUND_ISSUE = 90;
const WEITER = { ausgang: "weiter", grund: "", befunde: [], start: new Date().toISOString() };
const HAUPTTEST = { "test/haupt.test.js": testFuer("src/main.js") };

function exporte(namen, benutzt = []) {
  return quelltext([
    ...benutzt.map((name) => `import { ${name} } from "./${name}.js";`),
    ...namen.map((name) => `export function ${name}() {\n  return "${name}";\n}`),
  ]);
}

function hauptdatei(importe) {
  return quelltext([
    ...importe.map(([name, datei]) => `import { ${name} } from "./${datei}";`),
    `console.log(${importe.map(([name]) => `${name}()`).join(", ")});`,
  ]);
}

function block(name) {
  return `export function ${name}(liste) {\n  const summe = liste.reduce((wert, eintrag) => wert + eintrag.betrag * eintrag.menge, 0);\n  return { summe, anzahl: liste.length, leer: liste.length === 0 };\n}`;
}

function repo(context, dateien) {
  return zieleRepo(context, { ...HAUPTTEST, ...dateien });
}

function einfachesRepo(context) {
  return repo(context, {
    "src/main.js": hauptdatei([["frei", "frei.js"]]),
    "src/frei.js": exporte(["frei", "unbenutzt"]),
  });
}

async function waehle(context, probe, { zusatz = {}, ...anfang } = {}) {
  const github = await githubAttrappe(context, anfang);
  const ordner = arbeitsordner(context, { "ziel/vorpruefung.json": WEITER });
  const lauf = await starteZiele(["waehlen", "--ordner", ordner], { cwd: probe.ordner, env: umgebung(github, zusatz) });
  return { ...lauf, ziel: gelesen(ordner, "ziel/ziel.json"), github };
}

function protokollierendesGit(context) {
  const echtesGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const quelle = [
    'import { appendFileSync } from "node:fs";',
    'import { spawnSync } from "node:child_process";',
    "appendFileSync(new URL('./token.log', import.meta.url), `${process.env.GH_TOKEN ?? ''}|${process.env.GITHUB_TOKEN ?? ''}\\n`);",
    `const lauf = spawnSync(${JSON.stringify(echtesGit)}, process.argv.slice(2), { stdio: "inherit" });`,
    "process.exitCode = lauf.status ?? 1;",
  ].join("\n");
  const { ordner, programm } = ersatzProgramm(context, quelle);
  execFileSync("cp", [programm, join(ordner, "git")]);
  return { pfad: ordner, eintraege: () => readFileSync(join(ordner, "token.log"), "utf8").trim().split("\n") };
}

function befundIssue(datei, felder = {}) {
  return botIssue(BEFUND_ISSUE, `Aufräumen: AR-tests-rot in \`${datei}\``, { labels: [{ name: "aufraeumen" }], state: "closed", state_reason: "not_planned", created_at: "2020-01-01T00:00:00Z", ...felder });
}

test("ziele-auswahl: eine Datei, die ein Gate, die Abrechnung oder ein Gespräch über Importe erreicht, ist nie Kandidat", async (context) => {
  const probe = repo(context, {
    "src/main.js": hauptdatei([["gate", "gate.js"], ["preis", "abrechnung/preis.js"], ["satz", "gespraech/satz.js"], ["frei", "frei.js"]]),
    "src/gate.js": quelltext(['import { hilfe1 } from "./hilfe.js";', "export function gate() {\n  return hilfe1();\n}"]),
    "src/hilfe.js": exporte(["hilfe1", "hilfe2", "hilfe3", "hilfe4"]),
    "src/abrechnung/preis.js": quelltext(['import { rechne1 } from "../rechner.js";', "export function preis() {\n  return rechne1();\n}"]),
    "src/rechner.js": exporte(["rechne1", "rechne2", "rechne3", "rechne4"]),
    "src/gespraech/satz.js": exporte(["satz", "satz2", "satz3", "satz4"]),
    "src/frei.js": exporte(["frei", "unbenutzt"]),
  });
  const { status, ziel } = await waehle(context, probe);
  assert.equal(status, 0);
  assert.deepEqual([ziel.ausgang, ziel.sorte, ziel.datei, ziel.agentErlaubt], ["weiter", "knip", "src/frei.js", true]);
  assert.deepEqual(ziel.zielbefunde, ["exports unbenutzt"]);
});

test("ziele-auswahl: Tests, CODEOWNERS-Dateien, kritische Pfade und erzeugte Dateien sind keine Kandidaten", async (context) => {
  const probe = repo(context, {
    ".github/CODEOWNERS": "/src/eigen.js @Antonio20045\n",
    "src/main.js": hauptdatei([["eigen", "eigen.js"], ["netz", "telephony/netz.js"], ["probe", "test/probe.js"], ["erzeugt", "erzeugt.js"], ["frei", "frei.js"]]),
    "src/eigen.js": exporte(["eigen", "e2", "e3"]),
    "src/telephony/netz.js": exporte(["netz", "n2", "n3"]),
    "src/test/probe.js": exporte(["probe", "p2", "p3"]),
    "src/erzeugt.js": exporte(["erzeugt", "z2", "z3"]),
    "src/frei.js": exporte(["frei", "unbenutzt"]),
  });
  const { ziel } = await waehle(context, probe);
  assert.equal(ziel.datei, "src/frei.js");
});

test("ziele-auswahl: eine Datei mit den meisten Befunden ohne erreichenden Test wird nicht gewählt", async (context) => {
  const probe = repo(context, {
    "knip.json": JSON.stringify({ entry: ["src/main.js", "src/neben.js"], project: ["src/**/*.js"] }),
    "src/main.js": hauptdatei([["frei", "frei.js"]]),
    "src/neben.js": hauptdatei([["ohne", "ohnetest.js"]]),
    "src/ohnetest.js": exporte(["ohne", "o2", "o3", "o4"]),
    "src/frei.js": exporte(["frei", "unbenutzt"]),
  });
  const { ziel } = await waehle(context, probe);
  assert.equal(ziel.datei, "src/frei.js");
});

test("ziele-auswahl: knip meldet eine unbenutzte Datei, der Lauf wählt sie nicht und löscht nichts", async (context) => {
  const probe = repo(context, {
    "src/main.js": hauptdatei([["frei", "frei.js"]]),
    "src/frei.js": exporte(["frei"]),
    "src/verwaist.js": exporte(["verwaist", "v2"]),
  });
  const { ziel } = await waehle(context, probe);
  assert.equal(ziel.ausgang, "sauber");
  assert.ok(existsSync(join(probe.ordner, "src/verwaist.js")));
});

test("ziele-auswahl: ein Symbol, das außerhalb der Datei genannt wird, etwa in tools/, macht die Datei nicht zum Kandidaten", async (context) => {
  const probe = repo(context, {
    "src/main.js": hauptdatei([["frei", "frei.js"]]),
    "src/frei.js": exporte(["frei", "nurAnderswo"]),
    "tools/werkzeug.mjs": quelltext(['import { nurAnderswo } from "../src/frei.js";', "nurAnderswo();"]),
  });
  const { ziel } = await waehle(context, probe);
  assert.deepEqual([ziel.ausgang, ziel.datei], ["sauber", undefined]);
});

test("ziele-auswahl: die Datei mit den meisten Befunden gewinnt, bei Gleichstand der Pfad nach dem Alphabet", async (context) => {
  const probe = repo(context, {
    "src/main.js": hauptdatei([["eins", "a.js"], ["zwei", "c.js"], ["drei", "b.js"]]),
    "src/a.js": exporte(["eins", "a2"]),
    "src/b.js": exporte(["drei", "b2", "b3"]),
    "src/c.js": exporte(["zwei", "c2", "c3"]),
  });
  const { ziel } = await waehle(context, probe);
  assert.deepEqual([ziel.sorte, ziel.datei, ziel.zielbefunde.length], ["knip", "src/b.js", ZWEI_BEFUNDE]);
  assert.deepEqual(ziel.kandidaten.map(({ datei }) => datei), ["src/b.js", "src/c.js", "src/a.js"]);
});

test("ziele-auswahl: nach einem knip-PR ist jscpd dran, und nur Kopien innerhalb derselben Datei zählen", async (context) => {
  const probe = repo(context, {
    "src/main.js": hauptdatei([["frei", "frei.js"], ["eins", "kopie.js"], ["zwei", "kopie.js"], ["links", "links.js"], ["rechts", "rechts.js"]]),
    "src/frei.js": exporte(["frei", "unbenutzt"]),
    "src/kopie.js": quelltext([block("eins"), block("zwei")]),
    "src/links.js": quelltext([block("links")]),
    "src/rechts.js": quelltext([block("rechts")]),
  });
  const pulls = [{ ...eigenerPr(KNIP_PR, { sorte: "knip", state: "closed" }), merged_at: "2026-10-01T00:00:00Z" }];
  const { ziel } = await waehle(context, probe, { pulls });
  assert.deepEqual([ziel.sorte, ziel.datei, ziel.zielbefunde.length], ["jscpd", "src/kopie.js", 1]);
});

test("ziele-auswahl: eine Datei mit eingefrorenen ESLint-Verstößen ist für jscpd kein Kandidat und für knip nur ohne Agent", async (context) => {
  const probe = repo(context, {
    "eslint-suppressions.json": JSON.stringify({ "src/kopie.js": { "no-var": { count: 1 } }, "src/frei.js": { "no-var": { count: 1 } } }),
    "src/main.js": hauptdatei([["frei", "frei.js"], ["eins", "kopie.js"], ["zwei", "kopie.js"]]),
    "src/frei.js": exporte(["frei", "unbenutzt"]),
    "src/kopie.js": quelltext([block("eins"), block("zwei")]),
  });
  const pulls = [{ ...eigenerPr(KNIP_PR, { sorte: "knip", state: "closed" }), merged_at: "2026-10-01T00:00:00Z" }];
  const { ziel } = await waehle(context, probe, { pulls });
  assert.deepEqual([ziel.sorte, ziel.datei, ziel.agentErlaubt], ["knip", "src/frei.js", false]);
  assert.deepEqual(ziel.uebersprungen, ["jscpd ohne Kandidaten"]);
});

test("ziele-auswahl: ein doppelter Export ist nur Kandidat, wenn der wegfallende Name nirgends sonst steht und der Agent erlaubt ist", async (context) => {
  const dateien = {
    "src/main.js": hauptdatei([["einmal", "frei.js"]]),
    "src/frei.js": quelltext(["export function einmal() {\n  return 2;\n}", "export const doppelt = einmal;"]),
  };
  const erlaubt = await waehle(context, repo(context, dateien));
  assert.deepEqual([erlaubt.ziel.datei, erlaubt.ziel.agentErlaubt], ["src/frei.js", true]);
  assert.ok(erlaubt.ziel.zielbefunde.includes("duplicates einmal+doppelt (entfernbar: doppelt)"), erlaubt.ziel.zielbefunde.join("; "));
  const unterdrueckt = await waehle(context, repo(context, { ...dateien, "eslint-suppressions.json": JSON.stringify({ "src/frei.js": { "no-var": { count: 1 } } }) }));
  assert.equal(unterdrueckt.ziel.ausgang, "sauber");
});

test("ziele-auswahl: meldet basis-vergleich behobene Einträge, wird zuerst nur die Basislinie gekürzt, außer ein jüngerer Befund sperrt sie", async (context) => {
  const probe = einfachesRepo(context);
  const basis = gelesen(probe.ordner, "tools/basis/knip.json");
  probe.committe({ "tools/basis/knip.json": JSON.stringify({ befunde: [...basis.befunde, "exports|src/alt.js|weg"].sort() }) });
  const frei = await waehle(context, probe);
  assert.deepEqual([frei.ziel.sorte, frei.ziel.datei, frei.ziel.zielbefunde], ["basis", "tools/basis/knip.json", ["exports|src/alt.js|weg"]]);
  const gesperrt = await waehle(context, probe, { issues: [befundIssue("tools/basis/knip.json", { created_at: MORGEN })] });
  assert.deepEqual([gesperrt.ziel.sorte, gesperrt.ziel.datei], ["knip", "src/frei.js"]);
});

test("ziele-auswahl: eine Datei mit einem jüngeren Befund-Issue wird erst nach einer Änderung auf master wieder gewählt", async (context) => {
  const probe = einfachesRepo(context);
  const anfang = { issues: [befundIssue("src/frei.js", { comments: 1 })], kommentare: [{ nummer: BEFUND_ISSUE, body: "Wieder aufgetreten: Lauf 1", user: { login: "github-actions[bot]" }, created_at: MORGEN }] };
  const vorher = await waehle(context, probe, anfang);
  assert.deepEqual([vorher.ziel.ausgang, vorher.ziel.datei], ["sauber", undefined]);
  const geaendert = exporte(["frei", "unbenutzt"]).replace('return "unbenutzt"', 'return "anders"');
  probe.committeAm({ "src/frei.js": geaendert }, { nachricht: "Ändere frei.js", datum: new Date(Date.now() + ZWEI_TAGE_MS).toISOString() });
  const nachher = await waehle(context, probe, anfang);
  assert.deepEqual([nachher.ziel.ausgang, nachher.ziel.datei], ["weiter", "src/frei.js"]);
});

test("ziele-auswahl: ein Kommentar „Wieder aufgetreten“ von einem anderen Konto sperrt keine Datei", async (context) => {
  const probe = einfachesRepo(context);
  const kommentar = { nummer: BEFUND_ISSUE, body: "Wieder aufgetreten: Lauf 1", user: { login: "jemand" }, created_at: MORGEN };
  const { ziel } = await waehle(context, probe, { issues: [befundIssue("src/frei.js", { comments: 1 })], kommentare: [kommentar] });
  assert.deepEqual([ziel.ausgang, ziel.datei], ["weiter", "src/frei.js"]);
});

test("ziele-auswahl: ein Befund-Issue, das kein Bot angelegt hat, sperrt keine Datei", async (context) => {
  const probe = einfachesRepo(context);
  const { ziel } = await waehle(context, probe, { issues: [befundIssue("src/frei.js", { created_at: MORGEN, user: { login: "jemand" } })] });
  assert.equal(ziel.datei, "src/frei.js");
});

test("ziele-auswahl: ein geschlossener, nicht gemergter eigener PR sperrt seine Datei für seine Sorte, bis sie sich auf master ändert", async (context) => {
  const probe = einfachesRepo(context);
  const pulls = [eigenerPr(KNIP_PR, { sorte: "knip", datei: "src/frei.js", state: "closed" })];
  const vorher = await waehle(context, probe, { pulls });
  assert.deepEqual([vorher.ziel.ausgang, vorher.ziel.datei], ["sauber", undefined]);
  const geaendert = exporte(["frei", "unbenutzt"]).replace('return "unbenutzt"', 'return "anders"');
  probe.committeAm({ "src/frei.js": geaendert }, { nachricht: "Ändere frei.js", datum: new Date(Date.now() + ZWEI_TAGE_MS).toISOString() });
  const nachher = await waehle(context, probe, { pulls });
  assert.deepEqual([nachher.ziel.ausgang, nachher.ziel.datei], ["weiter", "src/frei.js"]);
});

test("ziele-auswahl: knip, jscpd und git grep laufen ohne das GitHub-Token in der Umgebung", async (context) => {
  const probe = einfachesRepo(context);
  const git = protokollierendesGit(context);
  const zusatz = { PATH: `${git.pfad}:${process.env.PATH}`, GITHUB_TOKEN: "zweites-token" };
  const { status, ziel, github } = await waehle(context, probe, { zusatz });
  assert.equal(status, 0);
  assert.equal(ziel.datei, "src/frei.js");
  const eintraege = git.eintraege();
  assert.ok(eintraege.length > 0);
  assert.deepEqual([...new Set(eintraege)], ["|"]);
  const { anmeldungen } = github.zustand;
  assert.deepEqual([...new Set(anmeldungen)], ["Bearer probe-token"]);
});

test("ziele-auswahl: das Prüfskript des pre-commit-Hooks ist im echten Repo nie Kandidat", () => {
  const lage = gitSchutzLage(REPO_ROOT);
  assert.notEqual(schutzGrund("scripts/check-staged-suppressions.js", lage), null);
  assert.equal(schutzGrund("scripts/iel-mess-audio.mjs", lage), null);
});

test("ziele-auswahl: ohne Kandidaten endet die Wahl sauber", async (context) => {
  const probe = repo(context, {
    "src/main.js": hauptdatei([["frei", "frei.js"]]),
    "src/frei.js": exporte(["frei"]),
  });
  const { status, ziel } = await waehle(context, probe);
  assert.equal(status, 0);
  assert.equal(ziel.ausgang, "sauber");
  assert.match(ziel.grund, /knip ohne Kandidaten; jscpd ohne Kandidaten/);
});
