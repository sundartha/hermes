import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { scheinSha } from "./pruefer/hilfen.mjs";
import { probeRepository } from "./probe-repo.js";
import { arbeitsordner, botIssue, eigenerLauf, ersatzClaude, gelesen, git, githubAttrappe, starteZiele, umgebung } from "./ziele/hilfen.mjs";

const TAG_MS = 86_400_000;
const LAUF_NUMMER = 8;
const VORSCHLAG = { mechanismus: "lint-regel", dateien: ["eslint.config.js"], rotprobe: "Eine doppelte Funktion in src/x.js wird rot.", begruendung: "Ein Typ trägt hier nicht." };
const LETZTER_LAUF = eigenerLauf(LAUF_NUMMER, scheinSha("9"), { schritt: "Zählen" });
const SYSTEM_NUMMER = 300;
const ERSTES = 1;
const ZWEITES = 2;
const DRITTES = 3;
const VIERTES = 4;
const BEFUND_NUMMER = 5;
const ZWEI_VORKOMMEN = 2;

function issue(nummer, titel, felder = {}) {
  return botIssue(nummer, titel, { labels: [{ name: "pruefer" }], created_at: "2026-09-01T00:00:00Z", ...felder });
}

function vorherVorkommen(nummer, datei) {
  return issue(nummer, `Prüfer: G5 in \`${datei}\``);
}

function neuesVorkommen(nummer, datei) {
  return issue(nummer, `Prüfer: G5 in \`${datei}\``, { created_at: "2026-10-02T00:00:00Z" });
}

async function auswertung(context, anfang, { schritte = ["zaehlen", "vorschlagen", "system-issue", "ergebnis"], antwort = VORSCHLAG } = {}) {
  const repo = probeRepository(context, {
    "README.md": "Probe\n",
    "CLAUDE.md": "Regeln\n",
    ".claude/agents/probe.md": "Agent\n",
    "docs/CLAUDE.md": "Regeln\n",
    "docs/hinweis.md": "Hinweis\n",
    "apps/web/.claude/rolle.md": "Rolle\n",
    "apps/web/app.js": "export const app = 1;\n",
    ".github/budget.json": JSON.stringify({ minutenJeLauf: { Auswertung: 10 } }),
  });
  const github = await githubAttrappe(context, { laeufe: { "auswertung.yml": [LETZTER_LAUF] }, ...anfang });
  const claude = ersatzClaude(context, { antwort });
  const ordner = arbeitsordner(context, { "ausgaben.txt": "" });
  const env = umgebung(github, { HERMES_CLAUDE: claude.programm, CLAUDE_CODE_OAUTH_TOKEN: "schein-token", GITHUB_OUTPUT: join(ordner, "ausgaben.txt") });
  const laeufe = [];
  for (const schritt of schritte) {
    const zusatz = schritt === "ergebnis" ? ["--workflow", "auswertung"] : [];
    laeufe.push(await starteZiele([schritt, "--ordner", ordner, ...zusatz], { cwd: repo, env }));
  }
  return { github, claude, laeufe, repo, zaehlung: gelesen(ordner, "zaehlung/zaehlung.json"), ergebnis: gelesen(ordner, "ergebnis/ergebnis.json"), ausgaben: readFileSync(join(ordner, "ausgaben.txt"), "utf8") };
}

async function zaehleNachLauf(context, { anfang, lauf }) {
  const leer = await auswertung(context, anfang, { schritte: [] });
  const laeufe = { "auswertung.yml": [lauf(git(leer.repo, ["rev-parse", "HEAD"]))] };
  const github = await githubAttrappe(context, { ...anfang, laeufe });
  const ordner = arbeitsordner(context, {});
  await starteZiele(["zaehlen", "--ordner", ordner], { cwd: leer.repo, env: umgebung(github) });
  return gelesen(ordner, "zaehlung/zaehlung.json");
}

function systemIssues(github) {
  return github.zustand.issues.filter(({ title }) => title.startsWith("System: "));
}

