import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { pruefsummenZeile } from "../../tools/tests-ausmisten/festgehalten.mjs";
import { ausgabenAus } from "../../tools/tests-ausmisten/ausgaben.mjs";
import { totcodeJobName } from "../../tools/tests-ausmisten/totcode-melden.mjs";
import {
  DOPPELT,
  EINGANG_QUELLE,
  REPOSITORY,
  REPO_ID,
  artefaktRouten,
  ausmistenRepo,
  scheinApi,
  starte,
} from "./ausmisten/hilfen.mjs";
import { probeDirectory } from "./probe-repo.js";
import { ereignisDatei } from "./pruefer/hilfen.mjs";

const WERKZEUG = "tools/tests-ausmisten.mjs";
const OHNE_PAKETE = [
  "--import",
  fileURLToPath(new URL("ausmisten/ohne-pakete.mjs", import.meta.url)),
];
const CI_ID = 91;
const PR = 12;
const ISSUE = 31;
const LAUF_ID = "9753";
const TESTSCHUTZ_LAUF = 555;
const FORK_ID = 4343;
const MASTER = "1111111111111111111111111111111111111111";
const KOPF = "2222222222222222222222222222222222222222";
const ANDERE_SUMME = "f".repeat(64);
const EINRUECKUNG = 2;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const ZEITSTEMPEL = "2026-10-18T10:00:00.0000000Z";
const ERSTE_JOB_ID = 800;
const UEBERSCHRIFT = "## Tests, die mit totem Code wegfallen";
const LAUF_ADRESSE = `https://github.com/${REPOSITORY}/actions/runs/${LAUF_ID}`;
const STATUS_PFAD = `/repos/${REPOSITORY}/statuses/${KOPF}`;
const NEUSTART_PFAD = `/repos/${REPOSITORY}/actions/runs/${TESTSCHUTZ_LAUF}/rerun`;

function ciLauf(kopf, felder = {}) {
  return {
    path: ".github/workflows/ci.yml",
    event: "pull_request",
    workflow_id: CI_ID,
    conclusion: "success",
    head_sha: kopf,
    head_branch: `phase/${ISSUE}-P-7-probe`,
    head_repository: { id: REPO_ID, full_name: REPOSITORY },
    repository: { id: REPO_ID, full_name: REPOSITORY },
    pull_requests: [{ number: PR }],
    ...felder,
  };
}

const PHASE = "P-7-probe";
const BRANCH = `phase/${ISSUE}-${PHASE}`;
const PHASENDATEI = `plaene/${PHASE}/phase.json`;
const GUELTIG = `${UEBERSCHRIFT}\n- \`${DOPPELT}\`\n`;

function totcodeIssue(body, { nummer = ISSUE, akteur = "Antonio20045" } = {}) {
  const label = { name: "verhalten-geaendert" };
  const ereignis = {
    __typename: "LabeledEvent",
    createdAt: ZEITSTEMPEL,
    actor: { login: akteur },
    label,
  };
  return { number: nummer, body, lastEditedAt: null, timelineItems: { nodes: [ereignis] } };
}

function umgebungFuer(context, { github, lauf, master }) {
  return {
    GITHUB_API_URL: github.url,
    GITHUB_GRAPHQL_URL: `${github.url}/graphql`,
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: LAUF_ID,
    GITHUB_TOKEN: "actions-token",
    GITHUB_SHA: master,
    GITHUB_EVENT_PATH: ereignisDatei(context, lauf),
  };
}

function prStand(repo, fall) {
  const kopf = repo.committe(
    fall.neu ?? { "src/post/neu.js": "export const neu = 1;\n" },
    fall.weg ?? [],
  );
  if (!fall.masterWeiter) return { kopf, master: repo.master };
  repo.git(["checkout", "-q", repo.master]);
  return { kopf, master: repo.committe({ "src/post/weiter.js": "export const weiter = 1;\n" }) };
}

