import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { test } from "node:test";

import { scheinApi } from "./ausmisten/hilfen.mjs";
import { REPO_ROOT } from "./probe-repo.js";
import { zipMitEinerDatei } from "./pruefer/zip.mjs";

const EINSTIEG = join(REPO_ROOT, "tools/pruefer-abwarten.mjs");
const KOPF = "a".repeat(40);
const ANDERER_KOPF = "b".repeat(40);
const PR = 12;
const REPO = "/repos/sundartha/hermes";
const ERSTELLER = "github-actions[bot]";
const EXIT = { ok: 0, befunde: 1, ausgeblieben: 3, nichtGelaufen: 4, keinPr: 5 };
const PRUEFER_WORKFLOW = 900;
const CI_WORKFLOW = 901;
const ECHTER_LAUF = 1;
const FREMDER_LAUF = 2;
const ECHTES_ARTEFAKT = 5;
const FREMDES_ARTEFAKT = 6;
const KURZES_WARTEN = ["--hoechstens", "1", "--takt", "1"];

function befund(schwere, felder = {}) {
  return {
    schwere,
    id: "b1",
    datei: "src/zahl.js",
    zeile: 7,
    beleg: "Die Zahl ist 1 statt 2.",
    reproduktion: "",
    reparatur: "Setze die Zahl auf 2.",
    sicherheit: false,
    ...felder,
  };
}

function ergebnisZip(befunde, kopf = KOPF) {
  const commit = { sha: "c".repeat(40), patchId: "", zustand: "geprueft", befunde };
  const ergebnis = { format: 1, head: kopf, branch: "paket/x", pr: PR, commits: [commit] };
  return zipMitEinerDatei("ergebnis.json", JSON.stringify(ergebnis));
}

function status(state, felder = {}) {
  return {
    context: "Prüfer",
    state,
    description: `Beschreibung ${state}`,
    creator: { login: ERSTELLER },
    ...felder,
  };
}

function offenerPr() {
  return [{ number: PR, state: "open", head: { sha: KOPF } }];
}

function artefakt(id, lauf, erstellt) {
  return {
    id,
    name: `pruefer-ergebnis-pr${PR}`,
    expired: false,
    created_at: erstellt,
    workflow_run: { id: lauf },
  };
}

function laufRouten() {
  return [
    [`GET ${REPO}/actions/workflows/pruefer-pruefen.yml`, { id: PRUEFER_WORKFLOW }],
    [
      `GET ${REPO}/actions/runs/${ECHTER_LAUF}`,
      {
        path: ".github/workflows/pruefer-pruefen.yml",
        event: "workflow_run",
        workflow_id: PRUEFER_WORKFLOW,
      },
    ],
    [
      `GET ${REPO}/actions/runs/${FREMDER_LAUF}`,
      { path: ".github/workflows/ci.yml", event: "pull_request", workflow_id: CI_WORKFLOW },
    ],
  ];
}

async function scheinGithub(
  context,
  { pull = offenerPr(), statusse = [], zip = null, fremd = null },
) {
  const artefakte = [
    ...(zip === null ? [] : [artefakt(ECHTES_ARTEFAKT, ECHTER_LAUF, "2026-11-02T10:00:00Z")]),
    ...(fremd === null ? [] : [artefakt(FREMDES_ARTEFAKT, FREMDER_LAUF, "2026-11-02T10:05:00Z")]),
  ];
  const feste = new Map([
    [`GET ${REPO}/commits/${KOPF}/pulls`, pull],
    [`GET ${REPO}/actions/artifacts`, { artifacts: artefakte }],
    [`GET ${REPO}/actions/artifacts/${ECHTES_ARTEFAKT}/zip`, zip],
    [`GET ${REPO}/actions/artifacts/${FREMDES_ARTEFAKT}/zip`, fremd],
    ...laufRouten(),
  ]);
  let statusAbrufe = 0;
  const routen = {
    get(schluessel) {
      if (schluessel !== `GET ${REPO}/commits/${KOPF}/statuses`)
        return feste.get(schluessel) ?? undefined;
      statusAbrufe += 1;
      return typeof statusse === "function" ? statusse(statusAbrufe) : statusse;
    },
  };
  return scheinApi(context, routen);
}

