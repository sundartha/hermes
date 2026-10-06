import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { delimiter } from "node:path";
import { test } from "node:test";

import {
  BRANCH,
  EINGANG_ID,
  REPOSITORY,
  artefaktRouten,
  ausmistenRepo,
  eingangsLauf,
  scheinApi,
  starte,
} from "./ausmisten/hilfen.mjs";
import { ereignisDatei } from "./pruefer/hilfen.mjs";
import { ersatzGh } from "./ziele/hilfen.mjs";

const WERKZEUG = "tools/tests-ausmisten.mjs";
const KOPF = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const ANDERE_SHA = "0123456789abcdef0123456789abcdef01234567";
const SHA256_ZEICHEN = 64;
const ISSUE_NUMMER = 4711;
const ANDERE_SUMME = "f".repeat(SHA256_ZEICHEN);
const ZWEITE_DATEI = "src/post/zweite.js";
const ZWEITER_MUTANT = `${ZWEITE_DATEI}:2:10-2:11 BooleanLiteral → false`;
const LAUF_ID = "9753";
const PR_NUMMER = 12;
const TESTSCHUTZ_LAUF = 555;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const MAX_BESCHREIBUNG = 140;
const EINRUECKUNG = 2;
const DATEI = "src/post/eingang.js";
const ALTER_TEST = "test/post/doppelt.test.js";
const ZEILE_DES_MUTANTEN = 2;
const LETZTE_ZEILE_DES_BLOCKS = 3;
const ZEILEN_MUTANT = [ZEILE_DES_MUTANTEN, ZEILE_DES_MUTANTEN];
const ZEILEN_BLOCK = [1, LETZTE_ZEILE_DES_BLOCKS];
const MUTANT = `${DATEI}:2:10-2:21 MethodExpression → text`;
const BLOCK = `${DATEI}:1:30-3:2 BlockStatement → {}`;
const LAUF_ADRESSE = `https://github.com/${REPOSITORY}/actions/runs/${LAUF_ID}`;

function artefaktDaten(name, master, felder = {}) {
  const gemeinsam = {
    format: 1,
    art: name,
    kopf: KOPF,
    master,
    bereich: "posteingang",
    dateien: [DATEI],
    mutanten: { [MUTANT]: "Killed", [BLOCK]: "Killed" },
    gate: { [MUTANT]: "Killed" },
    trockenlauf: { sekunden: 2, exit: 0 },
  };
  const basis = {
    erreicht: [DATEI],
    erreichtGate: [DATEI],
    testzeilen: { vorher: 40, nachher: 32 },
    tests: { alt: [ALTER_TEST], neu: [] },
    orte: { [MUTANT]: ZEILEN_MUTANT, [BLOCK]: ZEILEN_BLOCK },
  };
  return { ...gemeinsam, ...(name === "basis" ? basis : {}), ...felder };
}

function alsText(daten) {
  return typeof daten === "string" ? daten : `${JSON.stringify(daten, null, EINRUECKUNG)}\n`;
}

function summe(text) {
  return createHash("sha256").update(text).digest("hex");
}

function planDaten(master, felder = {}) {
  return {
    format: 1,
    art: "plan",
    kopf: KOPF,
    master,
    bereich: "posteingang",
    dateien: [DATEI],
    tests: { alt: [ALTER_TEST], neu: [] },
    issue: null,
    pakete: [{ mutanten: 2, dateien: [DATEI] }],
    ...felder,
  };
}

function artefaktListe(master, fall) {
  const plan = alsText(planDaten(master, fall.plan));
  const basis = [alsText(artefaktDaten("basis", master, fall.basis)), ...(fall.weitereBasis ?? [])];
  const branch = [
    fall.branchText ?? alsText(artefaktDaten("branch", master, fall.branch)),
    ...(fall.weitereBranch ?? []),
  ];
  const eintraege = [
    { name: "plan", text: plan },
    ...basis.map((text, nummer) => ({ name: `basis-${nummer}`, text })),
    ...branch.map((text, nummer) => ({ name: `branch-${nummer}`, text })),
  ];
  const pakete = JSON.stringify(basis.map((_text, nummer) => nummer));
  const ausgaben = {
    pakete,
    pruefsumme: summe(plan),
    summen: JSON.stringify(basis.map(summe)),
    ...fall.ausgaben,
  };
  return { eintraege: fall.liste?.(eintraege) ?? eintraege, ausgaben };
}

