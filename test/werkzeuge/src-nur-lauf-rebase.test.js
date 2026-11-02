import assert from "node:assert/strict";
import { test } from "node:test";

import { AUFTRAG, EXIT_BEFUND, EXIT_OK, PHASENDATEI, PLAN, WERKZEUG, gitIn, json, nachricht, sha } from "./src-nur-lauf-hilfen.js";
import { commitAll, probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { REPO, starteWerkzeug } from "./warteschlange/hilfen.mjs";

const NUMMER = 2562;
const ZEILEN = 12;
const KONFLIKT_ZEILE = 3;
const MASTER_ZEILE = 7;
const PAKET_ZEILE = 10;
const MITTLERE_ZEILE = 6;
const AUSSERHALB_ZEILE = 12;
const ZEILE_ZEIGT = 1;
const AUFTRAG_B3B = { ...AUFTRAG, id: "b3b", ziel: "Ändere app.js", erwarteteDateien: ["src/app.js", "src/anderes.js", "test/app.test.js"] };
const AUFTRAG_B3C = { ...AUFTRAG, id: "b3c", ziel: "Ändere anderes.js", erwarteteDateien: ["src/app.js", "src/anderes.js", "test/app.test.js"] };
const PLAN_B3B = { ...PLAN, auftraege: [AUFTRAG_B3B] };
const PLAN_ZWEI = { ...PLAN, auftraege: [AUFTRAG_B3B, AUFTRAG_B3C] };
const ANDERES = "export const anderes = 1;\n";
const AUSSERHALB = /src-Änderung außerhalb einer Konfliktstelle, nicht von lauf/;
const KONFLIKT_GELOEST = "Konflikt gelöst: src/app.js\n";

function app(aenderungen = {}) {
  const zeilen = Array.from({ length: ZEILEN }, (_unbenutzt, index) => aenderungen[index + ZEILE_ZEIGT] ?? `zeile ${index + ZEILE_ZEIGT}`);
  return `${zeilen.join("\n")}\n`;
}

const MASTER_STAND = { [KONFLIKT_ZEILE]: "Master 3", [MASTER_ZEILE]: "Master 7" };
const PAKET_STAND = { [KONFLIKT_ZEILE]: "Paket 3", [PAKET_ZEILE]: "Paket 10" };

function vorgaengerRepo(context, { master = MASTER_STAND, paket = PAKET_STAND, paketDateien = {}, basisDateien = {}, text = nachricht(PLAN_B3B, AUFTRAG_B3B) } = {}) {
  const verzeichnis = probeRepository(context, { [PHASENDATEI]: json(PLAN_B3B), "src/app.js": app(), "src/anderes.js": ANDERES, ...basisDateien });
  const anfang = sha(verzeichnis);
  gitIn(verzeichnis, "checkout", "-q", "-b", "alt");
  writeFiles(verzeichnis, { "src/app.js": app(paket), ...paketDateien });
  commitAll(verzeichnis, text);
  const vorgaenger = sha(verzeichnis);
  gitIn(verzeichnis, "checkout", "-q", "-b", "neu", anfang);
  if (master !== null) {
    writeFiles(verzeichnis, { "src/app.js": app(master) });
    commitAll(verzeichnis, "Master ändert app.js");
  }
  return { verzeichnis, vorgaenger, basis: sha(verzeichnis), text };
}

function loesung(repo, { aenderungen, dateien = {}, zusatz = KONFLIKT_GELOEST, text = nachricht(PLAN_B3B, AUFTRAG_B3B) }) {
  writeFiles(repo.verzeichnis, { "src/app.js": app(aenderungen), ...dateien });
  commitAll(repo.verzeichnis, `${text}${zusatz}`);
}

const SAUBERE_LOESUNG = { [KONFLIKT_ZEILE]: "Aufgeloest 3", [MASTER_ZEILE]: "Master 7", [PAKET_ZEILE]: "Paket 10" };

async function pruefeUmlegung(context, repo, { koepfe = [repo.vorgaenger], routen = [], weitereSeiten = false }) {
  const knoten = koepfe.map((oid) => ({ beforeCommit: { oid } }));
  const pageInfo = { hasPreviousPage: weitereSeiten };
  const antwort = { data: { repository: { pullRequest: { timelineItems: { nodes: knoten, pageInfo } } } } };
  const github = await scheinGithub(context, new Map([["POST /graphql", antwort], ...routen]));
  const umgebung = { GITHUB_API_URL: github.url, GITHUB_GRAPHQL_URL: `${github.url}/graphql`, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO };
  const argumente = [WERKZEUG, "--basis", repo.basis, "--kopf", "HEAD", "--ereignis", "pull_request", "--pr", String(NUMMER)];
  return starteWerkzeug(argumente, { cwd: repo.verzeichnis, umgebung });
}

async function erwarteAusserhalb(context, repo, datei) {
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, AUSSERHALB);
  assert.ok(lauf.stderr.includes(datei), lauf.stderr);
}

