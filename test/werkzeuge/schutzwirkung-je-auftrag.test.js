import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { nurSchutzRot } from "../../tools/auftrag/schutzkennung.mjs";
import { schutzzuordnung } from "../../tools/mutationspruefung/schutz-auftrag.mjs";
import { freigabenAus, schreibeNichtPruefbar, schutzfreigaben } from "../../tools/mutationspruefung/schutz-pruefagent.mjs";
import { schutzDesUrteils } from "../../tools/mutationspruefung/schutzmessung.mjs";
import { meldeSchutz } from "../../tools/mutationspruefung/schutzwirkung.mjs";
import { commitAll, gitAusgabe, probeDirectory, probeRepository, setzeUmgebung, writeFiles } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";

const NIE2 = "[NIE2] ein durchgereichter Runner wird unverändert benutzt";
const TESTDATEI = "test/umbau.test.js";
const ANLAGE = { datei: "src/anlage.js", bereiche: [[2, 2]] };
const UMBAU = { datei: "src/umbau.js", bereiche: [[2, 2]] };
const EINHEITEN = [ANLAGE, UMBAU];
const NICHT_PRUEFBAR = `Schutzwirkung nicht prüfbar (Auftrag P-1/u1, 0 Mutanten in seinen Zeilen): ${NIE2}`;
const FREIGABE_IM_ISSUE = `Mutationsurteil: Schutzwirkung freigegeben (Auftrag P-1/u1): ${NIE2}`;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const VERKNUEPFTES_ISSUE = 42;
const PR_DES_PAKETS = 2860;
const ANTONIO = { login: "Antonio20045" };
const PAKET_APP = { login: "sundartha-agent" };
const FREIGABEABSCHNITT = ["## Absicht", "", "Probe.", "", "## Freigabe Antonio 2026-11-03", ""];
const KEIN_LIVELAUF = () => assert.fail("das Urteil aus Teilergebnissen startet keinen Stryker");

function auftragsnachricht(titel, auftrag) {
  return `${titel}\n\nWarum: Probe.\n\nAuftrag: ${auftrag}\nArt: umbau\n`;
}

function testdatei(...faelle) {
  return ['import { test } from "node:test";', ...faelle.map((name) => `test(${JSON.stringify(name)}, () => {});`), ""].join("\n");
}

function verlauf(context, { testAuftrag = "P-1/u1" } = {}) {
  const repo = probeRepository(context, {
    "src/anlage.js": "export function anlage(x) {\n  return x;\n}\n",
    "src/umbau.js": "export function umbau(r) {\n  return r;\n}\n",
  });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  writeFiles(repo, { "src/anlage.js": "export function anlage(x) {\n  if (x < 0) return 0;\n  return x;\n}\n" });
  commitAll(repo, auftragsnachricht("Baue a1", "P-1/a1"));
  writeFiles(repo, { "src/umbau.js": "export function umbau(r) {\n  const runner = r;\n  return runner;\n}\n", [TESTDATEI]: testdatei(NIE2) });
  commitAll(repo, testAuftrag === null ? "Schutztest ohne Auftrag\n\nWarum: Altbestand.\n" : auftragsnachricht("Baue u1", testAuftrag));
  return { repo, basis };
}

function messung(einheit, ...mutanten) {
  return {
    datei: einheit.datei,
    pfad: TESTDATEI,
    fall: NIE2,
    getoetet: mutanten.some(({ status }) => status === "Killed"),
    erreicht: mutanten.some(({ status }) => status === "Survived"),
    mutanten: mutanten.map(({ status, zeile }) => ({ status, zeilen: [zeile, zeile] })),
  };
}

const UEBERLEBT_IN_A1 = messung(ANLAGE, { status: "Survived", zeile: 2 });

async function urteil({ repo, basis }, messungen, freigaben) {
  const berichte = [{ schutz: { faelle: [{ name: NIE2, pfad: TESTDATEI }], messungen } }];
  return schutzDesUrteils({ berichte, einheiten: EINHEITEN, angaben: [], zuordnung: schutzzuordnung(basis, repo), freigaben }, KEIN_LIVELAUF);
}

function gemeldet(context, ergebnis) {
  const ausgabe = [];
  context.mock.method(console, "log", (zeile) => ausgabe.push(zeile));
  const exitCode = meldeSchutz(ergebnis);
  context.mock.restoreAll();
  return { exitCode, ausgabe };
}