function jobs({ pakete, pruefsumme, summen }, ergebnisse = {}) {
  const ergebnis = (name) => ergebnisse[name] ?? "success";
  return JSON.stringify({
    planen: { result: ergebnis("planen"), outputs: { pakete, pruefsumme } },
    basis: { result: ergebnis("basis"), outputs: {} },
    sammeln: { result: ergebnis("sammeln"), outputs: { summen } },
    branch: { result: ergebnis("branch"), outputs: {} },
  });
}

async function melde(context, angabe = {}) {
  const repo = ausmistenRepo(context);
  const fall = { ...angabe, ...angabe.zusatz?.(repo.master) };
  const { eintraege, ausgaben } = artefaktListe(repo.master, fall);
  const routen = new Map([
    ...artefaktRouten(LAUF_ID, eintraege),
    [`GET /repos/${REPOSITORY}/actions/workflows/ausmisten-eingang.yml`, { id: EINGANG_ID }],
    [`POST /repos/${REPOSITORY}/statuses/${KOPF}`, {}],
    [`GET /repos/${REPOSITORY}/pulls`, fall.offenePrs ?? []],
    [`POST /repos/${REPOSITORY}/pulls`, { number: PR_NUMMER }],
    [
      `GET /repos/${REPOSITORY}/actions/workflows/testschutz.yml/runs`,
      { workflow_runs: [{ id: TESTSCHUTZ_LAUF, status: "completed" }] },
    ],
    [`POST /repos/${REPOSITORY}/actions/runs/${TESTSCHUTZ_LAUF}/rerun`, {}],
  ]);
  const github = await scheinApi(context, routen);
  const gh = ersatzGh(context);
  const umgebung = {
    GITHUB_API_URL: github.url,
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: LAUF_ID,
    GITHUB_EVENT_PATH: ereignisDatei(context, eingangsLauf(KOPF, fall.lauf)),
    GITHUB_TOKEN: "actions-token",
    GH_TOKEN: "bot-token",
    JOB_ERGEBNISSE: jobs(ausgaben, fall.ergebnisse),
    PATH: `${gh.pfad}${delimiter}${process.env.PATH}`,
  };
  const args = ["melden", ...(fall.pr ? ["--pr"] : [])];
  const ergebnis = await starte(WERKZEUG, { args, cwd: repo.ordner, umgebung });
  const status = github.anfragen.find(
    ({ methode, pfad }) => methode === "POST" && pfad.includes("/statuses/"),
  );
  return { ...ergebnis, gesetzt: status?.rumpf, anfragen: github.anfragen, gh };
}

function erwarteNeustartMit(ergebnis, schalter) {
  const pfade = ergebnis.anfragen.map(({ methode, pfad }) => `${methode} ${pfad}`);
  assert.ok(
    pfade.includes(`POST /repos/${REPOSITORY}/actions/runs/${TESTSCHUTZ_LAUF}/rerun`),
    pfade.join("\n"),
  );
  assert.ok(!pfade.includes(`POST /repos/${REPOSITORY}/pulls`));
  const aufrufe = ergebnis.gh.aufrufe().map(({ argumente }) => argumente);
  assert.deepEqual(aufrufe, [
    ["pr", "merge", String(PR_NUMMER), "--repo", REPOSITORY, ...schalter],
  ]);
}

function erwarteRot(ergebnis, grund) {
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.equal(ergebnis.gesetzt?.state, "failure", ergebnis.ausgabe);
  assert.equal(ergebnis.gesetzt.context, "Tests ausmisten");
  assert.ok(ergebnis.ausgabe.includes(grund), ergebnis.ausgabe);
}

test("ausmisten-melden: gleiche Tötungen auf Basis und Branch setzen den Status success", async (context) => {
  const ergebnis = await melde(context);
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.equal(ergebnis.gesetzt.state, "success");
  assert.equal(ergebnis.gesetzt.context, "Tests ausmisten");
  assert.equal(ergebnis.gesetzt.target_url, LAUF_ADRESSE);
  assert.ok(ergebnis.gesetzt.description.length <= MAX_BESCHREIBUNG);
  assert.match(ergebnis.gesetzt.description, /getötet Basis 2, Branch 2/);
});

