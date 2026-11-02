import assert from "node:assert/strict";
import { test } from "node:test";

import { ANFANGSDATEIEN, EXIT_BEFUND, EXIT_OK, WERKZEUG, aendereA, gitIn, json, sha } from "./src-nur-lauf-hilfen.js";
import { commitAll, probeRepository, writeFiles } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug } from "./warteschlange/hilfen.mjs";

const LISTE = "tools/basis/altbestand-ohne-auftrag.json";
const NUMMER = 7;
const FREIGEBER = "Antonio20045";
const PULL = `GET ${API_PFAD}/pulls/${NUMMER}`;
const REVIEWS = `GET ${API_PFAD}/pulls/${NUMMER}/reviews`;
const HANDARBEIT = "Ändere a.js von Hand\n";
const ALTER_KOPF = "a".repeat(40);
const EINTRAG = { kuerzel: "B3a", grund: "Antonio 01.11. 10:3x / 02.11.: Kurzauftrag vor SLN, Antonio approvt selbst" };
const AUS_DEM_PULL_REQUEST = ["--ereignis", "pull_request", "--pr", String(NUMMER)];
const WARTET = /Altbestand: wartet auf Antonios Approve am Kopf/;
const OHNE_ZEILE = /keine einzelne Zeile „Auftrag: <Phase>\/<Auftrag>“/;

function review(kopf, login = FREIGEBER, state = "APPROVED") {
  return { user: { login }, state, commit_id: kopf };
}

function mitListe(stand) {
  return stand === null ? {} : { [LISTE]: json(stand) };
}

function umgebungFuer(github) {
  return { GITHUB_API_URL: github.url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO };
}

async function pruefeAltbestand(context, { basisListe = { [NUMMER]: EINTRAG }, kopfListe = basisListe, commitText = HANDARBEIT, reviews = (kopf) => [review(kopf)], optionen = AUS_DEM_PULL_REQUEST }) {
  const verzeichnis = probeRepository(context, { ...ANFANGSDATEIEN, ...mitListe(basisListe) });
  const basis = sha(verzeichnis);
  if (kopfListe !== basisListe) {
    writeFiles(verzeichnis, mitListe(kopfListe));
    commitAll(verzeichnis, "Ändere die Liste");
  }
  aendereA(verzeichnis, commitText);
  const kopf = sha(verzeichnis);
  const github = await scheinGithub(context, new Map([[PULL, { head: { sha: kopf } }], [REVIEWS, reviews(kopf)]]));
  const argumente = [WERKZEUG, "--basis", basis, "--kopf", "HEAD", ...optionen];
  const lauf = await starteWerkzeug(argumente, { cwd: verzeichnis, umgebung: umgebungFuer(github) });
  return { ...lauf, anfragen: github.anfragen };
}

test("Rot-Probe a: ein src-Commit ohne Auftrag in einem PR außerhalb der Liste ist rot und fragt GitHub nicht", async (context) => {
  const lauf = await pruefeAltbestand(context, { optionen: ["--ereignis", "pull_request", "--pr", "9"] });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, OHNE_ZEILE);
  assert.equal(lauf.anfragen.length, 0);
});

test("Rot-Probe b: ein gelisteter PR ohne Approve am Kopf ist rot und sagt, worauf er wartet", async (context) => {
  const lauf = await pruefeAltbestand(context, { reviews: () => [] });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, WARTET);
});

test("Rot-Probe c: ein gelisteter PR mit Approve von Antonio20045 am Kopf ist grün", async (context) => {
  const lauf = await pruefeAltbestand(context, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("Rot-Probe d: ein neuer Eintrag in der Liste ist rot", async (context) => {
  const kopfListe = { [NUMMER]: EINTRAG, 8: EINTRAG };
  const lauf = await pruefeAltbestand(context, { kopfListe, commitText: "Ändere a.js\n\nAuftrag: x/y\n" });
  assert.match(lauf.stderr, /Altbestand: neuer Eintrag PR 8 in tools\/basis\/altbestand-ohne-auftrag\.json; die Liste darf nur kürzer werden/);
  assert.equal(lauf.status, EXIT_BEFUND);
});

test("ein neu eingetragener PR bekommt die Ausnahme nicht, auch nicht mit Approve am Kopf", async (context) => {
  const lauf = await pruefeAltbestand(context, { basisListe: {}, kopfListe: { [NUMMER]: EINTRAG } });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, OHNE_ZEILE);
  assert.doesNotMatch(lauf.stderr, WARTET);
});

test("fehlt die Liste am Basis-Stand, gilt die Ausnahme nicht", async (context) => {
  const lauf = await pruefeAltbestand(context, { basisListe: null, kopfListe: { [NUMMER]: EINTRAG } });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, OHNE_ZEILE);
});

test("ein entfernter Eintrag nimmt dem PR die Ausnahme", async (context) => {
  const lauf = await pruefeAltbestand(context, { basisListe: { [NUMMER]: EINTRAG }, kopfListe: {} });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, OHNE_ZEILE);
});