function kommentar(autor, zeilen, { bearbeitet = false } = {}) {
  return { author: autor, body: ["Prüf-Agent: freigegeben.", "", ...zeilen].join("\n"), lastEditedAt: bearbeitet ? "2026-11-03T13:00:00Z" : null, userContentEdits: { totalCount: bearbeitet ? 1 : 0 } };
}

function kommentarSeite(nodes, { weitere = false } = {}) {
  return { pageInfo: { hasNextPage: weitere }, nodes };
}

function issueMitFreigabe(abschnitt, kommentare) {
  return { number: VERKNUEPFTES_ISSUE, body: [...FREIGABEABSCHNITT, ...abschnitt, ""].join("\n"), kommentare };
}

function freigabeIssue(...zeilen) {
  return async () => ({ freigaben: freigabenAus([issueMitFreigabe(zeilen, kommentarSeite([kommentar(ANTONIO, zeilen)]))]), hinweise: [] });
}

test("(a) ein Umbau-Fall mit 0 Mutanten in den Zeilen seines Auftrags ist nicht prüfbar, auch wenn er Zeilen eines anderen Auftrags ohne Tötung erreicht", async (context) => {
  const ergebnis = await urteil(verlauf(context), [UEBERLEBT_IN_A1, messung(UMBAU)]);
  assert.deepEqual(ergebnis.zeilen, [NICHT_PRUEFBAR]);
  assert.equal(ergebnis.verstoesse, 0);
  const { exitCode, ausgabe } = gemeldet(context, ergebnis);
  assert.equal(exitCode, EXIT_ROT, "nicht prüfbar ohne Freigabe ist nicht grün");
  assert.deepEqual(ausgabe, [NICHT_PRUEFBAR, "wartet auf Prüf-Agent: 1 von 1 Schutztests nicht prüfbar, ohne Freigabe."]);
  assert.equal(nurSchutzRot(ausgabe.join("\n")), true, "lokal mit --schutz-gesondert gilt der Zustand als reiner Schutzbefund");
});

test("(a) der Zustand „nicht prüfbar“ steht für den Prüf-Agenten mit Auftrag, Commit und Zeilen in nicht-pruefbar.json", async (context) => {
  const probe = verlauf(context);
  const ergebnis = await urteil(probe, [UEBERLEBT_IN_A1, messung(UMBAU)]);
  const datei = join(probeDirectory(context, {}), "nicht-pruefbar.json");
  schreibeNichtPruefbar(ergebnis.nichtPruefbar, datei);
  const commit = gitAusgabe(probe.repo, "rev-parse", "HEAD");
  assert.deepEqual(JSON.parse(readFileSync(datei, "utf8")), [{ fall: NIE2, testdatei: TESTDATEI, auftrag: "P-1/u1", commit, zeilen: [{ datei: "src/umbau.js", von: 2, bis: 2 }], freigegeben: false }]);
});

test("(b) ein Fall, der Mutanten seines Auftrags erreicht und keinen tötet, ist wirkungslos und rot, auch wenn er einen Mutanten eines anderen Auftrags tötet", async (context) => {
  const ergebnis = await urteil(verlauf(context), [messung(ANLAGE, { status: "Killed", zeile: 2 }), messung(UMBAU, { status: "Survived", zeile: 2 })]);
  assert.deepEqual(ergebnis.zeilen, [`Verstoß: Schutztest wirkungslos: ${NIE2}`]);
  const { exitCode, ausgabe } = gemeldet(context, ergebnis);
  assert.equal(exitCode, EXIT_ROT);
  assert.ok(ausgabe.includes("rot: 1 Schutztests, 1 ohne nachgewiesene Wirkung."), ausgabe.join("\n"));
});

test("(c) ein Fall, der einen Mutanten seines Auftrags tötet, ist wirksam", async (context) => {
  const ergebnis = await urteil(verlauf(context), [UEBERLEBT_IN_A1, messung(UMBAU, { status: "Killed", zeile: 2 })]);
  assert.deepEqual(ergebnis.zeilen, [`Schutztest wirksam: ${NIE2}`]);
  assert.equal(gemeldet(context, ergebnis).exitCode, EXIT_GRUEN);
});