async function ermittle(context, fall = {}) {
  const phase = { [PHASENDATEI]: `${JSON.stringify({ issue: fall.phasenIssue ?? ISSUE })}\n` };
  const repo = ausmistenRepo(context, fall.ohnePhase ? {} : phase);
  const { kopf, master } = prStand(repo, fall);
  const lauf = ciLauf(kopf, fall.lauf);
  const pr = {
    number: PR,
    state: "open",
    body: fall.body ?? `Closes #${ISSUE}`,
    head: { sha: kopf, ref: fall.branch ?? BRANCH, repo: { id: fall.kopfRepo ?? REPO_ID } },
    base: { ref: "master", sha: master, repo: { id: REPO_ID } },
    ...fall.pr,
  };
  const issue = fall.issue === undefined ? totcodeIssue(GUELTIG) : fall.issue;
  const github = await scheinApi(
    context,
    new Map([
      [`GET /repos/${REPOSITORY}/actions/workflows/ci.yml`, { id: CI_ID }],
      [`GET /repos/${REPOSITORY}/pulls/${PR}`, pr],
      ["POST /graphql", { data: { repository: { issue } } }],
    ]),
  );
  const ausgabe = join(probeDirectory(context, { "ausgabe.txt": "" }), "ausgabe.txt");
  const umgebung = { ...umgebungFuer(context, { github, lauf, master }), GITHUB_OUTPUT: ausgabe };
  const args = ["totcode-ermitteln"];
  const ergebnis = await starte(WERKZEUG, { args, cwd: repo.ordner, umgebung, vorab: OHNE_PAKETE });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  return { ...ergebnis, ausgaben: ausgabenAus(ausgabe), master };
}

function erwarteListenFehler(ergebnis, teil) {
  assert.equal(ergebnis.ausgaben.noetig, "true", ergebnis.ausgabe);
  assert.equal(ergebnis.ausgaben.liste, "[]");
  assert.ok(ergebnis.ausgaben.fehler.includes(teil), ergebnis.ausgaben.fehler);
}