test("ausmisten-melden: ein fehlendes Artefakt setzt failure", async (context) => {
  const liste = (eintraege) => eintraege.filter(({ name }) => name !== "branch-0");
  erwarteRot(await melde(context, { liste }), "Artefakt branch-0 fehlt");
});

test("ausmisten-melden: ein nicht erfolgreicher Mess-Job setzt failure", async (context) => {
  const ergebnis = await melde(context, { ergebnisse: { basis: "cancelled" } });
  erwarteRot(ergebnis, "Job basis endete mit cancelled");
});

test("ausmisten-melden: ein Artefakt, das nicht zur Prüfsumme des Jobs passt, setzt failure", async (context) => {
  const ausgaben = { summen: JSON.stringify([ANDERE_SUMME]) };
  erwarteRot(await melde(context, { ausgaben }), "Artefakt basis-0 passt nicht zur Prüfsumme");
});

test("ausmisten-melden: eine zusätzliche Datei im Artefakt setzt failure", async (context) => {
  const liste = (eintraege) =>
    eintraege.map((eintrag) =>
      eintrag.name === "branch-0" ? { ...eintrag, datei: "zusatz.json" } : eintrag,
    );
  erwarteRot(await melde(context, { liste }), "enthält nicht genau die Datei branch-0.json");
});

test("ausmisten-melden: ein Artefakt für eine andere Kopf-SHA setzt failure", async (context) => {
  erwarteRot(await melde(context, { branch: { kopf: ANDERE_SHA } }), "Kopf-SHA passt nicht");
});

test("ausmisten-melden: ein Artefakt von einem anderen master-Stand setzt failure", async (context) => {
  erwarteRot(await melde(context, { basis: { master: ANDERE_SHA } }), "master-SHA passt nicht");
});

test("ausmisten-melden: ein Artefakt mit unbekanntem Mutantenstatus setzt failure", async (context) => {
  const branch = { mutanten: { [MUTANT]: "Erfunden", [BLOCK]: "Killed" } };
  erwarteRot(await melde(context, { branch }), "Mutantenliste ist ungültig");
});

test("ausmisten-melden: ein auf dem Branch überlebender Basis-Mutant setzt failure", async (context) => {
  const branch = { mutanten: { [MUTANT]: "Survived", [BLOCK]: "Killed" } };
  erwarteRot(
    await melde(context, { branch }),
    `Mutant auf dem Branch nicht mehr getötet: ${MUTANT}`,
  );
});

test("ausmisten-melden: ein auf dem Branch fehlender Basis-Mutant setzt failure", async (context) => {
  const branch = { mutanten: { [BLOCK]: "Killed" } };
  erwarteRot(
    await melde(context, { branch }),
    `Mutant auf dem Branch nicht mehr getötet: ${MUTANT}`,
  );
});

test("ausmisten-melden: ein Timeout auf dem Branch ersetzt keine Tötung der Basis", async (context) => {
  const branch = { mutanten: { [MUTANT]: "Timeout", [BLOCK]: "Killed" } };
  erwarteRot(
    await melde(context, { branch }),
    `Mutant auf dem Branch nicht mehr getötet: ${MUTANT}`,
  );
});

test("ausmisten-melden: ein Timeout auf Basis und Branch zählt als getötet", async (context) => {
  const mutanten = { [MUTANT]: "Timeout", [BLOCK]: "Killed" };
  const ergebnis = await melde(context, { basis: { mutanten }, branch: { mutanten } });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
});

test("ausmisten-melden: ein im Gate-Lauf verlorener Mutant setzt failure", async (context) => {
  const branch = { gate: { [MUTANT]: "Survived" } };
  erwarteRot(await melde(context, { branch }), `Gate-Lauf: Mutant nicht mehr getötet: ${MUTANT}`);
});

test("ausmisten-melden: ein getöteter Mutant in einer Datei, die kein Branch-Test erreicht, setzt failure", async (context) => {
  const basis = { erreicht: [] };
  erwarteRot(await melde(context, { basis }), "keine Testdatei des Branches erreicht die Datei");
});