test("(d) „nicht prüfbar“ mit der Freigabe-Zeile im verknüpften Issue wird grün", async (context) => {
  const ergebnis = await urteil(verlauf(context), [UEBERLEBT_IN_A1, messung(UMBAU)], freigabeIssue(`- ${FREIGABE_IM_ISSUE}`));
  assert.deepEqual(ergebnis.zeilen, [`Schutzwirkung freigegeben (Auftrag P-1/u1, Issue #${VERKNUEPFTES_ISSUE}): ${NIE2}`]);
  const { exitCode, ausgabe } = gemeldet(context, ergebnis);
  assert.equal(exitCode, EXIT_GRUEN);
  assert.ok(ausgabe.includes("grün: 1 Schutztests, 0 ohne nachgewiesene Wirkung."), ausgabe.join("\n"));
  assert.equal(ergebnis.nichtPruefbar[0].freigegeben, true);
});

test("(d) ohne passende Freigabe-Zeile bleibt „nicht prüfbar“ nicht grün", async (context) => {
  const andere = [
    `Mutationsurteil: Schutzwirkung freigegeben (Auftrag P-1/a1): ${NIE2}`,
    `${FREIGABE_IM_ISSUE}, weil der Umbau nichts verändert`,
    "Mutationsurteil: Schutzwirkung freigegeben (Auftrag P-1/u1): [NIE3] ein anderer Fall",
  ];
  const probe = verlauf(context);
  for (const freigaben of [undefined, freigabeIssue(...andere)]) {
    const ergebnis = await urteil(probe, [UEBERLEBT_IN_A1, messung(UMBAU)], freigaben);
    assert.deepEqual(ergebnis.zeilen, [NICHT_PRUEFBAR]);
    assert.equal(gemeldet(context, ergebnis).exitCode, EXIT_ROT);
  }
});

async function freigabenUeberGithub(context, prText, { abschnitt, kommentare, issueKonten = { author: ANTONIO, editor: null } }) {
  const issue = { __typename: "Issue", number: VERKNUEPFTES_ISSUE, body: [...FREIGABEABSCHNITT, ...abschnitt, ""].join("\n"), ...issueKonten };
  const github = await scheinGithub(
    context,
    new Map([
      [`GET /repos/sundartha/hermes/pulls/${PR_DES_PAKETS}`, { body: prText }],
      ["POST /graphql", { data: { repository: { issueOrPullRequest: issue, issue: { comments: kommentare } } } }],
    ]),
  );
  setzeUmgebung(context, { GITHUB_API_URL: github.url, GITHUB_GRAPHQL_URL: `${github.url}/graphql`, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: "sundartha/hermes" });
  return schutzfreigaben({ EVENT_NAME: "pull_request", PR_NUMBER: String(PR_DES_PAKETS) });
}

async function freigegebenLaut(context, issue) {
  const { freigaben } = await freigabenUeberGithub(context, `Closes #${VERKNUEPFTES_ISSUE}`, issue);
  return freigaben.has(FREIGABE_IM_ISSUE);
}

const IM_ABSCHNITT = [`- ${FREIGABE_IM_ISSUE}`];
const BELEG_VON_ANTONIO = kommentarSeite([kommentar(ANTONIO, [`- ${FREIGABE_IM_ISSUE}`])]);

test("(d) das Urteil liest die Freigabe nur aus dem Issue, das der PR mit Closes verknüpft", async (context) => {
  const nurErwaehnt = await freigabenUeberGithub(context, `Siehe #${VERKNUEPFTES_ISSUE}`, { abschnitt: IM_ABSCHNITT, kommentare: BELEG_VON_ANTONIO });
  assert.equal(nurErwaehnt.freigaben.size, 0);
});

test("(d1) steht die Zeile im Abschnitt und wörtlich in einem unbearbeiteten Kommentar von Antonio20045, ist der Fall freigegeben", async (context) => {
  const { freigaben } = await freigabenUeberGithub(context, `Closes #${VERKNUEPFTES_ISSUE}`, { abschnitt: IM_ABSCHNITT, kommentare: BELEG_VON_ANTONIO });
  assert.equal(freigaben.get(FREIGABE_IM_ISSUE), VERKNUEPFTES_ISSUE);
  for (const issueKonten of [{ author: PAKET_APP, editor: null }, { author: PAKET_APP, editor: PAKET_APP }]) {
    assert.equal(await freigegebenLaut(context, { abschnitt: IM_ABSCHNITT, kommentare: BELEG_VON_ANTONIO, issueKonten }), true, "Autor und Bearbeiter des Issue-Texts zählen nicht");
  }
});

