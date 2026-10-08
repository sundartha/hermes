import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BRANCH,
  DOPPELT,
  EINGANG_QUELLE,
  FREMDE_QUELLE,
  GATE_TEST,
  RECHNEN_HILFE,
  RECHNEN_TEST,
  REPOSITORY,
  UHR_QUELLE,
  VERBOTEN,
  ausmistenRepo,
  scheinApi,
  starte,
} from "./ausmisten/hilfen.mjs";

const WERKZEUG = "tools/tests-nur-ergaenzt.mjs";
const SERVER = "https://github.com";
const PR_NUMMER = "7";
const REPO_ID = 4242;
const FREMDES_REPO_ID = 4343;
const LAUF_ID = 8642;
const WORKFLOW_ID = 77;
const FREMDE_WORKFLOW_ID = 78;
const EXIT_FREI = 0;
const EXIT_GESPERRT = 1;
const LAUF_ADRESSE = `${SERVER}/${REPOSITORY}/actions/runs/${LAUF_ID}`;
const GELOESCHT = "test/post/doppelt.test.js: die ganze Testdatei ist gelöscht";
const ANDERE_SHA = "0123456789abcdef0123456789abcdef01234567";
const BESTAND = "tools/basis/selbstpruefung.json";
const KURZE_SHA = 7;
const ZEITGLIEDER = "tools/basis/zeitglieder-bestand.json";
const MIT_QUELLE = 'import "../../src/post/eingang.js";\n';
const MIT_QUELLE_CJS = 'require("../../src/post/eingang.js");\n';
const WERKZEUG_DATEI = "tools/pruefen.mjs";
const MERGE_EINSTELLUNGEN = [
  "-c",
  "user.name=Probe",
  "-c",
  "user.email=probe@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

function standardLauf({ kopf, master, branch }) {
  return {
    id: LAUF_ID,
    workflow_id: WORKFLOW_ID,
    path: ".github/workflows/tests-ausmisten.yml",
    event: "workflow_run",
    head_branch: "master",
    head_sha: master,
    status: "completed",
    conclusion: "success",
    display_title: `Tests ausmisten ${kopf} ${branch}`,
    repository: { id: REPO_ID, full_name: REPOSITORY },
    head_repository: { id: REPO_ID, full_name: REPOSITORY },
  };
}

function standardPr({ kopf, basis, branch }) {
  return {
    number: Number(PR_NUMMER),
    body: "Tests ausmisten",
    head: { ref: branch, sha: kopf, repo: { id: REPO_ID } },
    base: { ref: "master", sha: basis, repo: { id: REPO_ID } },
  };
}

function standardStatus() {
  return { statuses: [{ context: "Tests ausmisten", state: "success", target_url: LAUF_ADRESSE }] };
}

function warteschlange(repo, { basis, kopf }, { zusatz }) {
  repo.git(["checkout", "-q", basis]);
  const schlange = repo.committe({ [UHR_QUELLE]: "export function jetzt() {\n  return 2;\n}\n" });
  repo.git([...MERGE_EINSTELLUNGEN, "cherry-pick", kopf]);
  if (zusatz) repo.committe(zusatz);
  return { repo, basis: schlange };
}

function aufbau(context, fall) {
  const repo = ausmistenRepo(context, fall.dateien);
  const gemessen = repo.master;
  const basis =
    fall.master === undefined ? gemessen : repo.committe(fall.master.neu ?? {}, fall.master.weg);
  const branch = fall.branch ?? { weg: [DOPPELT] };
  if (branch.vorher) branch.vorher(repo.ordner);
  const kopf = repo.committe(branch.neu ?? {}, branch.weg);
  if (fall.alsMerge) {
    repo.git(["checkout", "-q", basis]);
    repo.git([...MERGE_EINSTELLUNGEN, "merge", "--no-ff", "-q", "-m", "Prüfstand", kopf]);
  }
  if (fall.warteschlange)
    return { ...warteschlange(repo, { basis, kopf }, fall.warteschlange), gemessen, kopf };
  return { repo, gemessen, basis, kopf };
}

async function pruefe(context, fall = {}) {
  const { repo, gemessen, basis, kopf } = aufbau(context, fall);
  const werte = { kopf, basis, master: gemessen, branch: fall.prBranch ?? BRANCH };
  const lauf = { ...standardLauf(werte), ...fall.lauf?.(werte) };
  const pr = fall.pr?.(standardPr(werte)) ?? standardPr(werte);
  const status = fall.status === undefined ? standardStatus() : fall.status;
  const routen = new Map([
    [`GET /repos/${REPOSITORY}/pulls/${PR_NUMMER}`, fall.prAntwort ?? pr],
    [`GET /repos/${REPOSITORY}/commits/${pr.head.sha}/status`, status],
    [`GET /repos/${REPOSITORY}/actions/runs/${LAUF_ID}`, fall.laufAntwort ?? lauf],
    [
      `GET /repos/${REPOSITORY}/actions/workflows/tests-ausmisten.yml`,
      fall.workflow ?? { id: WORKFLOW_ID },
    ],
    ["POST /graphql", { data: { repository: { issue: null } } }],
  ]);
  const github = await scheinApi(context, routen);
  const umgebung = {
    GITHUB_TOKEN: "probe-token",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_API_URL: github.url,
    GITHUB_GRAPHQL_URL: `${github.url}/graphql`,
    GITHUB_SERVER_URL: SERVER,
  };
  return starte(WERKZEUG, {
    args: ["--basis", basis, "--pr", PR_NUMMER],
    cwd: repo.ordner,
    umgebung,
  });
}

function erwarteGesperrt(ergebnis, grund) {
  assert.equal(ergebnis.status, EXIT_GESPERRT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /die Ausnahme „Tests ausmisten“ gilt nicht/);
  assert.ok(ergebnis.ausgabe.includes(grund), ergebnis.ausgabe);
}

test("ausmisten-testschutz: ein gültiger Messlauf gibt das Löschen einer Testdatei frei", async (context) => {
  const ergebnis = await pruefe(context);
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Ausnahme „Tests ausmisten“ für Bereich posteingang/);
  assert.ok(ergebnis.ausgabe.includes(LAUF_ADRESSE), ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein Lösch-PR ohne Status bleibt gesperrt", async (context) => {
  const ergebnis = await pruefe(context, { status: { statuses: [] } });
  erwarteGesperrt(ergebnis, "kein Status „Tests ausmisten“");
  assert.ok(ergebnis.ausgabe.includes(GELOESCHT), ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein Status failure gibt nichts frei", async (context) => {
  const status = {
    statuses: [{ context: "Tests ausmisten", state: "failure", target_url: LAUF_ADRESSE }],
  };
  erwarteGesperrt(await pruefe(context, { status }), "Status „Tests ausmisten“ ist failure");
});

test("ausmisten-testschutz: ein Status mit fremder Lauf-Adresse gibt nichts frei", async (context) => {
  const target_url = `${SERVER}/fremd/repo/actions/runs/${LAUF_ID}`;
  const status = { statuses: [{ context: "Tests ausmisten", state: "success", target_url }] };
  erwarteGesperrt(await pruefe(context, { status }), "zeigt auf keinen Lauf dieses Repositorys");
});

test("ausmisten-testschutz: ein Lauf mit Ereignis push gibt nichts frei", async (context) => {
  const ergebnis = await pruefe(context, { lauf: () => ({ event: "push" }) });
  erwarteGesperrt(ergebnis, "kein workflow_run-Lauf von tests-ausmisten.yml");
  assert.ok(ergebnis.ausgabe.includes(GELOESCHT), ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein Lauf aus einer anderen Workflow-Datei gibt nichts frei", async (context) => {
  const lauf = () => ({ path: ".github/workflows/anders.yml" });
  erwarteGesperrt(
    await pruefe(context, { lauf }),
    "kein workflow_run-Lauf von tests-ausmisten.yml",
  );
});

test("ausmisten-testschutz: ein Lauf mit fremder Workflow-Nummer gibt nichts frei", async (context) => {
  const lauf = () => ({ workflow_id: FREMDE_WORKFLOW_ID });
  erwarteGesperrt(await pruefe(context, { lauf }), "Workflow-Nummer");
});

test("ausmisten-testschutz: ein Lauf mit anderer SHA im Titel gibt nichts frei", async (context) => {
  const lauf = ({ branch }) => ({ display_title: `Tests ausmisten ${ANDERE_SHA} ${branch}` });
  erwarteGesperrt(await pruefe(context, { lauf }), "Titel des Laufs");
});

test("ausmisten-testschutz: ein Lauf für einen anderen Bereich gibt nichts frei", async (context) => {
  const lauf = ({ kopf }) => ({ display_title: `Tests ausmisten ${kopf} ausmisten/anrufe` });
  erwarteGesperrt(await pruefe(context, { lauf }), "Titel des Laufs");
});

test("ausmisten-testschutz: ein gescheiterter Lauf gibt nichts frei", async (context) => {
  const lauf = () => ({ conclusion: "failure" });
  erwarteGesperrt(await pruefe(context, { lauf }), "nicht erfolgreich");
});

test("ausmisten-testschutz: ein Lauf, der nicht auf master lief, gibt nichts frei", async (context) => {
  const lauf = () => ({ head_branch: BRANCH });
  erwarteGesperrt(await pruefe(context, { lauf }), "nicht auf master");
});

test("ausmisten-testschutz: ein Lauf aus einem anderen Repository gibt nichts frei", async (context) => {
  const lauf = () => ({ repository: { id: FREMDES_REPO_ID, full_name: REPOSITORY } });
  erwarteGesperrt(await pruefe(context, { lauf }), "anderen Repository");
});

test("ausmisten-testschutz: der Branch Ausmisten/posteingang gibt nichts frei", async (context) => {
  const ergebnis = await pruefe(context, { prBranch: "Ausmisten/posteingang" });
  erwarteGesperrt(ergebnis, "heißt nicht genau ausmisten/<Bereich mit Quellen>");
});

test("ausmisten-testschutz: ein Bereich ohne Quellen gibt nichts frei", async (context) => {
  const ergebnis = await pruefe(context, { prBranch: "ausmisten/werkzeuge" });
  erwarteGesperrt(ergebnis, "heißt nicht genau ausmisten/<Bereich mit Quellen>");
});

test("ausmisten-testschutz: ein PR aus einem Fork gibt nichts frei", async (context) => {
  const pr = (standard) => ({
    ...standard,
    head: { ...standard.head, repo: { id: FREMDES_REPO_ID } },
  });
  erwarteGesperrt(await pruefe(context, { pr }), "Fork");
});

test("ausmisten-testschutz: ein PR-Kopf, der nicht geprüft wird, gibt nichts frei", async (context) => {
  const pr = (standard) => ({ ...standard, head: { ...standard.head, sha: ANDERE_SHA } });
  erwarteGesperrt(await pruefe(context, { pr }), "nicht der geprüfte Stand");
});

test("ausmisten-testschutz: eine seit der Messung geänderte src-Datei des Bereichs gibt nichts frei", async (context) => {
  const master = {
    neu: { [EINGANG_QUELLE]: "export function eingang(text) {\n  return text;\n}\n" },
  };
  erwarteGesperrt(
    await pruefe(context, { master }),
    `seit der Messung geändert: ${EINGANG_QUELLE}`,
  );
});

test("ausmisten-testschutz: eine geänderte src-Datei, die der gelöschte Test über eine Hilfe erreicht, gibt nichts frei", async (context) => {
  const master = {
    neu: { [FREMDE_QUELLE]: "export function doppelt(zahl) {\n  return zahl + zahl;\n}\n" },
  };
  const branch = { weg: [RECHNEN_TEST] };
  const ergebnis = await pruefe(context, { master, branch });
  erwarteGesperrt(ergebnis, `seit der Messung geändert: ${FREMDE_QUELLE}`);
});

test("ausmisten-testschutz: eine geänderte src-Datei außerhalb der Messmenge stört nicht", async (context) => {
  const master = { neu: { [UHR_QUELLE]: "export function jetzt() {\n  return 1;\n}\n" } };
  const ergebnis = await pruefe(context, { master });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});

test("ausmisten-testschutz: eine seit der Messung geänderte Testhilfe gibt nichts frei", async (context) => {
  const master = {
    neu: { [RECHNEN_HILFE]: 'export { doppelt as zweimal } from "../../src/fremd/rechnen.js";\n' },
  };
  const branch = { weg: [RECHNEN_TEST] };
  erwarteGesperrt(
    await pruefe(context, { master, branch }),
    `seit der Messung geändert: ${RECHNEN_HILFE}`,
  );
});

test("ausmisten-testschutz: eine geänderte Stryker-Konfiguration gibt nichts frei", async (context) => {
  const master = { neu: { "stryker.config.json": '{ "concurrency": 2 }\n' } };
  erwarteGesperrt(
    await pruefe(context, { master }),
    "seit der Messung geändert: stryker.config.json",
  );
});

test("ausmisten-testschutz: ein geändertes package-lock.json gibt nichts frei", async (context) => {
  const master = { neu: { "package-lock.json": '{ "lockfileVersion": 3 }\n' } };
  erwarteGesperrt(
    await pruefe(context, { master }),
    "seit der Messung geändert: package-lock.json",
  );
});

test("ausmisten-testschutz: ein gemessener Stand, der kein Vorfahr der Basis ist, gibt nichts frei", async (context) => {
  const lauf = () => ({ head_sha: ANDERE_SHA });
  erwarteGesperrt(await pruefe(context, { lauf }), "kein Vorfahr der Basis");
});

test("ausmisten-testschutz: ein PR, der tools/ ändert, gibt nichts frei", async (context) => {
  const branch = { weg: [DOPPELT], neu: { "tools/frei.mjs": "export const frei = true;\n" } };
  erwarteGesperrt(
    await pruefe(context, { branch }),
    "tools/frei.mjs: beim Ausmisten sind nur Dateien unter test/ erlaubt",
  );
});

test("ausmisten-testschutz: ein PR, der test/werkzeuge/ ändert, gibt nichts frei", async (context) => {
  const branch = { weg: [DOPPELT], neu: { "test/werkzeuge/neu.test.js": "export {};\n" } };
  erwarteGesperrt(
    await pruefe(context, { branch }),
    "test/werkzeuge/neu.test.js: beim Ausmisten sind nur Dateien",
  );
});

test("ausmisten-testschutz: ein gelöschter Gate-Test gibt nichts frei", async (context) => {
  const ergebnis = await pruefe(context, { branch: { weg: [DOPPELT, GATE_TEST] } });
  erwarteGesperrt(ergebnis, `${GATE_TEST}: Safety-Gate-Tests`);
});

test("ausmisten-testschutz: ein Symlink unter test/ gibt nichts frei", async (context) => {
  const vorher = (ordner) => symlinkSync("../src/post/eingang.js", join(ordner, "test/verweis.js"));
  const ergebnis = await pruefe(context, { branch: { weg: [DOPPELT], vorher } });
  erwarteGesperrt(ergebnis, "test/verweis.js: Symlinks und Submodule");
});

test("ausmisten-testschutz: eine nur gekürzte Bestandsdatei bleibt frei", async (context) => {
  const dateien = { [BESTAND]: '{ "befunde": ["a|1", "b|2"] }\n' };
  const branch = { weg: [DOPPELT], neu: { [BESTAND]: '{ "befunde": ["a|1"] }\n' } };
  const ergebnis = await pruefe(context, { dateien, branch });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});

test("ausmisten-testschutz: eine verlängerte Bestandsdatei gibt nichts frei", async (context) => {
  const dateien = { [BESTAND]: '{ "befunde": ["a|1"] }\n' };
  const branch = { weg: [DOPPELT], neu: { [BESTAND]: '{ "befunde": ["a|1", "c|3"] }\n' } };
  const ergebnis = await pruefe(context, { dateien, branch });
  erwarteGesperrt(ergebnis, `${BESTAND}: die Bestandsdatei darf nur Einträge verlieren`);
});

test("ausmisten-testschutz: eine neue Bestandsdatei gibt nichts frei", async (context) => {
  const branch = { weg: [DOPPELT], neu: { [BESTAND]: '{ "befunde": [] }\n' } };
  erwarteGesperrt(
    await pruefe(context, { branch }),
    `${BESTAND}: Bestandsdateien dürfen weder neu entstehen`,
  );
});

test("ausmisten-testschutz: ein PR, der nicht auf master zielt, gibt nichts frei", async (context) => {
  const pr = (standard) => ({ ...standard, base: { ...standard.base, ref: "staging" } });
  erwarteGesperrt(await pruefe(context, { pr }), "zielt nicht auf master");
});

test("ausmisten-testschutz: eine Lauf-Antwort mit anderer Nummer gibt nichts frei", async (context) => {
  const lauf = () => ({ id: LAUF_ID + 1 });
  erwarteGesperrt(
    await pruefe(context, { lauf }),
    "kein workflow_run-Lauf von tests-ausmisten.yml",
  );
});

test("ausmisten-testschutz: ohne Workflow-Nummer gibt es keine Freigabe", async (context) => {
  const lauf = () => ({ workflow_id: undefined });
  erwarteGesperrt(await pruefe(context, { lauf, workflow: {} }), "Workflow-Nummer");
});

test("ausmisten-testschutz: ein noch laufender Lauf gibt nichts frei", async (context) => {
  const lauf = () => ({ status: "in_progress" });
  erwarteGesperrt(await pruefe(context, { lauf }), "nicht erfolgreich abgeschlossen");
});

test("ausmisten-testschutz: ein Lauf mit fremdem Kopf-Repository gibt nichts frei", async (context) => {
  const lauf = () => ({ head_repository: { id: FREMDES_REPO_ID, full_name: REPOSITORY } });
  erwarteGesperrt(await pruefe(context, { lauf }), "anderen Repository");
});

test("ausmisten-testschutz: ein Lauf mit verkürzter master-SHA gibt nichts frei", async (context) => {
  const lauf = ({ master }) => ({ head_sha: master.slice(0, KURZE_SHA) });
  erwarteGesperrt(await pruefe(context, { lauf }), "keinen gemessenen master-Stand");
});

test("ausmisten-testschutz: ein PR, der die Testbank-Skripte ändert, gibt nichts frei", async (context) => {
  const neu = {
    "test/testbaenke-run.mjs": "export {};\n",
    "test/i18n-catalog-run.mjs": "export {};\n",
  };
  const ergebnis = await pruefe(context, { branch: { weg: [DOPPELT], neu } });
  erwarteGesperrt(ergebnis, "test/testbaenke-run.mjs: beim Ausmisten sind nur Dateien");
  assert.ok(
    ergebnis.ausgabe.includes("test/i18n-catalog-run.mjs: beim Ausmisten sind nur Dateien"),
  );
});

test("ausmisten-testschutz: keine der vier Bestandsdateien darf neu entstehen", async (context) => {
  const bestaende = [
    "tools/basis/test-importe.json",
    BESTAND,
    "tools/basis/fester-importpfad.json",
    ZEITGLIEDER,
  ];
  const neu = Object.fromEntries(bestaende.map((pfad) => [pfad, '{ "befunde": [] }\n']));
  const ergebnis = await pruefe(context, { branch: { weg: [DOPPELT], neu } });
  for (const pfad of bestaende) {
    assert.ok(
      ergebnis.ausgabe.includes(`${pfad}: Bestandsdateien dürfen weder neu entstehen`),
      ergebnis.ausgabe,
    );
  }
  assert.equal(ergebnis.status, EXIT_GESPERRT, ergebnis.ausgabe);
});

test("ausmisten-testschutz: eine Bestandsdatei mit geänderten Angaben neben der Liste gibt nichts frei", async (context) => {
  const dateien = { [BESTAND]: '{ "befunde": ["a|1"], "stand": 1 }\n' };
  const branch = { weg: [DOPPELT], neu: { [BESTAND]: '{ "befunde": ["a|1"] }\n' } };
  const ergebnis = await pruefe(context, { dateien, branch });
  erwarteGesperrt(ergebnis, `${BESTAND}: die Bestandsdatei darf nur Einträge verlieren`);
});

test("ausmisten-testschutz: der Merge-Stand eines gültigen PRs gibt das Löschen frei", async (context) => {
  const ergebnis = await pruefe(context, { alsMerge: true });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein Test, der eine geänderte Hilfe lädt und seit der Messung geändert ist, gibt nichts frei", async (context) => {
  const branch = {
    weg: [],
    neu: { [RECHNEN_HILFE]: 'export { doppelt as mal2 } from "../../src/fremd/rechnen.js";\n' },
  };
  const master = { neu: { [RECHNEN_TEST]: 'import "../hilfe/rechnen.js";\n' } };
  erwarteGesperrt(
    await pruefe(context, { master, branch }),
    `seit der Messung geändert: ${RECHNEN_TEST}`,
  );
});

test("ausmisten-testschutz: ein Test, der eine geänderte Datei beim Namen liest und seit der Messung geändert ist, gibt nichts frei", async (context) => {
  const leser = "test/post/werte.test.js";
  const dateien = {
    "test/fixtures/werte.json": '{ "a": 1 }\n',
    [leser]: `${MIT_QUELLE}const name = "werte.json";\nvoid name;\n`,
  };
  const branch = { weg: [], neu: { "test/fixtures/werte.json": '{ "a": 2 }\n' } };
  const master = {
    neu: { [leser]: `${MIT_QUELLE}const name = "werte.json";\n` },
  };
  erwarteGesperrt(
    await pruefe(context, { dateien, master, branch }),
    `seit der Messung geändert: ${leser}`,
  );
});

test("ausmisten-testschutz: ein Test, der eine geänderte Hilfe per require ohne Endung lädt, wird beobachtet", async (context) => {
  const hilfe = "test/hilfe/alt.cjs";
  const leser = "test/post/alt.test.cjs";
  const dateien = {
    [hilfe]: "module.exports = 1;\n",
    [leser]: `${MIT_QUELLE_CJS}require("../hilfe/alt");\n`,
  };
  const branch = { weg: [], neu: { [hilfe]: "module.exports = 2;\n" } };
  const master = {
    neu: { [leser]: `${MIT_QUELLE_CJS}require("../hilfe/alt");\nrequire("node:assert");\n` },
  };
  erwarteGesperrt(
    await pruefe(context, { dateien, master, branch }),
    `seit der Messung geändert: ${leser}`,
  );
});

test("ausmisten-testschutz: eine geänderte Bestandsdatei mit zusätzlichem Schlüssel gibt nichts frei", async (context) => {
  const dateien = { [BESTAND]: '{ "befunde": ["a|1", "b|2"] }\n' };
  const branch = { weg: [DOPPELT], neu: { [BESTAND]: '{ "befunde": ["a|1"], "frei": true }\n' } };
  const ergebnis = await pruefe(context, { dateien, branch });
  erwarteGesperrt(ergebnis, `${BESTAND}: die Bestandsdatei darf nur Einträge verlieren`);
});

test("ausmisten-testschutz: eine geänderte Quelle des Bereichs, die kein geänderter Test lädt, gibt nichts frei", async (context) => {
  const zweite = "src/post/zweite.js";
  const dateien = { [zweite]: "export const zweite = 1;\n" };
  const master = { neu: { [zweite]: "export const zweite = 2;\n" } };
  erwarteGesperrt(
    await pruefe(context, { dateien, master }),
    `seit der Messung geändert: ${zweite}`,
  );
});

test("ausmisten-testschutz: eine geänderte src-Datei, die ein gelöschter Test über einen verschlungenen Pfad lädt, gibt nichts frei", async (context) => {
  const verschlungen = "test/post/verschlungen.test.js";
  const dateien = { [verschlungen]: 'import "../../src/fremd/./rechnen.js";\n' };
  const master = {
    neu: { [FREMDE_QUELLE]: "export function doppelt(zahl) {\n  return 2 * zahl;\n}\n" },
  };
  const ergebnis = await pruefe(context, { dateien, master, branch: { weg: [verschlungen] } });
  erwarteGesperrt(ergebnis, `seit der Messung geändert: ${FREMDE_QUELLE}`);
});

test("ausmisten-testschutz: ein Warteschlangen-Commit mit gleichem Inhalt wie der PR gibt das Löschen frei", async (context) => {
  const ergebnis = await pruefe(context, { warteschlange: {} });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein Warteschlangen-Commit mit zusätzlicher Änderung gibt nichts frei", async (context) => {
  const zusatz = { "test/post/eingang.test.js": "export {};\n" };
  erwarteGesperrt(
    await pruefe(context, { warteschlange: { zusatz } }),
    "der PR-Kopf ist nicht der geprüfte Stand",
  );
});

test("ausmisten-testschutz: ein gekürzter Zeitglieder-Bestand bleibt frei", async (context) => {
  const dateien = { [ZEITGLIEDER]: '{ "test/a.test.js": 2, "test/b.test.js": 1 }\n' };
  const branch = { weg: [DOPPELT], neu: { [ZEITGLIEDER]: '{ "test/a.test.js": 1 }\n' } };
  const ergebnis = await pruefe(context, { dateien, branch });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein verlängerter Zeitglieder-Bestand gibt nichts frei", async (context) => {
  const dateien = { [ZEITGLIEDER]: '{ "test/a.test.js": 1 }\n' };
  const branch = { weg: [DOPPELT], neu: { [ZEITGLIEDER]: '{ "test/a.test.js": 2 }\n' } };
  const ergebnis = await pruefe(context, { dateien, branch });
  erwarteGesperrt(ergebnis, `${ZEITGLIEDER}: die Bestandsdatei darf nur Einträge verlieren`);
});

test("ausmisten-testschutz: ein Zeitglieder-Bestand mit neuer Datei gibt nichts frei", async (context) => {
  const dateien = { [ZEITGLIEDER]: '{ "test/a.test.js": 1 }\n' };
  const branch = { weg: [DOPPELT], neu: { [ZEITGLIEDER]: '{ "test/b.test.js": 1 }\n' } };
  const ergebnis = await pruefe(context, { dateien, branch });
  erwarteGesperrt(ergebnis, `${ZEITGLIEDER}: die Bestandsdatei darf nur Einträge verlieren`);
});

test("ausmisten-testschutz: fehlende Leserechte auf den Status geben nichts frei und sagen warum", async (context) => {
  const ergebnis = await pruefe(context, { status: VERBOTEN });
  erwarteGesperrt(
    ergebnis,
    "Dem Token fehlen Leserechte; der Job Testschutz braucht actions: read und statuses: read.",
  );
  assert.ok(ergebnis.ausgabe.includes(GELOESCHT), ergebnis.ausgabe);
});

test("ausmisten-testschutz: fehlende Leserechte auf den Lauf geben nichts frei", async (context) => {
  erwarteGesperrt(await pruefe(context, { laufAntwort: VERBOTEN }), "HTTP 403");
});

test("ausmisten-testschutz: ein gelöschter Test, der nur tools/ prüft, gibt nichts frei", async (context) => {
  const nurWerkzeug = "test/post/werkzeug.test.js";
  const dateien = {
    [WERKZEUG_DATEI]: "export const ok = true;\n",
    [nurWerkzeug]: 'const programm = "tools/pruefen.mjs";\nvoid programm;\n',
  };
  const ergebnis = await pruefe(context, { dateien, branch: { weg: [nurWerkzeug] } });
  erwarteGesperrt(ergebnis, `${nurWerkzeug}: erreicht keine Datei der Messmenge`);
  assert.ok(
    ergebnis.ausgabe.includes(`${nurWerkzeug}: prüft tools/ oder scripts/`),
    ergebnis.ausgabe,
  );
});

test("ausmisten-testschutz: ein gelöschter Test, der neben src auch tools/ importiert, ist messbar und gibt frei", async (context) => {
  const gemischt = "test/post/gemischt.test.js";
  const dateien = {
    [WERKZEUG_DATEI]: "export const ok = true;\n",
    [gemischt]: `${MIT_QUELLE}import "../../tools/pruefen.mjs";\n`,
  };
  const ergebnis = await pruefe(context, { dateien, branch: { weg: [gemischt] } });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein gelöschter Test, der neben src auch eine Datendatei unter tools/ importiert, gibt nichts frei", async (context) => {
  const gemischt = "test/post/gemischt.test.cjs";
  const daten = "tools/pruefen-daten.json";
  const dateien = {
    [daten]: '{ "ok": true }\n',
    [gemischt]: `${MIT_QUELLE_CJS}require("../../tools/pruefen-daten.json");\n`,
  };
  const ergebnis = await pruefe(context, { dateien, branch: { weg: [gemischt] } });
  erwarteGesperrt(ergebnis, `${gemischt}: prüft tools/ oder scripts/ (${daten}`);
});

test("ausmisten-testschutz: ein gelöschter Test, der scripts/ nur als Text nennt, gibt nichts frei", async (context) => {
  const nennt = "test/post/nennt.test.js";
  const dateien = {
    [nennt]: `${MIT_QUELLE}const skript = "scripts/check-setup.js";\nvoid skript;\n`,
  };
  const ergebnis = await pruefe(context, { dateien, branch: { weg: [nennt] } });
  erwarteGesperrt(ergebnis, `${nennt}: prüft tools/ oder scripts/ (${nennt})`);
});

test("ausmisten-testschutz: eine geänderte Datei unter test/sicherheit/ gibt nichts frei", async (context) => {
  const sicherheit = "test/sicherheit/grenze.test.js";
  const dateien = { [sicherheit]: MIT_QUELLE };
  const branch = { weg: [DOPPELT], neu: { [sicherheit]: `${MIT_QUELLE}void 1;\n` } };
  erwarteGesperrt(
    await pruefe(context, { dateien, branch }),
    `${sicherheit}: beim Ausmisten sind nur Dateien`,
  );
});

test("ausmisten-testschutz: eine geänderte Datendatei, die kein Test nutzt, gibt nichts frei", async (context) => {
  const daten = "test/daten/frei.json";
  const dateien = { [daten]: '{ "a": 1 }\n' };
  const branch = { weg: [DOPPELT], neu: { [daten]: '{ "a": 2 }\n' } };
  erwarteGesperrt(
    await pruefe(context, { dateien, branch }),
    `${daten}: keine Testdatei lädt oder nennt diese Datei`,
  );
});

test("ausmisten-testschutz: eine geänderte Datendatei, die ein Test mit src-Bezug nennt, bleibt frei", async (context) => {
  const daten = "test/daten/genutzt.json";
  const leser = "test/post/liest.test.js";
  const dateien = {
    [daten]: '{ "a": 1 }\n',
    [leser]: `${MIT_QUELLE}const name = "genutzt.json";\nvoid name;\n`,
  };
  const branch = { weg: [DOPPELT], neu: { [daten]: '{ "a": 2 }\n' } };
  const ergebnis = await pruefe(context, { dateien, branch });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein Fehler beim Abruf des PRs ergibt „gilt nicht“", async (context) => {
  const ergebnis = await pruefe(context, { prAntwort: VERBOTEN });
  assert.equal(ergebnis.status, EXIT_GESPERRT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /die Ausnahme „Tests ausmisten“ gilt nicht: .*HTTP 403/);
});

test("ausmisten-testschutz: ein MCP-Methodenname wie tools/call in einer Hilfe sperrt nichts", async (context) => {
  const hilfe = "test/hilfe/mcp.js";
  const nutzer = "test/post/mcp.test.js";
  const dateien = {
    [hilfe]: 'export const methode = "tools/call";\n',
    [nutzer]: `${MIT_QUELLE}import { methode } from "../hilfe/mcp.js";\nvoid methode;\n`,
  };
  const ergebnis = await pruefe(context, { dateien, branch: { weg: [nutzer] } });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});

test("ausmisten-testschutz: ein Werkzeugpfad mit Endung als Literal sperrt", async (context) => {
  const nennt = "test/post/auftrag.test.js";
  const dateien = { [nennt]: `${MIT_QUELLE}const ziel = "../tools/auftrag.mjs";\nvoid ziel;\n` };
  const ergebnis = await pruefe(context, { dateien, branch: { weg: [nennt] } });
  erwarteGesperrt(ergebnis, `${nennt}: prüft tools/ oder scripts/ (${nennt})`);
});

test("ausmisten-testschutz: ein Werkzeugpfad nur im Kommentar sperrt nichts", async (context) => {
  const kommentiert = "test/post/kommentiert.test.js";
  const dateien = {
    [kommentiert]: `${MIT_QUELLE}// vergleichbar mit 'tools/auftrag.mjs'\nvoid 0;\n`,
  };
  const ergebnis = await pruefe(context, { dateien, branch: { weg: [kommentiert] } });
  assert.equal(ergebnis.status, EXIT_FREI, ergebnis.ausgabe);
});