test("ausmisten-melden: ein Gate-Mutant in einer Datei ohne Gate-Test des Branches setzt failure", async (context) => {
  const basis = { erreichtGate: [] };
  erwarteRot(await melde(context, { basis }), "keine Testdatei des Branches erreicht die Datei");
});

test("ausmisten-melden: ein fremder auslösender Lauf setzt keinen Status", async (context) => {
  const ergebnis = await melde(context, { lauf: { event: "pull_request" } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.equal(ergebnis.gesetzt, undefined);
  assert.match(ergebnis.ausgabe, /Herkunft: der auslösende Lauf ist kein Push-Lauf/);
});

test("ausmisten-melden: eine fremde Workflow-Nummer setzt keinen Status", async (context) => {
  const ergebnis = await melde(context, { lauf: { workflow_id: EINGANG_ID + 1 } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.equal(ergebnis.gesetzt, undefined);
  assert.match(ergebnis.ausgabe, /Workflow-Nummer gehört nicht zu ausmisten-eingang\.yml/);
});

test("ausmisten-melden: grün öffnet mit dem Bot-Token den PR und schaltet Auto-Merge ein", async (context) => {
  const ergebnis = await melde(context, { pr: true });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.equal(ergebnis.gesetzt, undefined);
  const pr = ergebnis.anfragen.find(
    ({ methode, pfad }) => methode === "POST" && pfad.endsWith("/pulls"),
  );
  assert.equal(pr.rumpf.title, "Paket 37: Tests ausmisten posteingang");
  assert.equal(pr.rumpf.head, BRANCH);
  assert.match(pr.rumpf.body, /Testzeilen: vorher 40, nachher 32/);
  const [aufruf] = ergebnis.gh.aufrufe();
  assert.deepEqual(aufruf.argumente, [
    "pr",
    "merge",
    String(PR_NUMMER),
    "--repo",
    REPOSITORY,
    "--auto",
    "--rebase",
  ]);
  assert.equal(aufruf.token, "bot-token");
});

test("ausmisten-melden: grün mit offenem PR schaltet Auto-Merge ein und startet den Testschutz neu", async (context) => {
  const offenePrs = [{ number: PR_NUMMER, head: { ref: BRANCH, sha: KOPF } }];
  const ergebnis = await melde(context, { pr: true, offenePrs });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  erwarteNeustartMit(ergebnis, ["--auto", "--rebase"]);
});

test("ausmisten-melden: rot öffnet keinen PR", async (context) => {
  const branch = { mutanten: { [MUTANT]: "Survived", [BLOCK]: "Killed" } };
  const ergebnis = await melde(context, { pr: true, branch });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.ok(
    !ergebnis.anfragen.some(({ methode, pfad }) => methode === "POST" && pfad.endsWith("/pulls")),
  );
  assert.deepEqual(ergebnis.gh.aufrufe(), []);
});

test("ausmisten-melden: ein Artefakt mit falscher Art setzt failure", async (context) => {
  erwarteRot(await melde(context, { branch: { art: "basis" } }), "Format oder Art passt nicht");
});

test("ausmisten-melden: ein Artefakt für einen anderen Bereich setzt failure", async (context) => {
  erwarteRot(await melde(context, { basis: { bereich: "anrufe" } }), "Bereich passt nicht");
});

test("ausmisten-melden: eine ungültige Dateiliste setzt failure", async (context) => {
  erwarteRot(
    await melde(context, { branch: { dateien: ["tools/x.mjs"] } }),
    "Dateiliste ist ungültig",
  );
});

test("ausmisten-melden: ein Artefakt ohne Trockenlauf setzt failure", async (context) => {
  erwarteRot(await melde(context, { branch: { trockenlauf: {} } }), "Trockenlauf fehlt");
});

test("ausmisten-melden: erreichte Dateien außerhalb der Messmenge setzen failure", async (context) => {
  const basis = { erreicht: [DATEI, "src/anders.js"] };
  erwarteRot(await melde(context, { basis }), "Liste der erreichten Dateien ist ungültig");
});

test("ausmisten-melden: eine Basis ohne Testzeilen setzt failure", async (context) => {
  erwarteRot(await melde(context, { basis: { testzeilen: {} } }), "Testzeilen fehlen");
});

test("ausmisten-melden: ohne festgehaltene Basis-Prüfsummen setzt melden failure", async (context) => {
  const ergebnis = await melde(context, { ausgaben: { summen: undefined } });
  erwarteRot(ergebnis, "Die Prüfsummen der Basis-Pakete fehlen");
});

test("ausmisten-melden: ein Plan ohne Prüfsumme setzt failure", async (context) => {
  const ergebnis = await melde(context, { ausgaben: { pruefsumme: "" } });
  erwarteRot(ergebnis, "Für den Plan fehlt die Prüfsumme");
});

test("ausmisten-melden: ein veränderter Plan setzt failure", async (context) => {
  const ergebnis = await melde(context, { ausgaben: { pruefsumme: ANDERE_SUMME } });
  erwarteRot(ergebnis, "Der Plan passt nicht zur Prüfsumme");
});

test("ausmisten-melden: ein Artefakt, das kein JSON-Objekt ist, setzt failure", async (context) => {
  erwarteRot(
    await melde(context, { branchText: "[]\n" }),
    "Artefakt branch-0 ist kein JSON-Objekt",
  );
});

test("ausmisten-melden: ein Mutant außerhalb der gemessenen Dateien setzt failure", async (context) => {
  const branch = {
    mutanten: { [MUTANT]: "Killed", [BLOCK]: "Killed", "src/anders.js:1:1-1:2 X → y": "Killed" },
  };
  erwarteRot(await melde(context, { branch }), "Mutantenliste ist ungültig");
});

test("ausmisten-melden: ein Paket mit anderen Dateien als geplant setzt failure", async (context) => {
  const dateien = [DATEI, "src/post/zweite.js"];
  const basis = { dateien, erreicht: [DATEI], erreichtGate: [DATEI] };
  erwarteRot(
    await melde(context, { basis }),
    "Artefakt basis-0 hat andere Dateien gemessen als geplant",
  );
});

function zweitesPaket(master, branchMutanten) {
  const zweiter = { [ZWEITER_MUTANT]: "Killed" };
  const teil = (art, mutanten) =>
    alsText(
      artefaktDaten(art, master, {
        dateien: [ZWEITE_DATEI],
        mutanten,
        gate: {},
        erreicht: [ZWEITE_DATEI],
        erreichtGate: [],
        orte: { [ZWEITER_MUTANT]: ZEILEN_MUTANT },
      }),
    );
  return {
    plan: {
      pakete: [
        { mutanten: 2, dateien: [DATEI] },
        { mutanten: 1, dateien: [ZWEITE_DATEI] },
      ],
    },
    weitereBasis: [teil("basis", zweiter)],
    weitereBranch: [teil("branch", branchMutanten)],
  };
}

test("ausmisten-melden: zwei grüne Pakete ergeben zusammen grün", async (context) => {
  const zusatz = (master) => zweitesPaket(master, { [ZWEITER_MUTANT]: "Killed" });
  const ergebnis = await melde(context, { zusatz });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.match(ergebnis.gesetzt.description, /getötet Basis 3, Branch 3/);
});

test("ausmisten-melden: ein rotes Paket macht die Vereinigung rot", async (context) => {
  const zusatz = (master) => zweitesPaket(master, { [ZWEITER_MUTANT]: "Survived" });
  erwarteRot(
    await melde(context, { zusatz }),
    `Mutant auf dem Branch nicht mehr getötet: ${ZWEITER_MUTANT}`,
  );
});

test("ausmisten-melden: ein fehlendes Paket-Artefakt setzt failure", async (context) => {
  const zusatz = (master) => zweitesPaket(master, { [ZWEITER_MUTANT]: "Killed" });
  const liste = (eintraege) => eintraege.filter(({ name }) => name !== "basis-1");
  erwarteRot(await melde(context, { zusatz, liste }), "Artefakt basis-1 fehlt");
});

test("ausmisten-melden: ein nicht geplantes Zusatz-Paket setzt failure", async (context) => {
  const liste = (eintraege) => [...eintraege, { name: "branch-1", text: "{}" }];
  erwarteRot(await melde(context, { liste }), "Artefakt branch-1 ist nicht geplant");
});

test("ausmisten-melden: ein doppelt hochgeladenes Artefakt setzt failure", async (context) => {
  const liste = (eintraege) => [...eintraege, eintraege.find(({ name }) => name === "basis-0")];
  erwarteRot(await melde(context, { liste }), "Artefakt basis-0 gibt es 2-mal");
});

test("ausmisten-melden: ein nicht erfolgreiches Branch-Paket setzt failure", async (context) => {
  erwarteRot(
    await melde(context, { ergebnisse: { branch: "failure" } }),
    "Job branch endete mit failure",
  );
});

test("ausmisten-melden: eine Paketliste, die nicht zum Plan passt, setzt failure", async (context) => {
  const plan = {
    pakete: [
      { mutanten: 1, dateien: [DATEI] },
      { mutanten: 1, dateien: [ZWEITE_DATEI] },
    ],
  };
  erwarteRot(await melde(context, { plan }), "Plan und Paketliste passen nicht zusammen");
});

test("ausmisten-melden: ein Mutant, den die Basis nicht gemessen hat, setzt failure", async (context) => {
  const fremd = `${DATEI}:9:1-9:2 BooleanLiteral → false`;
  const branch = { mutanten: { [MUTANT]: "Killed", [BLOCK]: "Killed", [fremd]: "Killed" } };
  erwarteRot(await melde(context, { branch }), `den die Basis nicht gemessen hat: ${fremd}`);
});

test("ausmisten-melden: eine Basis ohne Orte der getöteten Mutanten setzt failure", async (context) => {
  erwarteRot(await melde(context, { basis: { orte: {} } }), "Orte der getöteten Mutanten fehlen");
});

test("ausmisten-melden: eine Basis mit ungültiger Liste geänderter Tests setzt failure", async (context) => {
  const basis = { tests: { alt: ["src/post/eingang.js"], neu: [] } };
  erwarteRot(await melde(context, { basis }), "Liste der geänderten Testdateien ist ungültig");
});

test("ausmisten-melden: rot mit offenem PR schaltet Auto-Merge ab und startet den Testschutz neu", async (context) => {
  const branch = { mutanten: { [MUTANT]: "Survived", [BLOCK]: "Killed" } };
  const offenePrs = [{ number: PR_NUMMER, head: { ref: BRANCH, sha: KOPF } }];
  const ergebnis = await melde(context, { pr: true, branch, offenePrs });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  erwarteNeustartMit(ergebnis, ["--disable-auto"]);
});

test("ausmisten-melden: ein Plan für einen anderen Kopf setzt failure", async (context) => {
  erwarteRot(await melde(context, { plan: { kopf: ANDERE_SHA } }), "Plan: Kopf-SHA passt nicht");
});

test("ausmisten-melden: ein Plan mit einer Datei in zwei Paketen setzt failure", async (context) => {
  const zusatz = (master) => ({
    ...zweitesPaket(master, { [ZWEITER_MUTANT]: "Killed" }),
    plan: {
      pakete: [
        { mutanten: 2, dateien: [DATEI] },
        { mutanten: 1, dateien: [DATEI] },
      ],
    },
  });
  erwarteRot(await melde(context, { zusatz }), "Plan: eine Datei steht in mehreren Paketen");
});

test("ausmisten-melden: ein Plan mit Issue-Nummer schreibt Closes in den PR", async (context) => {
  const ergebnis = await melde(context, { pr: true, plan: { issue: ISSUE_NUMMER } });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  const pr = ergebnis.anfragen.find(
    ({ methode, pfad }) => methode === "POST" && pfad.endsWith("/pulls"),
  );
  assert.match(pr.rumpf.body, new RegExp(`^Closes #${ISSUE_NUMMER}$`, "m"));
});

test("ausmisten-melden: ohne Issue-Nummer schreibt der PR kein Closes, aber einen Hinweis", async (context) => {
  const ergebnis = await melde(context, { pr: true });
  const pr = ergebnis.anfragen.find(
    ({ methode, pfad }) => methode === "POST" && pfad.endsWith("/pulls"),
  );
  assert.doesNotMatch(pr.rumpf.body, /Closes/);
  assert.match(pr.rumpf.body, /dieser PR schließt kein Issue/);
});

test("ausmisten-melden: ein Plan mit ungültiger Issue-Nummer setzt failure", async (context) => {
  erwarteRot(
    await melde(context, { plan: { issue: "12; rm" } }),
    "Plan: Issue-Nummer ist ungültig",
  );
});