test("B3b: eine Lösung nur in der Konfliktstelle von src/app.js gegen master ist grün", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: dieselbe Lösung plus eine Zeile außerhalb der Konfliktstelle in src/app.js ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" } });
  await erwarteAusserhalb(context, repo, "src/app.js");
});

test("B3b: eine Änderung in einer zweiten src-Datei, die der automatische Merge nicht anfasst, ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG, dateien: { "src/anderes.js": "export const anderes = 2;\n" } });
  await erwarteAusserhalb(context, repo, "src/anderes.js");
});

test("B3b: eine zurückgenommene Zeile des automatischen Ergebnisses außerhalb der Konfliktstelle ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: { [KONFLIKT_ZEILE]: "Aufgeloest 3", [MASTER_ZEILE]: "Master 7" } });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, AUSSERHALB);
});

test("B3b: ein PR ohne Force-Push wird wie bisher geprüft, auch mit Handarbeit außerhalb einer Konfliktstelle", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" } });
  const lauf = await pruefeUmlegung(context, repo, { koepfe: [] });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: ohne die Zeile „Konflikt gelöst“ in der Nachricht ist der Commit rot und nennt die Datei", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG, zusatz: "" });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /Konfliktstelle in src\/app\.js fehlt in der Zeile „Konflikt gelöst/);
});

test("B3b: ein Rebase ohne Konflikt, der dem automatischen Ergebnis gleicht, ist grün", async (context) => {
  const repo = vorgaengerRepo(context);
  gitIn(repo.verzeichnis, "reset", "-q", "--hard", "HEAD~1");
  writeFiles(repo.verzeichnis, { "src/app.js": app({ [MASTER_ZEILE]: "Master 7" }) });
  commitAll(repo.verzeichnis, "Master ändert nur Zeile 7");
  const basis = sha(repo.verzeichnis);
  loesung(repo, { aenderungen: { [MASTER_ZEILE]: "Master 7", [KONFLIKT_ZEILE]: "Paket 3", [PAKET_ZEILE]: "Paket 10" }, zusatz: "" });
  const lauf = await pruefeUmlegung(context, { ...repo, basis }, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

const ZWEI_KONFLIKTE = { master: { [KONFLIKT_ZEILE]: "Master 3", [PAKET_ZEILE]: "Master 10" }, paket: PAKET_STAND };
const BEIDE_GELOEST = { [KONFLIKT_ZEILE]: "Aufgeloest 3", [PAKET_ZEILE]: "Aufgeloest 10" };

test("B3b: zwei Konfliktstellen, beide gelöst und dazwischen unverändert, sind grün", async (context) => {
  const repo = vorgaengerRepo(context, ZWEI_KONFLIKTE);
  loesung(repo, { aenderungen: BEIDE_GELOEST });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: zwei Konfliktstellen mit einer Handänderung zwischen ihnen sind rot", async (context) => {
  const repo = vorgaengerRepo(context, ZWEI_KONFLIKTE);
  loesung(repo, { aenderungen: { ...BEIDE_GELOEST, [MITTLERE_ZEILE]: "heimlich" } });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, AUSSERHALB);
});

test("B3b: bei mehreren Force-Pushes gilt der jüngste Vorgänger, nicht der erste", async (context) => {
  const repo = vorgaengerRepo(context);
  const ersterKopf = repo.vorgaenger;
  gitIn(repo.verzeichnis, "checkout", "-q", "-b", "alt2", ersterKopf);
  writeFiles(repo.verzeichnis, { "src/app.js": app({ ...PAKET_STAND, [PAKET_ZEILE]: "Paket 10 neu" }) });
  gitIn(repo.verzeichnis, "commit", "-q", "--amend", "-a", "--no-edit");
  const juengsterKopf = sha(repo.verzeichnis);
  gitIn(repo.verzeichnis, "checkout", "-q", "neu");
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [PAKET_ZEILE]: "Paket 10 neu" } });
  const lauf = await pruefeUmlegung(context, repo, { koepfe: [ersterKopf, juengsterKopf] });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: in der Merge-Gruppe wird der PR-Kopf nicht noch einmal gegen die Force-Push-Vorgänger gerechnet", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" } });
  const github = await scheinGithub(context, new Map());
  const umgebung = { GITHUB_API_URL: github.url, GITHUB_GRAPHQL_URL: `${github.url}/graphql`, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO };
  const queueRef = `refs/heads/gh-readonly-queue/master/pr-${NUMMER}-${repo.basis}`;
  const argumente = [WERKZEUG, "--basis", repo.basis, "--kopf", "HEAD", "--ereignis", "merge_group", "--queue-ref", queueRef];
  const lauf = await starteWerkzeug(argumente, { cwd: repo.verzeichnis, umgebung });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(github.anfragen.length, 0);
});