test("(d2) steht die Zeile nur im Abschnitt, ist der Fall nicht freigegeben", async (context) => {
  assert.equal(await freigegebenLaut(context, { abschnitt: IM_ABSCHNITT, kommentare: kommentarSeite([]) }), false);
});

test("(d3) steht die Zeile in einem Kommentar der Paket-App, ist der Fall nicht freigegeben", async (context) => {
  assert.equal(await freigegebenLaut(context, { abschnitt: IM_ABSCHNITT, kommentare: kommentarSeite([kommentar(PAKET_APP, [FREIGABE_IM_ISSUE])]) }), false);
});

test("(d4) steht die Zeile in einem bearbeiteten Kommentar von Antonio20045, ist der Fall nicht freigegeben", async (context) => {
  assert.equal(await freigegebenLaut(context, { abschnitt: IM_ABSCHNITT, kommentare: kommentarSeite([kommentar(ANTONIO, [FREIGABE_IM_ISSUE], { bearbeitet: true })]) }), false);
});

test("(d5) steht die Zeile nur im Kommentar und nicht im Abschnitt „Freigabe Antonio“, ist der Fall nicht freigegeben", async (context) => {
  assert.equal(await freigegebenLaut(context, { abschnitt: [], kommentare: BELEG_VON_ANTONIO }), false);
});

test("(d6) sind die Kommentare nicht vollständig lesbar, ist der Fall nicht freigegeben", async (context) => {
  const unvollstaendig = [
    kommentarSeite([kommentar(ANTONIO, [FREIGABE_IM_ISSUE])], { weitere: true }),
    { nodes: [kommentar(ANTONIO, [FREIGABE_IM_ISSUE])] },
    kommentarSeite([{ ...kommentar(ANTONIO, [FREIGABE_IM_ISSUE]), userContentEdits: undefined }]),
    kommentarSeite([{ ...kommentar(ANTONIO, [FREIGABE_IM_ISSUE]), lastEditedAt: undefined }]),
    null,
  ];
  for (const kommentare of unvollstaendig) assert.equal(await freigegebenLaut(context, { abschnitt: IM_ABSCHNITT, kommentare }), false, JSON.stringify(kommentare));
});

test("(d) ohne PR-Nummer liest das Urteil keine Freigabe und bleibt bei „nicht prüfbar“", async () => {
  const { freigaben, hinweise } = await schutzfreigaben({ EVENT_NAME: "workflow_dispatch", GITHUB_TOKEN: "probe" });
  assert.equal(freigaben.size, 0);
  assert.equal(hinweise.length, 1);
});

test("(e) ein Fall aus einem Commit ohne Auftrag-Zeile wird wie bisher gegen alle neuen Zeilen gemessen", async (context) => {
  const ergebnis = await urteil(verlauf(context, { testAuftrag: null }), [UEBERLEBT_IN_A1, messung(UMBAU)]);
  assert.deepEqual(ergebnis.zeilen, [`Verstoß: Schutztest wirkungslos: ${NIE2}`]);
});

test("hat der Auftrag Mutanten, die der Fall nicht erreicht, wird er wie bisher gegen alle neuen Zeilen gemessen und nicht milder beurteilt", async (context) => {
  const ergebnis = await urteil(verlauf(context), [UEBERLEBT_IN_A1, messung(UMBAU, { status: "NoCoverage", zeile: 2 })]);
  assert.deepEqual(ergebnis.zeilen, [`Verstoß: Schutztest wirkungslos: ${NIE2}`]);
});

test("erreicht die Testdatei die Datei des eigenen Auftrags nicht, wird der Fall wie bisher gegen alle neuen Zeilen gemessen", async (context) => {
  const nichtErreicht = { datei: UMBAU.datei, pfad: TESTDATEI, fall: NIE2, getoetet: false, erreicht: false };
  const ergebnis = await urteil(verlauf(context), [UEBERLEBT_IN_A1, nichtErreicht]);
  assert.deepEqual(ergebnis.zeilen, [`Verstoß: Schutztest wirkungslos: ${NIE2}`]);
});

test("ein Mutant außerhalb der Zeilen des eigenen Auftrags zählt für den Fall nicht", async (context) => {
  const ergebnis = await urteil(verlauf(context), [UEBERLEBT_IN_A1, messung(UMBAU, { status: "Survived", zeile: 3 })]);
  assert.deepEqual(ergebnis.zeilen, [NICHT_PRUEFBAR]);
});