async function rufeAuf(github, argumente = [], zusatz = {}) {
  const env = {
    PATH: process.env.PATH,
    GH_TOKEN: "schein",
    GITHUB_API_URL: github.url,
    GITHUB_REPOSITORY: "sundartha/hermes",
    ...zusatz,
  };
  const kind = spawn(process.execPath, [EINSTIEG, "--head", KOPF, ...argumente], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const [code] = await once(kind, "close");
  return { code, ausgabe };
}

test("ein BLOCKER des Prüfers wird mit Stelle und Reparatur ausgegeben und beendet mit Exit 1", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("failure")],
    zip: ergebnisZip([befund("BLOCKER")]),
  });
  const { code, ausgabe } = await rufeAuf(github);
  assert.equal(code, EXIT.befunde);
  assert.match(ausgabe, /BLOCKER \(Commit ccccccc\) src\/zahl\.js:7: Die Zahl ist 1 statt 2\./);
  assert.match(ausgabe, /Reparatur: Setze die Zahl auf 2\./);
});

test("ein SOLLTE bei grünem Prüfer-Status wird ausgegeben und beendet mit Exit 1", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("success")],
    zip: ergebnisZip([befund("SOLLTE")]),
  });
  const { code, ausgabe } = await rufeAuf(github);
  assert.equal(code, EXIT.befunde);
  assert.match(ausgabe, /SOLLTE \(Commit ccccccc\) src\/zahl\.js:7/);
});

test("ein Prüfer ohne Befund beendet mit Exit 0", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("success")],
    zip: ergebnisZip([]),
  });
  const { code, ausgabe } = await rufeAuf(github);
  assert.equal(code, EXIT.ok);
  assert.match(ausgabe, /Prüfer am Kopf: success/);
});

test("ein HINWEIS allein lässt den Exit bei 0", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("success")],
    zip: ergebnisZip([befund("HINWEIS")]),
  });
  const { code, ausgabe } = await rufeAuf(github);
  assert.equal(code, EXIT.ok);
  assert.doesNotMatch(ausgabe, /HINWEIS \(Commit/);
});

test("ein Sicherheitsbefund erscheint ohne Einzelheiten und beendet mit Exit 1", async (context) => {
  const verdeckt = { sicherheit: true, schwere: "BLOCKER" };
  const github = await scheinGithub(context, {
    statusse: [status("failure")],
    zip: ergebnisZip([verdeckt]),
  });
  const { code, ausgabe } = await rufeAuf(github);
  assert.equal(code, EXIT.befunde);
  assert.match(ausgabe, /BLOCKER \(Commit ccccccc\): Sicherheitsbefund, Details nicht öffentlich/);
});

test("ohne Urteil nach der Höchstwartezeit meldet der Aufruf eigens, dass der Prüfer ausblieb, und nie Exit 0", async (context) => {
  const github = await scheinGithub(context, { statusse: [] });
  const { code, ausgabe } = await rufeAuf(github, KURZES_WARTEN);
  assert.equal(code, EXIT.ausgeblieben);
  assert.match(ausgabe, /Prüfer ausgeblieben: .* KEIN grünes Ergebnis/);
});

test("ein noch laufender Prüfer (pending) zählt als ausgeblieben, nicht als grün", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("pending", { description: "Reproduktion läuft" })],
  });
  const { code, ausgabe } = await rufeAuf(github, KURZES_WARTEN);
  assert.equal(code, EXIT.ausgeblieben);
  assert.match(ausgabe, /Prüfer ausgeblieben/);
});

test("der Aufruf wartet, bis der Prüfer sein Urteil setzt, und gibt dann die Befunde aus", async (context) => {
  const spaeter = (abruf) => (abruf > 1 ? [status("failure")] : []);
  const github = await scheinGithub(context, {
    statusse: spaeter,
    zip: ergebnisZip([befund("BLOCKER")]),
  });
  const { code, ausgabe } = await rufeAuf(github, ["--hoechstens", "30", "--takt", "1"]);
  assert.equal(code, EXIT.befunde);
  assert.match(ausgabe, /Warte auf den Prüfer/);
  assert.match(ausgabe, /BLOCKER \(Commit ccccccc\)/);
});