test("B3b: ein Vorgänger-Kopf, der lokal fehlt, wird vom Remote geholt und die Handarbeit außerhalb ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" } });
  gitIn(repo.verzeichnis, "config", "uploadpack.allowAnySHA1InWant", "true");
  const klon = probeDirectory(context, {});
  gitIn(klon, "clone", "-q", "--branch", "neu", "--single-branch", `file://${repo.verzeichnis}`, ".");
  const lauf = await pruefeUmlegung(context, { ...repo, verzeichnis: klon }, {});
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, AUSSERHALB);
});

test("B3b: eine vom automatischen Merge übernommene Änderung in einer zweiten src-Datei, die fehlt, ist rot", async (context) => {
  const repo = vorgaengerRepo(context, { paketDateien: { "src/anderes.js": "export const anderes = 3;\n" } });
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  await erwarteAusserhalb(context, repo, "src/anderes.js");
});

test("B3b: ein Commit auf demselben Stand wie sein Vorgänger ist kein Rebase und wird wie bisher geprüft", async (context) => {
  const repo = vorgaengerRepo(context, { master: null });
  loesung(repo, { aenderungen: { ...PAKET_STAND, [AUSSERHALB_ZEILE]: "heimlich" }, zusatz: "" });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: ein Vorgänger ohne Eltern wird nicht nachgerechnet und der Schritt bricht nicht ab", async (context) => {
  const repo = vorgaengerRepo(context);
  gitIn(repo.verzeichnis, "checkout", "-q", "--orphan", "waise");
  writeFiles(repo.verzeichnis, { [PHASENDATEI]: json(PLAN_B3B), "src/app.js": app(PAKET_STAND), "src/anderes.js": ANDERES });
  commitAll(repo.verzeichnis, nachricht(PLAN_B3B, AUFTRAG_B3B));
  const waise = sha(repo.verzeichnis);
  gitIn(repo.verzeichnis, "checkout", "-q", "neu");
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" } });
  const lauf = await pruefeUmlegung(context, repo, { koepfe: [waise] });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: ein Altbestand-Commit ohne Auftrag-Zeile wird nicht gegen einen Force-Push-Vorgänger gerechnet", async (context) => {
  const liste = json({ [NUMMER]: { kuerzel: "B3a", grund: "Antonio: Kurzauftrag vor dem Pflicht-Check" } });
  const handarbeit = "Ändere app.js von Hand\n";
  const repo = vorgaengerRepo(context, { basisDateien: { "tools/basis/altbestand-ohne-auftrag.json": liste }, text: handarbeit });
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" }, zusatz: "", text: handarbeit });
  const api = `GET /repos/${REPO}/pulls/${NUMMER}`;
  const routen = [[api, { head: { sha: sha(repo.verzeichnis) } }], [`${api}/reviews`, [{ user: { login: "Antonio20045" }, state: "APPROVED", commit_id: sha(repo.verzeichnis) }]]];
  const lauf = await pruefeUmlegung(context, repo, { routen });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: bei zwei Aufträgen im PR wird jeder Commit gegen den Vorgänger mit derselben Auftrag-Zeile gerechnet", async (context) => {
  const repo = vorgaengerRepo(context, { basisDateien: { [PHASENDATEI]: json(PLAN_ZWEI) } });
  gitIn(repo.verzeichnis, "checkout", "-q", "alt");
  writeFiles(repo.verzeichnis, { "src/anderes.js": "export const anderes = 5;\n" });
  commitAll(repo.verzeichnis, nachricht(PLAN_ZWEI, AUFTRAG_B3C));
  const vorgaenger = sha(repo.verzeichnis);
  gitIn(repo.verzeichnis, "checkout", "-q", "neu");
  loesung(repo, { aenderungen: SAUBERE_LOESUNG, text: nachricht(PLAN_ZWEI, AUFTRAG_B3B) });
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" }, dateien: { "src/anderes.js": "export const anderes = 5;\n" }, zusatz: "", text: nachricht(PLAN_ZWEI, AUFTRAG_B3C) });
  const lauf = await pruefeUmlegung(context, repo, { koepfe: [vorgaenger] });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, AUSSERHALB);
  assert.match(lauf.stderr, /src\/app\.js/);
});