test("ausmisten-totcode-github: ein PR ohne gelöschten Test und ohne Totcode-Überschrift braucht keine Messung", async (context) => {
  const ergebnis = await ermittle(context, { issue: totcodeIssue("## Anderes\n- x\n") });
  assert.deepEqual(ergebnis.ausgaben, { noetig: "false" });
  assert.match(ergebnis.ausgabe, /nicht nötig: der PR löscht keine Datei unter test\//);
});

test("ausmisten-totcode-github: ein gelöschter Test macht die Messung nötig, die Liste kommt aus dem Issue des Phasen-Branches", async (context) => {
  const ergebnis = await ermittle(context, { weg: [DOPPELT] });
  assert.deepEqual(ergebnis.ausgaben, {
    noetig: "true",
    pr: String(PR),
    aufmaster: "true",
    fehler: "",
    liste: JSON.stringify([DOPPELT]),
  });
  assert.ok(ergebnis.ausgabe.includes(`Gelöscht: ${DOPPELT}`), ergebnis.ausgabe);
});

test("ausmisten-totcode-github: die Überschrift im verknüpften Issue allein macht die Messung nötig", async (context) => {
  const issue = totcodeIssue(`${UEBERSCHRIFT}\n- \`${DOPPELT}: ein Fall\`\n`);
  const ergebnis = await ermittle(context, { issue });
  assert.equal(ergebnis.ausgaben.noetig, "true");
  assert.equal(ergebnis.ausgaben.liste, JSON.stringify([`${DOPPELT}: ein Fall`]));
});

test("ausmisten-totcode-github: ein PR, dessen Kopf kein Branch phase/<issue>-<phase> ist, braucht keine Messung", async (context) => {
  for (const branch of [
    "ausmisten/posteingang",
    "phase/probe",
    `phase/${ISSUE}-..`,
    `x/phase/${ISSUE}-${PHASE}`,
  ]) {
    const ergebnis = await ermittle(context, { weg: [DOPPELT], branch });
    assert.deepEqual(ergebnis.ausgaben, { noetig: "false" }, branch);
    assert.ok(ergebnis.ausgabe.includes("kein Branch phase/<issue>-<phase>"), ergebnis.ausgabe);
  }
});

test("ausmisten-totcode-github: ein geschlossener PR, ein PR mit neuerem Kopf oder ein PR, der nicht auf master zielt, braucht keine Messung", async (context) => {
  const andererKopf = "3".repeat(KOPF.length);
  for (const [pr, grund] of [
    [{ state: "closed" }, `PR #${PR} ist nicht offen`],
    [
      { head: { sha: andererKopf, ref: BRANCH, repo: { id: REPO_ID } } },
      `PR #${PR} steht nicht mehr auf`,
    ],
    [{ base: { ref: "release", repo: { id: REPO_ID } } }, `PR #${PR} zielt nicht auf master`],
  ]) {
    const ergebnis = await ermittle(context, { weg: [DOPPELT], pr });
    assert.deepEqual(ergebnis.ausgaben, { noetig: "false" }, grund);
    assert.ok(ergebnis.ausgabe.includes(grund), ergebnis.ausgabe);
  }
});

test("ausmisten-totcode-github: ein PR aus einem Fork braucht keine Messung", async (context) => {
  const fork = { id: FORK_ID, full_name: "fremd/hermes" };
  for (const fall of [{ lauf: { head_repository: fork } }, { kopfRepo: FORK_ID }]) {
    const ergebnis = await ermittle(context, { ...fall, weg: [DOPPELT] });
    assert.deepEqual(ergebnis.ausgaben, { noetig: "false" });
    assert.match(ergebnis.ausgabe, /Fork/);
  }
});

test("ausmisten-totcode-github: ein CI-Lauf, der nicht success ist oder kein pull_request-Lauf von ci.yml, braucht keine Messung", async (context) => {
  for (const lauf of [
    { conclusion: "failure" },
    { conclusion: "cancelled" },
    { event: "push" },
    { path: ".github/workflows/ci.yml.alt" },
    { workflow_id: CI_ID + 1 },
  ]) {
    const ergebnis = await ermittle(context, { weg: [DOPPELT], lauf });
    assert.deepEqual(ergebnis.ausgaben, { noetig: "false" }, JSON.stringify(lauf));
  }
});

test("ausmisten-totcode-github: liegt der PR-Kopf nicht auf dem gemessenen master, meldet ermitteln aufmaster false", async (context) => {
  const ergebnis = await ermittle(context, { weg: [DOPPELT], masterWeiter: true });
  assert.equal(ergebnis.ausgaben.noetig, "true");
  assert.equal(ergebnis.ausgaben.aufmaster, "false");
});

test("ausmisten-totcode-github: ohne das Issue des Branches als einziges Totcode-Issue ist die Liste ungültig", async (context) => {
  erwarteListenFehler(
    await ermittle(context, { weg: [DOPPELT], issue: null }),
    `muss #${ISSUE} aus dem Branch sein (gefunden: keins)`,
  );
  erwarteListenFehler(
    await ermittle(context, {
      weg: [DOPPELT],
      body: "Closes #32",
      issue: totcodeIssue(GUELTIG, { nummer: 32 }),
    }),
    "(gefunden: #32)",
  );
  erwarteListenFehler(
    await ermittle(context, { weg: [DOPPELT], body: `Closes #${ISSUE}, closes #32` }),
    `(gefunden: #${ISSUE}, #${ISSUE})`,
  );
});

test("ausmisten-totcode-github: nennt phase.json der Basis das Issue nicht, ist die Liste ungültig", async (context) => {
  erwarteListenFehler(
    await ermittle(context, { weg: [DOPPELT], phasenIssue: 32 }),
    `${PHASENDATEI} auf master`,
  );
  erwarteListenFehler(
    await ermittle(context, { weg: [DOPPELT], ohnePhase: true }),
    `${PHASENDATEI} fehlt auf master`,
  );
});

test("ausmisten-totcode-github: ein Label, das nicht Antonio20045 oder jonas986 gesetzt hat, macht die Liste ungültig", async (context) => {
  const issue = totcodeIssue(GUELTIG, { akteur: "fremd" });
  erwarteListenFehler(
    await ermittle(context, { weg: [DOPPELT], issue }),
    "das Label verhalten-geaendert hat fremd gesetzt",
  );
});

const PAKETE = [0, 1];
const SCHLUESSEL = [
  `${EINGANG_QUELLE}:2:10-2:21 MethodExpression → text`,
  `${EINGANG_QUELLE}:3:10-3:21 MethodExpression → text`,
];
const GITHUB_HOECHSTLAENGE_BESCHREIBUNG = 140;

function stufe(art, felder) {
  return { art: `totcode-${art}`, basis: MASTER, kopf: KOPF, ...felder };
}

function paketStufe(art, nummer, { status, dateien = [EINGANG_QUELLE] }) {
  const mutanten = { [SCHLUESSEL[nummer]]: status };
  return stufe(art, { paket: nummer, dateien, teil: null, mutanten, gates: {}, ausgenommen: [] });
}

function messdaten(fall) {
  const nummern = fall.pakete ?? PAKETE;
  const pakete = nummern.map(() => ({ mutanten: 1, sekunden: 1, dateien: [EINGANG_QUELLE] }));
  const abbildung = { [EINGANG_QUELLE]: { kopf: EINGANG_QUELLE, diff: "" } };
  const menge = { geloeschteTests: [DOPPELT] };
  const kopfStatus = fall.kopfStatus ?? ["Killed", "Killed"];
  const plan = {
    liste: [DOPPELT],
    menge,
    abbildung,
    verschoben: {},
    verstoesse: [],
    pakete: fall.planPakete ?? pakete,
  };
  return [
    ["plan", stufe("plan", plan)],
    ["rotprobe", stufe("rotprobe", { faelle: [], verstoesse: [] })],
    ...nummern.flatMap((nummer) => [
      [`basis-${nummer}`, paketStufe("basis", nummer, { status: "Killed" })],
      [
        `kopf-${nummer}`,
        paketStufe("kopf", nummer, {
          status: kopfStatus[nummer],
          dateien: fall.kopfDateien,
        }),
      ],
    ]),
  ].map(([name, daten]) => {
    const text = `${JSON.stringify(daten, null, EINRUECKUNG)}\n`;
    return { name, text, summe: createHash("sha256").update(text).digest("hex") };
  });
}

function jobRouten(summen, { protokolle = {}, pakete = PAKETE }) {
  const namen = pakete.flatMap((nummer) => ["basis", "kopf"].map((art) => ({ art, nummer })));
  const jobs = namen.map(({ art, nummer }, index) => ({
    id: ERSTE_JOB_ID + index,
    name: totcodeJobName(art, nummer),
    status: "completed",
    conclusion: "success",
  }));
  const routen = new Map([
    [`GET /repos/${REPOSITORY}/actions/runs/${LAUF_ID}/jobs`, { total_count: jobs.length, jobs }],
  ]);
  namen.forEach(({ art, nummer }, index) => {
    const name = `${art}-${nummer}`;
    const zeile = protokolle[name] ?? pruefsummenZeile(nummer, summen.get(name), art);
    const protokoll = Buffer.from(`${ZEITSTEMPEL} Start\n${ZEITSTEMPEL} ${zeile}\n`);
    routen.set(`GET /repos/${REPOSITORY}/actions/jobs/${ERSTE_JOB_ID + index}/logs`, protokoll);
  });
  return routen;
}

function jobErgebnisse(summen, fall) {
  const ermitteln = {
    noetig: "true",
    pr: String(PR),
    aufmaster: fall.aufmaster ?? "true",
    fehler: fall.fehler ?? "",
  };
  return JSON.stringify({
    ermitteln: { result: fall.ermittelt ?? "success", outputs: ermitteln },
    planen: {
      result: "success",
      outputs: {
        pakete: fall.paketListe ?? JSON.stringify(fall.pakete ?? PAKETE),
        pruefsumme: summen.get("plan"),
      },
    },
    rotprobe: {
      result: fall.rotprobe ?? "success",
      outputs: { pruefsumme: fall.rotprobeSumme ?? summen.get("rotprobe") },
    },
    kette: { result: fall.kette ?? "success", outputs: {} },
  });
}

async function melde(context, fall = {}) {
  const daten = messdaten(fall);
  const summen = new Map(daten.map(({ name, summe }) => [name, summe]));
  const github = await scheinApi(
    context,
    new Map([
      ...artefaktRouten(LAUF_ID, daten),
      ...jobRouten(summen, fall),
      [`POST ${STATUS_PFAD}`, {}],
      [
        `GET /repos/${REPOSITORY}/actions/workflows/testschutz.yml/runs`,
        { workflow_runs: [{ id: TESTSCHUTZ_LAUF, status: "completed" }] },
      ],
      [`POST ${NEUSTART_PFAD}`, {}],
    ]),
  );
  const umgebung = {
    ...umgebungFuer(context, { github, lauf: ciLauf(KOPF), master: MASTER }),
    JOB_ERGEBNISSE: fall.jobErgebnisse ?? jobErgebnisse(summen, fall),
  };
  const repo = ausmistenRepo(context);
  const ergebnis = await starte(WERKZEUG, {
    args: ["totcode-melden"],
    cwd: repo.ordner,
    umgebung,
    vorab: OHNE_PAKETE,
  });
  const anfragen = github.anfragen.map(({ methode, pfad }) => `${methode} ${pfad}`);
  const status = github.anfragen.find(({ pfad }) => pfad === STATUS_PFAD);
  return { ...ergebnis, anfragen, gesetzt: status?.rumpf };
}

function erwarteGemeldet(ergebnis, zustand) {
  assert.equal(ergebnis.gesetzt?.state, zustand, ergebnis.ausgabe);
  assert.equal(ergebnis.gesetzt.context, "Totcode-Messung");
  assert.equal(ergebnis.gesetzt.target_url, LAUF_ADRESSE);
  assert.ok(ergebnis.gesetzt.description.length <= GITHUB_HOECHSTLAENGE_BESCHREIBUNG);
  const status = ergebnis.anfragen.indexOf(`POST ${STATUS_PFAD}`);
  assert.ok(
    status >= 0 && ergebnis.anfragen.indexOf(`POST ${NEUSTART_PFAD}`) > status,
    ergebnis.anfragen.join("\n"),
  );
}

async function erwarteFailure(context, faelle) {
  for (const [fall, grund] of faelle) {
    const ergebnis = await melde(context, fall);
    assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
    erwarteGemeldet(ergebnis, "failure");
    assert.ok(ergebnis.ausgabe.includes(grund), ergebnis.ausgabe);
  }
}

test("ausmisten-totcode-github: passen alle Prüfsummen und bleibt jeder Mutant getötet, setzt melden success auf den Kopf und startet den Testschutz neu", async (context) => {
  const ergebnis = await melde(context);
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  erwarteGemeldet(ergebnis, "success");
});

test("ausmisten-totcode-github: passt die Prüfsumme eines Kopf-Pakets nicht, setzt melden keinen Status success", async (context) => {
  for (const protokolle of [
    { "kopf-1": pruefsummenZeile(1, ANDERE_SUMME, "kopf") },
    { "basis-0": pruefsummenZeile(0, ANDERE_SUMME) },
  ]) {
    const ergebnis = await melde(context, { protokolle });
    assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
    erwarteGemeldet(ergebnis, "failure");
    assert.match(ergebnis.ausgabe, /json passt nicht zur Prüfsumme/);
  }
});

test("ausmisten-totcode-github: nennt das Protokoll eines Pakets die Prüfsumme nicht, setzt melden failure", async (context) => {
  const ergebnis = await melde(context, { protokolle: { "kopf-0": "nichts" } });
  erwarteGemeldet(ergebnis, "failure");
  assert.match(ergebnis.ausgabe, /Paket 0 \/ Kopf messen \/ Schritt/);
});

test("ausmisten-totcode-github: überlebt ein Mutant im zweiten Paket, setzt melden failure", async (context) => {
  const ergebnis = await melde(context, { kopfStatus: ["Killed", "Survived"] });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  erwarteGemeldet(ergebnis, "failure");
  assert.ok(
    ergebnis.ausgabe.includes(`Mutant im Kopf nicht getötet (Survived): ${SCHLUESSEL[1]}`),
    ergebnis.ausgabe,
  );
});

test("ausmisten-totcode-github: ein nicht erfolgreicher Mess-Job setzt failure", async (context) => {
  const ergebnis = await melde(context, { kette: "failure" });
  erwarteGemeldet(ergebnis, "failure");
  assert.match(ergebnis.ausgabe, /Job kette endete mit failure/);
});

test("ausmisten-totcode-github: liegt der PR-Kopf nicht auf master, setzt melden failure mit dem Grund und liest keine Artefakte", async (context) => {
  const ergebnis = await melde(context, { aufmaster: "false" });
  erwarteGemeldet(ergebnis, "failure");
  assert.equal(
    ergebnis.gesetzt.description,
    `rot: PR-Kopf liegt nicht auf master ${MASTER}; neu basieren`,
  );
  assert.ok(
    !ergebnis.anfragen.some((anfrage) => anfrage.includes("/artifacts")),
    ergebnis.anfragen.join("\n"),
  );
});

test("ausmisten-totcode-github: meldet ermitteln eine ungültige Liste, setzt melden failure mit dem Grund und misst nichts", async (context) => {
  const fehler = `Issue #${ISSUE}: das Label verhalten-geaendert hat fremd gesetzt`;
  const ergebnis = await melde(context, { fehler });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  erwarteGemeldet(ergebnis, "failure");
  assert.equal(ergebnis.gesetzt.description, `rot: ${fehler}`);
  assert.ok(!ergebnis.anfragen.some((anfrage) => anfrage.includes("/artifacts")));
});

test("ausmisten-totcode-github: eine übersprungene oder abgebrochene Messung endet nicht grün", async (context) => {
  for (const [fall, ende] of [
    [{ rotprobe: "skipped" }, "skipped"],
    [{ kette: "skipped" }, "skipped"],
    [{ kette: "cancelled" }, "cancelled"],
    [{ rotprobe: "cancelled" }, "cancelled"],
  ]) {
    const ergebnis = await melde(context, fall);
    assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
    erwarteGemeldet(ergebnis, "failure");
    assert.ok(ergebnis.ausgabe.includes(`endete mit ${ende}`), ergebnis.ausgabe);
  }
});

test("ausmisten-totcode-github: ein Plan mit anderer Paketzahl oder ein Paket, das andere Dateien gemessen hat, setzt failure", async (context) => {
  const dreiPakete = [...PAKETE, PAKETE.length].map(() => ({
    mutanten: 1,
    sekunden: 1,
    dateien: [EINGANG_QUELLE],
  }));
  await erwarteFailure(context, [
    [{ planPakete: dreiPakete }, "Plan und Paketliste passen nicht zusammen"],
    [{ kopfDateien: [DOPPELT] }, "kopf-0.json hat anderes gemessen als geplant"],
  ]);
});

test("ausmisten-totcode-github: ein Plan ohne Paket setzt success nur, wenn die Paketkette übersprungen wurde", async (context) => {
  const ohneKette = await melde(context, { pakete: [], kette: "skipped" });
  assert.equal(ohneKette.status, EXIT_GRUEN, ohneKette.ausgabe);
  erwarteGemeldet(ohneKette, "success");

  const mitKette = await melde(context, { pakete: [], kette: "success" });
  assert.equal(mitKette.status, EXIT_ROT, mitKette.ausgabe);
  erwarteGemeldet(mitKette, "failure");
  assert.match(mitKette.ausgabe, /Job kette endete mit success/);
});

test("ausmisten-totcode-github: meldet ermitteln keinen Erfolg oder sind die Job-Ergebnisse unlesbar, bricht melden ohne Status ab", async (context) => {
  for (const [fall, grund] of [
    [{ ermittelt: "skipped" }, "Herkunft: der Job ermitteln meldet keine nötige Messung."],
    [{ jobErgebnisse: "kein JSON" }, "Herkunft: JOB_ERGEBNISSE ist unlesbar."],
  ]) {
    const ergebnis = await melde(context, fall);
    assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
    assert.equal(ergebnis.gesetzt, undefined, ergebnis.ausgabe);
    assert.ok(ergebnis.ausgabe.includes(grund), ergebnis.ausgabe);
  }
});

test("ausmisten-totcode-github: eine ungültige Paketliste oder eine Rotprobe, die nicht zur Prüfsumme passt, setzt failure", async (context) => {
  await erwarteFailure(context, [
    [{ paketListe: "[1, 0]" }, "Die Paketliste des Plans fehlt oder ist ungültig"],
    [{ paketListe: "keine Liste" }, "Die Paketliste des Plans fehlt oder ist ungültig"],
    [{ rotprobeSumme: ANDERE_SUMME }, "rotprobe.json passt nicht zur Prüfsumme"],
  ]);
});