test("ein Prüfer-Status von jemand anderem als der GitHub-Aktion wird nicht als Urteil gewertet", async (context) => {
  const fremd = status("success", { creator: { login: "irgendwer" } });
  const github = await scheinGithub(context, { statusse: [fremd], zip: ergebnisZip([]) });
  const { code } = await rufeAuf(github, KURZES_WARTEN);
  assert.equal(code, EXIT.ausgeblieben);
});

test("ein grüner Status ohne Ergebnis zu genau diesem Kopf wird nicht als grün gemeldet", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("success")],
    zip: ergebnisZip([], ANDERER_KOPF),
  });
  const { code } = await rufeAuf(github, KURZES_WARTEN);
  assert.equal(code, EXIT.ausgeblieben);
});

test("ein Prüfer-Status error meldet, dass der Prüfer nicht gelaufen ist", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("error", { description: "Prüfer nicht gelaufen: Limit" })],
  });
  const { code, ausgabe } = await rufeAuf(github);
  assert.equal(code, EXIT.nichtGelaufen);
  assert.match(
    ausgabe,
    /Prüfer nicht gelaufen am Kopf aaaaaaa: Prüfer nicht gelaufen: Limit\. Das ist KEIN grünes Ergebnis/,
  );
});

test("ohne offenen Pull Request zum Kopf gibt es nichts abzuwarten und der Aufruf sagt das", async (context) => {
  const github = await scheinGithub(context, { pull: [] });
  const { code, ausgabe } = await rufeAuf(github);
  assert.equal(code, EXIT.keinPr);
  assert.match(ausgabe, /Kein offener Pull Request/);
});

test("der Werkzeugtest-Schalter überspringt das Warten nur innerhalb eines Testlaufs", async (context) => {
  const github = await scheinGithub(context, { statusse: [] });
  const imTest = await rufeAuf(github, KURZES_WARTEN, {
    PRUEFER_ABWARTEN: "aus",
    NODE_TEST_CONTEXT: "child-v8",
  });
  assert.equal(imTest.code, EXIT.ok);
  assert.match(imTest.ausgabe, /abgeschaltet \(nur im Werkzeugtest\)/);
  assert.deepEqual(github.anfragen, []);
  const ohneTest = await rufeAuf(github, KURZES_WARTEN, { PRUEFER_ABWARTEN: "aus" });
  assert.equal(ohneTest.code, EXIT.ausgeblieben);
});

test("ein geschlossener Pull Request oder ein Pull Request mit anderem Kopf zählt nicht als offener", async (context) => {
  const pull = [
    { number: PR, state: "closed", head: { sha: KOPF } },
    { number: PR + 1, state: "open", head: { sha: ANDERER_KOPF } },
  ];
  const github = await scheinGithub(context, {
    pull,
    statusse: [status("success")],
    zip: ergebnisZip([]),
  });
  const { code } = await rufeAuf(github);
  assert.equal(code, EXIT.keinPr);
});

test("ein Ergebnis-Artefakt aus einem fremden Workflow-Lauf verdrängt nicht das Ergebnis des Prüfers", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("success")],
    zip: ergebnisZip([befund("SOLLTE", { beleg: "Echter Befund des Prüfers." })]),
    fremd: ergebnisZip([]),
  });
  const { code, ausgabe } = await rufeAuf(github, KURZES_WARTEN);
  assert.equal(code, EXIT.befunde, ausgabe);
  assert.match(ausgabe, /Echter Befund des Prüfers/);
});

test("ein Ergebnis-Artefakt nur aus einem fremden Workflow-Lauf gilt nicht als Urteil", async (context) => {
  const github = await scheinGithub(context, {
    statusse: [status("success")],
    fremd: ergebnisZip([]),
  });
  const { code } = await rufeAuf(github, KURZES_WARTEN);
  assert.equal(code, EXIT.ausgeblieben);
});