function zweiVorgaenger(context) {
  const repo = vorgaengerRepo(context);
  gitIn(repo.verzeichnis, "checkout", "-q", "alt");
  writeFiles(repo.verzeichnis, { "src/app.js": app({ ...PAKET_STAND, [AUSSERHALB_ZEILE]: "zweiter Stand" }) });
  commitAll(repo.verzeichnis, nachricht(PLAN_B3B, AUFTRAG_B3B));
  const vorgaenger = sha(repo.verzeichnis);
  gitIn(repo.verzeichnis, "checkout", "-q", "neu");
  return { ...repo, vorgaenger };
}

test("B3b: zwei Vorgänger mit derselben Auftrag-Zeile und eine Abweichung von beiden außerhalb der Konfliktstelle sind rot", async (context) => {
  const repo = zweiVorgaenger(context);
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" } });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, AUSSERHALB);
});

test("B3b: zwei Vorgänger mit derselben Auftrag-Zeile und eine Lösung gleich dem automatischen Ergebnis eines davon sind grün", async (context) => {
  const repo = zweiVorgaenger(context);
  loesung(repo, { aenderungen: { ...MASTER_STAND, [AUSSERHALB_ZEILE]: "zweiter Stand" }, zusatz: "" });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: eine umformulierte Nachricht mit derselben Auftrag-Zeile und Handarbeit außerhalb der Konfliktstelle ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" }, zusatz: `${KONFLIKT_GELOEST}Nach dem Rebase anders formuliert.\n` });
  await erwarteAusserhalb(context, repo, "src/app.js");
});

test("B3b: ein nachgeschobener Kopf auf derselben Basis wird gegen den älteren Vorgänger mit anderer Basis gerechnet und die Handarbeit ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  const sauber = sha(repo.verzeichnis);
  gitIn(repo.verzeichnis, "reset", "-q", "--hard", "HEAD~1");
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" } });
  const lauf = await pruefeUmlegung(context, repo, { koepfe: [repo.vorgaenger, sauber] });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, AUSSERHALB);
});

const NICHT_PRUEFBAR = /ob der Commit umgelegt wurde, ist nicht prüfbar/;

async function erwarteNichtPruefbar(context, repo, { grund, ...optionen }) {
  const lauf = await pruefeUmlegung(context, repo, optionen);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, grund);
  assert.match(lauf.stderr, NICHT_PRUEFBAR);
}

test("B3b: sind die Force-Push-Ereignisse nicht lesbar, ist der Schritt rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  const fehler = { errors: [{ message: "Zugriff verweigert" }] };
  await erwarteNichtPruefbar(context, repo, { routen: [["POST /graphql", fehler]], grund: /Force-Push-Ereignisse des PR 2562 nicht lesbar/ });
});

test("B3b: ein Vorgänger-Kopf, der auch vom Remote nicht zu holen ist, macht den Schritt rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  await erwarteNichtPruefbar(context, repo, { koepfe: ["0".repeat(40)], grund: /der frühere PR-Kopf 0000000 lässt sich weder lokal noch vom Remote holen/ });
});

test("B3b: gibt es mehr Force-Push-Ereignisse, als eine Seite liefert, ist der Schritt rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  await erwarteNichtPruefbar(context, repo, { weitereSeiten: true, grund: /mehr als 100 Force-Pushes/ });
});

test("B3b: fehlt im pull_request-Lauf die PR-Nummer, ist der Schritt rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  const argumente = [WERKZEUG, "--basis", repo.basis, "--kopf", "HEAD", "--ereignis", "pull_request"];
  const lauf = await starteWerkzeug(argumente, { cwd: repo.verzeichnis, umgebung: {} });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, /die PR-Nummer fehlt/);
});