test("ziele-auswertung: eine wiederkehrende ID ergibt genau ein system-Issue aus den Feldern des Vorschlags", async (context) => {
  const lauf = await auswertung(context, { issues: [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js")] });
  assert.deepEqual(lauf.laeufe.map(({ status }) => status), [0, 0, 0, 0]);
  const [system] = systemIssues(lauf.github);
  assert.equal(systemIssues(lauf.github).length, 1);
  assert.deepEqual([system.title, system.labels], ["System: G5", [{ name: "system" }]]);
  assert.match(system.body, /^- Mechanismus: lint-regel$/m);
  assert.match(system.body, /^Umsetzung wie ein Paket; Mechanismen in geschützten Dateien brauchen ein Approve\.$/m);
  assert.match(system.body, /^- #1$/m);
  assert.deepEqual([lauf.ergebnis.ausgang, lauf.ergebnis.issue], ["geaendert", system.number]);
  const { argumente, eingabe, dateien, ordner } = lauf.claude.protokoll();
  assert.deepEqual(dateien.filter((pfad) => /(^|\/)(CLAUDE\.md|\.claude)(\/|$)/.test(pfad)), []);
  assert.ok(["README.md", "docs/hinweis.md", "apps/web/app.js", ".github/budget.json"].every((pfad) => dateien.includes(pfad)), dateien.join(", "));
  assert.notEqual(ordner, lauf.repo);
  assert.deepEqual([argumente[argumente.indexOf("--tools") + 1], argumente[argumente.indexOf("--model") + 1]], ["Read,Grep,Glob", "opus"]);
  assert.match(eingabe, /^Issues: #1, #2$/m);
  assert.equal(eingabe.includes("src/a.js"), false);
});

test("ziele-auswertung: gibt es das system-Issue schon, entsteht keins und kein Agent startet", async (context) => {
  const vorhanden = issue(SYSTEM_NUMMER, "System: G5", { labels: [{ name: "system" }], created_at: "2026-09-20T00:00:00Z" });
  const lauf = await auswertung(context, { issues: [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js"), vorhanden] }, { schritte: ["zaehlen"] });
  assert.deepEqual([lauf.zaehlung.ausgang, lauf.zaehlung.grund], ["sauber", "alle wiederkehrenden Befunde haben ein system-Issue"]);
  assert.match(lauf.ausgaben, /^agent=nein$/m);
  assert.equal(systemIssues(lauf.github).length, 1);
});

test("ziele-auswertung: ohne Wiederkehrer endet die Auswertung sauber", async (context) => {
  const lauf = await auswertung(context, { issues: [neuesVorkommen(ZWEITES, "src/b.js")] }, { schritte: ["zaehlen", "ergebnis"] });
  assert.deepEqual([lauf.ergebnis.ausgang, lauf.ergebnis.grund], ["sauber", "kein wiederkehrender Befund"]);
  assert.equal(lauf.claude.protokoll(), null);
});

test("ziele-auswertung: ein Kommentar „Wieder aufgetreten“ zählt als Vorkommen, ohne Änderung an master bleibt es sauber", async (context) => {
  const befund = issue(BEFUND_NUMMER, "Aufräumen: AR-lint in `src/x.js`", { labels: [{ name: "aufraeumen" }], comments: 1 });
  const kommentar = { nummer: BEFUND_NUMMER, body: "Wieder aufgetreten: Lauf 2", user: { login: "github-actions[bot]" }, created_at: "2026-10-03T00:00:00Z", html_url: "https://github.com/sundartha/hermes/issues/5#c1" };
  const lauf = await auswertung(context, { issues: [befund], kommentare: [kommentar] }, { schritte: ["zaehlen"] });
  assert.deepEqual([lauf.zaehlung.ausgang, lauf.zaehlung.kandidat.kennung, lauf.zaehlung.kandidat.anzahl], ["weiter", "AR-lint", ZWEI_VORKOMMEN]);
  const unveraendert = await zaehleNachLauf(context, { anfang: { issues: [befund], kommentare: [kommentar] }, lauf: (kopf) => ({ ...LETZTER_LAUF, head_sha: kopf }) });
  assert.equal(unveraendert.ausgang, "sauber");
});

test("ziele-auswertung: ein früherer Lauf auf demselben Stand, in dem „Zählen“ nicht gelaufen ist, zählt nicht als bearbeitet", async (context) => {
  const anfang = { issues: [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js")] };
  const zaehlung = await zaehleNachLauf(context, { anfang, lauf: (kopf) => eigenerLauf(LAUF_NUMMER, kopf, { schritt: "Zählen", ergebnis: "skipped" }) });
  assert.deepEqual([zaehlung.ausgang, zaehlung.kandidat.kennung], ["weiter", "G5"]);
});

test("ziele-auswertung: kommt eine ID trotz geschlossenem system-Issue wieder, wird es ohne Agent wieder geöffnet", async (context) => {
  const geschlossen = issue(SYSTEM_NUMMER, "System: G5", { labels: [{ name: "system" }], state: "closed", state_reason: "completed", created_at: "2026-09-02T00:00:00Z", closed_at: "2026-09-10T00:00:00Z" });
  const lauf = await auswertung(context, { issues: [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js"), geschlossen] }, { schritte: ["zaehlen", "system-issue", "ergebnis"] });
  assert.deepEqual([geschlossen.state, systemIssues(lauf.github).length], ["open", 1]);
  const [kommentar] = lauf.github.zustand.kommentare;
  assert.match(kommentar.body, /kommt trotz Mechanismus wieder/);
  assert.equal(lauf.claude.protokoll(), null);
  assert.equal(lauf.ergebnis.ausgang, "geaendert");
});

test("ziele-auswertung: gibt es ein system-Issue jünger als sieben Tage, startet kein Agent und der Lauf endet sauber", async (context) => {
  const frisch = issue(SYSTEM_NUMMER, "System: G9", { labels: [{ name: "system" }], created_at: new Date(Date.now() - TAG_MS).toISOString() });
  const lauf = await auswertung(context, { issues: [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js"), frisch] }, { schritte: ["zaehlen"] });
  assert.deepEqual([lauf.zaehlung.ausgang, lauf.zaehlung.grund], ["sauber", "höchstens ein system-Issue je Woche"]);
  assert.match(lauf.ausgaben, /^agent=nein$/m);
});

test("ziele-auswertung: Issues von Menschen und Titel ohne gültige ID zählen nicht", async (context) => {
  const vonHand = { ...neuesVorkommen(ZWEITES, "src/b.js"), user: { login: "jemand" } };
  const ohneId = issue(DRITTES, "Prüfer: Befund in `src/c.js`", { created_at: "2026-10-03T00:00:00Z" });
  const ohneIdAlt = issue(VIERTES, "Prüfer: Befund in `src/d.js`");
  const lauf = await auswertung(context, { issues: [vorherVorkommen(ERSTES, "src/a.js"), vonHand, ohneId, ohneIdAlt] }, { schritte: ["zaehlen"] });
  assert.deepEqual([lauf.zaehlung.ausgang, lauf.zaehlung.grund], ["sauber", "kein wiederkehrender Befund"]);
});

test("ziele-auswertung: ein als nicht geplant geschlossenes system-Issue wird nicht wieder geöffnet", async (context) => {
  const verworfen = issue(SYSTEM_NUMMER, "System: G5", { labels: [{ name: "system" }], state: "closed", state_reason: "not_planned", created_at: "2026-09-02T00:00:00Z", closed_at: "2026-09-10T00:00:00Z" });
  const lauf = await auswertung(context, { issues: [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js"), verworfen] }, { schritte: ["zaehlen"] });
  assert.deepEqual([lauf.zaehlung.ausgang, lauf.zaehlung.grund], ["sauber", "alle wiederkehrenden Befunde haben ein system-Issue"]);
});

test("ziele-auswertung: ein Vorschlag außerhalb des Schemas oder mit dem Token wird verworfen, der Lauf wird rot", async (context) => {
  const issues = [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js")];
  const doku = await auswertung(context, { issues }, { schritte: ["zaehlen", "vorschlagen"], antwort: { ...VORSCHLAG, mechanismus: "doku" } });
  assert.deepEqual(doku.laeufe.map(({ status }) => status), [0, 1]);
  assert.equal(systemIssues(doku.github).length, 0);
  const verraten = await auswertung(context, { issues }, { schritte: ["zaehlen", "vorschlagen"], antwort: { ...VORSCHLAG, begruendung: "Das Token ist schein-token." } });
  assert.deepEqual(verraten.laeufe.map(({ status }) => status), [0, 1]);
  assert.match(verraten.laeufe[1].stdout, /Antwort enthielt das Token/);
});

test("ziele-auswertung: die Antwort „keiner, weil …“ ergibt ein system-Issue mit der Begründung und ohne Bauauftrag", async (context) => {
  const issues = [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js")];
  const keiner = { mechanismus: "keiner", dateien: [], rotprobe: "", begruendung: "keiner, weil der Befund nur in Altcode vorkommt." };
  const lauf = await auswertung(context, { issues }, { antwort: keiner });
  assert.deepEqual(lauf.laeufe.map(({ status }) => status), [0, 0, 0, 0]);
  const [system] = systemIssues(lauf.github);
  assert.match(system.body, /^- Mechanismus: keiner$/m);
  assert.match(system.body, /^> keiner, weil der Befund nur in Altcode vorkommt\.$/m);
  assert.match(system.body, /^Kein Mechanismus vorgeschlagen\. Antonio entscheidet, ob das Issue so geschlossen wird\.$/m);
});

test("ziele-auswertung: die Antwort „bestehende Prüfung ändern oder entfernen“ ergibt einen Vorschlag an Antonio", async (context) => {
  const issues = [vorherVorkommen(ERSTES, "src/a.js"), neuesVorkommen(ZWEITES, "src/b.js")];
  const aendern = {
    mechanismus: "pruefung-aendern",
    dateien: ["tools/basis-vergleich.mjs"],
    rotprobe: "",
    begruendung: "bestehende Prüfung ändern oder entfernen: jscpd meldet hier eine gewollte Wiederholung.",
  };
  const lauf = await auswertung(context, { issues }, { antwort: aendern });
  assert.deepEqual(lauf.laeufe.map(({ status }) => status), [0, 0, 0, 0]);
  const [system] = systemIssues(lauf.github);
  assert.match(system.body, /^- Mechanismus: pruefung-aendern$/m);
  assert.match(system.body, /^- Dateien: `tools\/basis-vergleich\.mjs`$/m);
  assert.match(system.body, /^Vorschlag an Antonio: eine bestehende Prüfung ändern oder entfernen\. Umgesetzt wird erst nach seiner Entscheidung\.$/m);
});
