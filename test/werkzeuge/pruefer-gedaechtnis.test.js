import assert from "node:assert/strict";
import { test } from "node:test";

import { entpacke, fruehereErgebnisse } from "../../tools/auftrag/pruefer-gedaechtnis.mjs";
import { githubZugang } from "../../tools/auftrag/pruefer-github.mjs";
import { scheinSha } from "./pruefer/hilfen.mjs";
import { zipMitEinerDatei } from "./pruefer/zip.mjs";

const API = "http://schein-github";
const REPO = "/repos/sundartha/hermes";
const BRANCH = "fix/zahl";
const PR_LAUF = 1;
const FREMDER_WORKFLOW = 2;
const LAUFENDER_LAUF = 3;
const ANDERER_BRANCH = 4;
const PASSEND = 5;
const PFAD = ".github/workflows/pruefer-pruefen.yml";
const HTTP_OK = 200;
const HTTP_NICHT_GEFUNDEN = 404;
const [GEPRUEFT, NICHT_GELAUFEN, UNVOLLSTAENDIG, FREMD] = ["1", "2", "3", "4"].map(scheinSha);

function commit(patchId, zustand, befunde = []) {
  return { sha: scheinSha("e"), patchId, zustand, befunde };
}

function artefakt(branch, commits) {
  return zipMitEinerDatei(
    "ergebnis.json",
    JSON.stringify({ format: 1, head: scheinSha("f"), branch, commits }),
  );
}

function lauf(id, felder = {}) {
  return { id, event: "workflow_run", conclusion: "success", path: PFAD, ...felder };
}

function artefakteVon(id) {
  return [
    `/actions/runs/${id}/artifacts?name=pruefer-ergebnis`,
    { artifacts: [{ id, name: "pruefer-ergebnis", expired: false }] },
  ];
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

test("ein Zip-Archiv mit einer Datei wird entpackt", () => {
  assert.equal(
    entpacke(zipMitEinerDatei("ergebnis.json", "inhalt")).get("ergebnis.json").toString("utf8"),
    "inhalt",
  );
});

test("frühere Ergebnisse kommen nur aus Läufen des Prüfer-Workflows zum selben Branch, und nur geprüfte werden übernommen", async () => {
  const sicherheit = [{ sicherheit: true, schwere: "BLOCKER" }];
  const laeufe = [
    lauf(PR_LAUF, { event: "pull_request" }),
    lauf(FREMDER_WORKFLOW, { path: ".github/workflows/fremd.yml" }),
    lauf(LAUFENDER_LAUF),
    lauf(ANDERER_BRANCH),
    lauf(PASSEND),
  ];
  const routen = new Map([
    [
      "/actions/workflows/pruefer-pruefen.yml/runs?event=workflow_run&status=success&per_page=100&page=1",
      { workflow_runs: laeufe },
    ],
    artefakteVon(ANDERER_BRANCH),
    [
      `/actions/artifacts/${ANDERER_BRANCH}/zip`,
      artefakt("anderer/branch", [commit(FREMD, "geprueft")]),
    ],
    artefakteVon(PASSEND),
    [
      `/actions/artifacts/${PASSEND}/zip`,
      artefakt(BRANCH, [
        commit(GEPRUEFT, "geprueft", sicherheit),
        commit(NICHT_GELAUFEN, "nicht_gelaufen"),
        commit(UNVOLLSTAENDIG, "unvollstaendig"),
      ]),
    ],
  ]);
  const abgerufen = [];
  const github = githubZugang({
    abruf: scheinAbruf(routen, abgerufen),
    token: "schein",
    api: API,
    repo: "sundartha/hermes",
  });
  const frueher = await fruehereErgebnisse({ github, branch: BRANCH, laufId: LAUFENDER_LAUF });
  assert.deepEqual([...frueher.keys()], [GEPRUEFT]);
  assert.deepEqual(frueher.get(GEPRUEFT).befunde, sicherheit);
  const gefragt = abgerufen
    .filter((pfad) => pfad.startsWith("/actions/runs/"))
    .map((pfad) => pfad.split("/")[3]);
  assert.deepEqual(gefragt, [ANDERER_BRANCH, PASSEND].map(String));
});