function ruecktMasterWeiter(repo, { aenderungen }) {
  const umgelegt = sha(repo.verzeichnis);
  gitIn(repo.verzeichnis, "checkout", "-q", "-b", "neu2", repo.basis);
  writeFiles(repo.verzeichnis, { "src/app.js": app({ ...MASTER_STAND, ...aenderungen }) });
  commitAll(repo.verzeichnis, "Master rückt weiter");
  const basis = sha(repo.verzeichnis);
  gitIn(repo.verzeichnis, "cherry-pick", umgelegt);
  return { ...repo, basis, koepfe: [repo.vorgaenger, umgelegt] };
}

const MASTER_ZEILE_EINS = { 1: "Master 1" };

test("B3b: Handarbeit außerhalb der Konfliktstelle, die ein früherer Stand trug, geht beim zweiten Umlegen nicht grün durch", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, [AUSSERHALB_ZEILE]: "heimlich" } });
  const weiter = ruecktMasterWeiter(repo, { aenderungen: MASTER_ZEILE_EINS });
  const lauf = await pruefeUmlegung(context, weiter, { koepfe: weiter.koepfe });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, AUSSERHALB);
});

test("B3b: ein sauberer früherer Stand bleibt beim zweiten Umlegen grün", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  const weiter = ruecktMasterWeiter(repo, { aenderungen: MASTER_ZEILE_EINS });
  const lauf = await pruefeUmlegung(context, weiter, { koepfe: weiter.koepfe });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

function masterLoeschtApp(context) {
  const repo = vorgaengerRepo(context, { master: null });
  gitIn(repo.verzeichnis, "rm", "-q", "src/app.js");
  commitAll(repo.verzeichnis, "Master löscht app.js");
  return { ...repo, basis: sha(repo.verzeichnis) };
}

test("B3b: bei einem Konflikt ohne Konfliktstelle (Datei auf master gelöscht) ist die Fassung des Vorgängers grün", async (context) => {
  const repo = masterLoeschtApp(context);
  loesung(repo, { aenderungen: PAKET_STAND });
  const lauf = await pruefeUmlegung(context, repo, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("B3b: bei einem Konflikt ohne Konfliktstelle (Datei auf master gelöscht) ist eine Fassung mit Handarbeit rot", async (context) => {
  const repo = masterLoeschtApp(context);
  loesung(repo, { aenderungen: { ...PAKET_STAND, [AUSSERHALB_ZEILE]: "heimlich" } });
  await erwarteAusserhalb(context, repo, "src/app.js");
});

test("B3b: eine Datei mit Konfliktstelle, die beim Lösen ganz gelöscht wird, ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  gitIn(repo.verzeichnis, "rm", "-q", "src/app.js");
  commitAll(repo.verzeichnis, `${nachricht(PLAN_B3B, AUFTRAG_B3B)}${KONFLIKT_GELOEST}`);
  await erwarteAusserhalb(context, repo, "src/app.js");
});

test("B3b: eine geänderte Dateiart außerhalb der Konfliktstelle bei gleichem Inhalt ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  gitIn(repo.verzeichnis, "update-index", "--chmod=+x", "src/anderes.js");
  gitIn(repo.verzeichnis, "commit", "-q", "--amend", "--no-edit");
  await erwarteAusserhalb(context, repo, "src/anderes.js");
});

test("B3b: eine geänderte Dateiart der Konfliktdatei bei sonst richtiger Lösung ist rot", async (context) => {
  const repo = vorgaengerRepo(context);
  loesung(repo, { aenderungen: SAUBERE_LOESUNG });
  gitIn(repo.verzeichnis, "update-index", "--chmod=+x", "src/app.js");
  gitIn(repo.verzeichnis, "commit", "-q", "--amend", "--no-edit");
  await erwarteAusserhalb(context, repo, "src/app.js");
});

const MARKER_ABSTAND = 1;
const ATTRAPPE = { ...PAKET_STAND, [PAKET_ZEILE - MARKER_ABSTAND]: "<<<<<<< attrappe", [PAKET_ZEILE + MARKER_ABSTAND]: ">>>>>>> attrappe" };

test("B3b: Zeilen wie Konfliktmarker im Quelltext gelten nicht als Konfliktstelle, Handarbeit zwischen ihnen ist rot", async (context) => {
  const repo = vorgaengerRepo(context, { paket: ATTRAPPE });
  loesung(repo, { aenderungen: { ...SAUBERE_LOESUNG, ...ATTRAPPE, [KONFLIKT_ZEILE]: "Aufgeloest 3", [PAKET_ZEILE]: "heimlich" } });
  await erwarteAusserhalb(context, repo, "src/app.js");
});