test("ein gelisteter PR ist rot, wenn das Approve an einem alten Kopf liegt", async (context) => {
  const lauf = await pruefeAltbestand(context, { reviews: () => [review(ALTER_KOPF)] });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, WARTET);
});

test("ein gelisteter PR ist rot, wenn nur ein anderes Konto approvt hat", async (context) => {
  const lauf = await pruefeAltbestand(context, { reviews: (kopf) => [review(kopf, "jonas986")] });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, WARTET);
});

test("ein gelisteter PR ist rot, wenn GitHub den PR nicht liefert", async (context) => {
  const nummer = NUMMER + 100;
  const lauf = await pruefeAltbestand(context, { basisListe: { [nummer]: EINTRAG }, optionen: ["--ereignis", "pull_request", "--pr", String(nummer)] });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, /Altbestand: wartet auf Antonios Approve am Kopf \(Pull Request oder Reviews nicht lesbar/);
});

test("die Ausnahme gilt nur für Commits ohne Zeile Auftrag: eine kaputte Zeile bleibt rot", async (context) => {
  const lauf = await pruefeAltbestand(context, { commitText: "Ändere a.js\n\nAuftrag: kaputt\n" });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, OHNE_ZEILE);
});

const WARTESCHLANGE = `refs/heads/gh-readonly-queue/master/pr-${NUMMER}-${"b".repeat(40)}`;
const AUS_DER_WARTESCHLANGE = ["--ereignis", "merge_group", "--queue-ref", WARTESCHLANGE];

async function pruefeInDerGruppe(context, { gruppenText = null, reviews = (kopf) => [review(kopf)] } = {}) {
  const verzeichnis = probeRepository(context, { ...ANFANGSDATEIEN, ...mitListe({ [NUMMER]: EINTRAG }) });
  const haupt = gitIn(verzeichnis, "rev-parse", "--abbrev-ref", "HEAD");
  gitIn(verzeichnis, "checkout", "-q", "-b", "pr");
  aendereA(verzeichnis, HANDARBEIT);
  const prKopf = sha(verzeichnis);
  gitIn(verzeichnis, "update-ref", `refs/pull/${NUMMER}/head`, prKopf);
  gitIn(verzeichnis, "remote", "add", "origin", verzeichnis);
  gitIn(verzeichnis, "checkout", "-q", haupt);
  writeFiles(verzeichnis, { "docs/m.md": "m\n" });
  commitAll(verzeichnis, "Notiere m");
  const basis = sha(verzeichnis);
  if (gruppenText === null) gitIn(verzeichnis, "cherry-pick", prKopf);
  else aendereA(verzeichnis, gruppenText);
  const github = await scheinGithub(context, new Map([[PULL, { head: { sha: prKopf } }], [REVIEWS, reviews(prKopf)]]));
  const argumente = [WERKZEUG, "--basis", basis, "--kopf", "HEAD", ...AUS_DER_WARTESCHLANGE];
  return starteWerkzeug(argumente, { cwd: verzeichnis, umgebung: umgebungFuer(github) });
}

test("in der Merge-Gruppe ist der neu aufgesetzte Commit eines gelisteten PR mit Approve am Kopf grün", async (context) => {
  const lauf = await pruefeInDerGruppe(context);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
});

test("in der Merge-Gruppe ist derselbe Commit ohne Approve am Kopf rot", async (context) => {
  const lauf = await pruefeInDerGruppe(context, { reviews: () => [] });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, WARTET);
});

test("in der Merge-Gruppe ist ein Commit mit anderem Diff rot, auch wenn der gelistete PR approvt ist", async (context) => {
  const lauf = await pruefeInDerGruppe(context, { gruppenText: "Ändere a.js ganz anders von Hand\n" });
  assert.equal(lauf.status, EXIT_BEFUND);
  assert.match(lauf.stderr, OHNE_ZEILE);
});
