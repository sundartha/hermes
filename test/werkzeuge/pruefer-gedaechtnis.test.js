import assert from "node:assert/strict";
import { test } from "node:test";

import { entpacke, fruehereErgebnisse } from "../../tools/auftrag/pruefer-gedaechtnis.mjs";
import { githubZugang } from "../../tools/auftrag/pruefer-github.mjs";
import { WORKFLOW_NUMMERN, prueferLauf, scheinSha } from "./pruefer/hilfen.mjs";
import { zipMitEinerDatei } from "./pruefer/zip.mjs";

const API = "http://schein-github";
const REPO = "/repos/sundartha/hermes";
const PR = 7;
const ARTEFAKT = `pruefer-ergebnis-pr${PR}`;
const ARTEFAKT_ABFRAGE = `/actions/artifacts?name=${ARTEFAKT}&per_page=100&page=1`;
const WORKFLOW_ABFRAGE = "/actions/workflows/pruefer-pruefen.yml";
const HTTP_OK = 200;
const HTTP_NICHT_GEFUNDEN = 404;
const FREMDE_ARTEFAKTE = 90;
const FREMDE_NUMMER = 9;
const LAUF = { fremd: 1, prEreignis: 2, abgebrochen: 3, versuch: 4, passend: 5 };
const [GEPRUEFT, ZWEITER, NICHT_GELAUFEN, UNVOLLSTAENDIG, FREMD] = ["1", "2", "3", "4", "5"].map(
  scheinSha,
);

function commit(patchId, zustand, befunde = []) {
  return { sha: scheinSha("e"), patchId, zustand, befunde };
}

function zip(commits) {
  const ergebnis = { format: 1, head: scheinSha("f"), branch: "fix/zahl", pr: PR, commits };
  return zipMitEinerDatei("ergebnis.json", JSON.stringify(ergebnis));
}

function artefakt(laufId) {
  return { id: laufId, name: ARTEFAKT, expired: false, workflow_run: { id: laufId } };
}

function scheinAbruf(routen, abgerufen) {
  return async (adresse) => {
    const pfad = adresse.slice(`${API}${REPO}`.length);
    abgerufen.push(pfad);
    const antwort = routen.get(pfad);
    if (antwort === undefined) return new Response("{}", { status: HTTP_NICHT_GEFUNDEN });
    return new Response(Buffer.isBuffer(antwort) ? antwort : JSON.stringify(antwort), {
      status: HTTP_OK,
    });
  };
}

function laufRouten(laeufe) {
  return laeufe.flatMap(({ lauf, inhalt }) => [
    [`/actions/runs/${lauf.id}`, lauf],
    [`/actions/artifacts/${lauf.id}/zip`, inhalt],
  ]);
}

async function frage(laeufe, extraArtefakte = []) {
  const artefakte = [...laeufe.map(({ lauf }) => artefakt(lauf.id)), ...extraArtefakte];
  const routen = new Map([
    [WORKFLOW_ABFRAGE, { id: WORKFLOW_NUMMERN.get("pruefer-pruefen.yml") }],
    [ARTEFAKT_ABFRAGE, { artifacts: artefakte }],
    ...laufRouten(laeufe),
  ]);
  const abgerufen = [];
  const github = githubZugang({
    abruf: scheinAbruf(routen, abgerufen),
    token: "schein",
    api: API,
    repo: "sundartha/hermes",
  });
  return { frueher: await fruehereErgebnisse({ github, pr: PR }), abgerufen };
}

test("ein Zip-Archiv mit einer Datei wird entpackt", () => {
  assert.equal(
    entpacke(zipMitEinerDatei("ergebnis.json", "inhalt")).get("ergebnis.json").toString("utf8"),
    "inhalt",
  );
});

test("ein fremder Workflow mit gleichem Artefakt-Namen wird ignoriert, nur geprüfte Einträge zählen", async () => {
  const sicherheit = [{ sicherheit: true, schwere: "BLOCKER" }];
  const fremd = prueferLauf({
    id: LAUF.fremd,
    path: ".github/workflows/fremd.yml",
    workflow_id: FREMDE_NUMMER,
  });
  const { frueher } = await frage([
    { lauf: fremd, inhalt: zip([commit(FREMD, "geprueft")]) },
    {
      lauf: prueferLauf({ id: LAUF.prEreignis, event: "pull_request" }),
      inhalt: zip([commit(FREMD, "geprueft")]),
    },
    {
      lauf: prueferLauf({ id: LAUF.passend }),
      inhalt: zip([
        commit(GEPRUEFT, "geprueft", sicherheit),
        commit(NICHT_GELAUFEN, "nicht_gelaufen"),
        commit(UNVOLLSTAENDIG, "unvollstaendig"),
      ]),
    },
  ]);
  assert.deepEqual([...frueher.keys()], [GEPRUEFT]);
  assert.deepEqual(frueher.get(GEPRUEFT).befunde, sicherheit);
});

test("ein abgebrochener Lauf mit zwei geprüften Einträgen gibt beide weiter", async () => {
  const { frueher } = await frage([
    {
      lauf: prueferLauf({ id: LAUF.abgebrochen, conclusion: "cancelled" }),
      inhalt: zip([
        commit(GEPRUEFT, "geprueft"),
        commit(ZWEITER, "geprueft"),
        commit(NICHT_GELAUFEN, "nicht_gelaufen"),
      ]),
    },
  ]);
  assert.deepEqual([...frueher.keys()], [GEPRUEFT, ZWEITER]);
});

test("ein früherer Versuch desselben Laufs wird übernommen", async (context) => {
  process.env.GITHUB_RUN_ID = String(LAUF.versuch);
  context.after(() => {
    delete process.env.GITHUB_RUN_ID;
  });
  const { frueher } = await frage([
    {
      lauf: prueferLauf({ id: LAUF.versuch, run_attempt: 1, conclusion: "failure" }),
      inhalt: zip([commit(GEPRUEFT, "geprueft")]),
    },
  ]);
  assert.deepEqual([...frueher.keys()], [GEPRUEFT]);
});

test("die Zahl der API-Aufrufe wächst nur mit den Läufen dieses PRs", async () => {
  const eigene = [LAUF.abgebrochen, LAUF.passend].map((id) => ({
    lauf: prueferLauf({ id }),
    inhalt: zip([commit(GEPRUEFT, "geprueft")]),
  }));
  const fremde = Array.from({ length: FREMDE_ARTEFAKTE }, (_unbenutzt, index) => ({
    ...artefakt(LAUF.passend + index + 1),
    name: "pruefer-ergebnis-pr8",
  }));
  const { frueher, abgerufen } = await frage(eigene, fremde);
  assert.deepEqual([...frueher.keys()], [GEPRUEFT]);
  assert.deepEqual(abgerufen, [
    ARTEFAKT_ABFRAGE,
    WORKFLOW_ABFRAGE,
    `/actions/runs/${LAUF.abgebrochen}`,
    `/actions/artifacts/${LAUF.abgebrochen}/zip`,
    `/actions/runs/${LAUF.passend}`,
    `/actions/artifacts/${LAUF.passend}/zip`,
  ]);
});

test("ohne Artefakt dieses PRs fragt das Gedächtnis keinen Lauf ab", async () => {
  const { frueher, abgerufen } = await frage([]);
  assert.equal(frueher.size, 0);
  assert.deepEqual(abgerufen, [ARTEFAKT_ABFRAGE]);
});
