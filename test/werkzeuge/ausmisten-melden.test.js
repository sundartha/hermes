import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
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
const ZEITSTEMPEL = "2026-10-08T10:00:00.0000000Z";
const ERSTE_JOB_ID = 800;
const JOBS_JE_PAKET = 2;
const LAUF_ADRESSE = `https://github.com/${REPOSITORY}/actions/runs/${LAUF_ID}`;
const OHNE_PAKETE = ["--import", fileURLToPath(new URL("ausmisten/ohne-pakete.mjs", import.meta.url))];

function starteWieImJob(args, cwd, umgebung) {
  return starte(WERKZEUG, { args, cwd, umgebung, vorab: OHNE_PAKETE });
}

function artefaktDaten(name, master, felder = {}) {
  const gemeinsam = {
    format: 3,
    art: name,
    kopf: KOPF,
    master,
    bereich: "posteingang",
    dateien: [DATEI],
    mutanten: { [MUTANT]: "Killed", [BLOCK]: "Killed" },
    gate: { [MUTANT]: "Killed" },
    trockenlauf: { sekunden: 2, exit: 0 },
    ausgenommen: [],
  };
  const basis = {
    erreicht: [DATEI],
    erreichtGate: [DATEI],
    testzeilen: { vorher: 40, nachher: 32 },
    tests: { alt: [ALTER_TEST], neu: [] },
    orte: { [MUTANT]: ZEILEN_MUTANT, [BLOCK]: ZEILEN_BLOCK },
    schluessel: "a".repeat(SHA256_ZEICHEN),
    wiederverwendet: null,
  };
  const daten = { ...gemeinsam, ...(name === "basis" ? basis : {}), ...felder };
  if (name === "branch" && !Object.hasOwn(felder, "gemessen")) daten.gemessen = daten.dateien;
  return daten;
}

function alsText(daten) {
  return typeof daten === "string" ? daten : `${JSON.stringify(daten, null, EINRUECKUNG)}\n`;
}

function summe(text) {
  return createHash("sha256").update(text).digest("hex");
}

function planDaten(master, felder = {}) {
  const daten = {
    format: 3,
    art: "plan",
    kopf: KOPF,
    master,
    bereich: "posteingang",
    dateien: [DATEI],
    tests: { alt: [ALTER_TEST], neu: [] },
    issue: null,
    pakete: [{ mutanten: 2, dateien: [DATEI] }],
    unterdrueckungen: [],
    ...felder,
  };
  if (!Object.hasOwn(felder, "frueher")) daten.frueher = daten.pakete.map(() => null);
  return daten;
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

function jobs({ pakete, pruefsumme }, ergebnisse = {}) {
  const ergebnis = (name) => ergebnisse[name] ?? "success";
  return JSON.stringify({
    planen: { result: ergebnis("planen"), outputs: { pakete, pruefsumme } },
    vorpruefen: { result: ergebnis("vorpruefen"), outputs: {} },
    kette: { result: ergebnis("kette"), outputs: {} },
  });
}

function protokoll(zeilen) {
  return Buffer.from(zeilen.map((zeile) => `${ZEITSTEMPEL} ${zeile}\n`).join(""));
}

function jobRouten({ pakete, summen }, fall) {
  const nummern = JSON.parse(pakete);
  const festgehalten = JSON.parse(summen ?? "[]");
  const routen = new Map();
  const liste = nummern.flatMap((nummer) =>
    ["Basis messen", "Branch messen"].map((teil, index) => ({
      id: ERSTE_JOB_ID + JOBS_JE_PAKET * nummer + index,
      name: `Paket ${nummer} / ${teil}`,
      status: "completed",
      conclusion: fall.jobErgebnisse?.[`Paket ${nummer} / ${teil}`] ?? "success",
    })),
  );
  routen.set(`GET /repos/${REPOSITORY}/actions/runs/${LAUF_ID}/jobs`, {
    total_count: liste.length,
    jobs: fall.jobListe?.(liste) ?? liste,
  });
  for (const { id, name } of liste) {
    const nummer = Number(name.split(" ")[1]);
    const basis = name.endsWith("Basis messen");
    const zeilen =
      basis && festgehalten[nummer] !== undefined
        ? [`Basis-Prüfsumme basis-${nummer}: ${festgehalten[nummer]}`]
        : [];
    const ersatz = fall.protokolle?.[name];
    routen.set(
      `GET /repos/${REPOSITORY}/actions/jobs/${id}/logs`,
      protokoll(ersatz ?? ["Start", ...zeilen, "Ende"]),
    );
  }
  return routen;
}

async function melde(context, angabe = {}) {
  const repo = ausmistenRepo(context);
  const fall = { ...angabe, ...angabe.zusatz?.(repo.master) };
  const { eintraege, ausgaben } = artefaktListe(repo.master, fall);
  const routen = new Map([
    ...artefaktRouten(LAUF_ID, eintraege),
    ...jobRouten(ausgaben, fall),
    [`GET /repos/${REPOSITORY}/actions/workflows/ausmisten-eingang.yml`, { id: EINGANG_ID }],
    [`POST /repos/${REPOSITORY}/statuses/${KOPF}`, {}],
    [`GET /repos/${REPOSITORY}/pulls`, fall.offenePrs ?? []],
    [`POST /repos/${REPOSITORY}/pulls`, { number: PR_NUMMER }],
    [`PATCH /repos/${REPOSITORY}/pulls/${PR_NUMMER}`, { number: PR_NUMMER }],
    ...(fall.routen ?? []),
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
  const ergebnis = await starteWieImJob(args, repo.ordner, umgebung);
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

test("ausmisten-melden: ohne installierte Pakete bricht ein Befehl ab, der ein Fremdpaket lädt", async (context) => {
  const repo = ausmistenRepo(context);
  const ergebnis = await starteWieImJob(["planen", "--aus", "plan"], repo.ordner, {});
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Abbruch: Fremdpaket \S+ geladen von /);
});

test("ausmisten-melden: ein fehlendes Artefakt setzt failure", async (context) => {
  const liste = (eintraege) => eintraege.filter(({ name }) => name !== "branch-0");
  erwarteRot(await melde(context, { liste }), "Artefakt branch-0 fehlt");
});

test("ausmisten-melden: ein nicht erfolgreicher Mess-Job setzt failure", async (context) => {
  const ergebnis = await melde(context, {
    ergebnisse: { kette: "cancelled" },
    jobErgebnisse: { "Paket 0 / Basis messen": "cancelled" },
  });
  erwarteRot(ergebnis, "Job „Paket 0 / Basis messen“ endete mit cancelled");
  assert.match(ergebnis.ausgabe, /Job kette endete mit cancelled/);
});

test("ausmisten-melden: rote Prüfungen vor der Messung setzen failure, auch ohne Mess-Artefakte", async (context) => {
  const liste = (eintraege) => eintraege.filter(({ name }) => name === "plan");
  const ergebnis = await melde(context, {
    liste,
    ergebnisse: { vorpruefen: "failure", kette: "skipped" },
  });
  erwarteRot(ergebnis, "Job vorpruefen endete mit failure");
  assert.match(ergebnis.ausgabe, /Job kette endete mit skipped/);
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
  const pr = geoeffneterPr(ergebnis);
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
    await melde(context, { branch: { dateien: ["docs/x.mjs"] } }),
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
  erwarteRot(
    ergebnis,
    "Das Protokoll von „Paket 0 / Basis messen“ nennt die Prüfsumme nicht genau einmal",
  );
  assert.match(ergebnis.ausgabe, /Für basis-0 fehlt die Prüfsumme/);
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
    await melde(context, {
      ergebnisse: { kette: "failure" },
      jobErgebnisse: { "Paket 0 / Branch messen": "failure" },
    }),
    "Job „Paket 0 / Branch messen“ endete mit failure",
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
  const pr = geoeffneterPr(ergebnis);
  assert.match(pr.rumpf.body, new RegExp(`^Closes #${ISSUE_NUMMER}$`, "m"));
});

test("ausmisten-melden: ohne Issue-Nummer schreibt der PR kein Closes, aber einen Hinweis", async (context) => {
  const ergebnis = await melde(context, { pr: true });
  const pr = geoeffneterPr(ergebnis);
  assert.doesNotMatch(pr.rumpf.body, /Closes/);
  assert.match(pr.rumpf.body, /dieser PR schließt kein Issue/);
});

test("ausmisten-melden: ein Plan mit ungültiger Issue-Nummer setzt failure", async (context) => {
  erwarteRot(
    await melde(context, { plan: { issue: "12; rm" } }),
    "Plan: Issue-Nummer ist ungültig",
  );
});

test("ausmisten-melden: ein abgebrochenes Branch-Paket nennt den verlorenen Mutanten und die nicht gemessene Datei", async (context) => {
  const dateien = [DATEI, ZWEITE_DATEI];
  const zusatz = () => ({
    plan: { pakete: [{ mutanten: 3, dateien }] },
    basis: {
      dateien,
      mutanten: { [MUTANT]: "Killed", [ZWEITER_MUTANT]: "Killed" },
      gate: {},
      erreicht: dateien,
      erreichtGate: [],
      orte: { [MUTANT]: ZEILEN_MUTANT, [ZWEITER_MUTANT]: ZEILEN_MUTANT },
    },
    branch: { dateien, gemessen: [DATEI], mutanten: { [MUTANT]: "Survived" }, gate: {} },
  });
  const ergebnis = await melde(context, {
    zusatz,
    ergebnisse: { kette: "failure" },
    jobErgebnisse: { "Paket 0 / Branch messen": "failure" },
  });
  erwarteRot(ergebnis, `Mutant auf dem Branch nicht mehr getötet: ${MUTANT}`);
  assert.match(ergebnis.ausgabe, /Job „Paket 0 \/ Branch messen“ endete mit failure/);
  assert.match(
    ergebnis.ausgabe,
    /Paket 0 nach dem ersten Verstoß abgebrochen, nicht gemessen: src\/post\/zweite\.js/,
  );
  assert.doesNotMatch(ergebnis.ausgabe, new RegExp(`nicht mehr getötet: ${ZWEITE_DATEI}`));
});

test("ausmisten-melden: ein Branch-Artefakt, das nicht alle Dateien gemessen hat, ist auch bei grünen Jobs rot", async (context) => {
  const ergebnis = await melde(context, { branch: { gemessen: [] } });
  erwarteRot(
    ergebnis,
    "Paket 0 nach dem ersten Verstoß abgebrochen, nicht gemessen: src/post/eingang.js",
  );
});

test("ausmisten-melden: ein Branch-Artefakt mit gemessenen Dateien außerhalb des Pakets setzt failure", async (context) => {
  const ergebnis = await melde(context, { branch: { gemessen: [ZWEITE_DATEI] } });
  erwarteRot(ergebnis, "Liste der gemessenen Dateien ist ungültig");
});

test("ausmisten-melden: ein Basis-Artefakt eines fehlgeschlagenen Basis-Jobs wird nicht geglaubt", async (context) => {
  const ergebnis = await melde(context, {
    jobErgebnisse: { "Paket 0 / Basis messen": "failure" },
  });
  erwarteRot(ergebnis, "Job „Paket 0 / Basis messen“ endete mit failure");
  assert.match(ergebnis.ausgabe, /Für basis-0 fehlt die Prüfsumme/);
});

test("ausmisten-melden: zwei Prüfsummen-Zeilen im Protokoll der Basis machen sie unglaubwürdig", async (context) => {
  const ergebnis = await melde(context, {
    zusatz: () => ({
      protokolle: {
        "Paket 0 / Basis messen": [
          `Basis-Prüfsumme basis-0: ${ANDERE_SUMME}`,
          `Basis-Prüfsumme basis-0: ${ANDERE_SUMME}`,
        ],
      },
    }),
  });
  erwarteRot(ergebnis, "nennt die Prüfsumme nicht genau einmal");
});

test("ausmisten-melden: eine Prüfsummen-Zeile im Protokoll des Branch-Jobs zählt nicht", async (context) => {
  const ergebnis = await melde(context, {
    ausgaben: { summen: undefined },
    zusatz: (master) => {
      const text = alsText(artefaktDaten("basis", master));
      return {
        protokolle: { "Paket 0 / Branch messen": [`Basis-Prüfsumme basis-0: ${summe(text)}`] },
      };
    },
  });
  erwarteRot(
    ergebnis,
    "Das Protokoll von „Paket 0 / Basis messen“ nennt die Prüfsumme nicht genau einmal",
  );
});

test("ausmisten-melden: ein fehlender Basis-Job setzt failure", async (context) => {
  const jobListe = (liste) => liste.filter(({ name }) => name !== "Paket 0 / Basis messen");
  erwarteRot(await melde(context, { jobListe }), "Job „Paket 0 / Basis messen“ gibt es 0-mal");
});

test("ausmisten-melden: eine wiederverwendete Basis steht mit Lauf und Artefakt im PR-Text", async (context) => {
  const basis = { wiederverwendet: { lauf: "4700", artefakt: "basis-0" } };
  const ergebnis = await melde(context, { pr: true, basis });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  const pr = geoeffneterPr(ergebnis);
  assert.match(pr.rumpf.body, /Basis wiederverwendet .*: Paket 0 aus Lauf 4700 \(basis-0\)/);
});

test("ausmisten-melden: ein Plan mit ungültigen Angaben zu früheren Basis-Ergebnissen setzt failure", async (context) => {
  const plan = { frueher: [{ schluessel: "kurz", lauf: "1", artefakt: "basis-0" }] };
  erwarteRot(
    await melde(context, { plan }),
    "Plan: Angaben zu früheren Basis-Ergebnissen sind ungültig",
  );
});

test("ausmisten-melden: eine Basis ohne Schlüssel des Zwischenspeichers setzt failure", async (context) => {
  erwarteRot(
    await melde(context, { basis: { schluessel: undefined } }),
    "Schlüssel des Zwischenspeichers fehlt",
  );
});

const ANTONIO = "Antonio20045";
const SENKUNG = { datei: ALTER_TEST, regel: "id-length", vorher: 40, nachher: 38 };
const SENKUNG_PUNKT = `Unterdrückung in eslint-suppressions.json gesenkt: ${ALTER_TEST} id-length 40 → 38`;

function freigabeFall({ reviews, offen = true, ...weiteres } = {}) {
  const offenePrs = offen ? [{ number: PR_NUMMER, head: { ref: BRANCH, sha: KOPF } }] : [];
  return {
    plan: { unterdrueckungen: [SENKUNG] },
    offenePrs,
    routen: [[`GET /repos/${REPOSITORY}/pulls/${PR_NUMMER}/reviews`, reviews ?? []]],
    ...weiteres,
  };
}

function neuerPrText({ anfragen }) {
  const { rumpf } = anfragen.find(({ methode }) => methode === "PATCH");
  return rumpf.body;
}

function geoeffneterPr({ anfragen }) {
  return anfragen.find(({ methode, pfad }) => methode === "POST" && pfad.endsWith("/pulls"));
}

function geoeffneterPrText(ergebnis) {
  return geoeffneterPr(ergebnis).rumpf.body;
}

function review(login, state, commitId = KOPF) {
  return { user: { login }, state, commit_id: commitId };
}

function erwarteFreigabeNoetig(ergebnis, punkt = SENKUNG_PUNKT) {
  erwarteRot(ergebnis, `Freigabe nötig: ${punkt}`);
  assert.match(ergebnis.gesetzt.description, /Freigabe von Antonio20045 nötig: 1 Punkte/);
}

test("ausmisten-melden: eine gesenkte Unterdrückung ohne Freigabe setzt failure", async (context) => {
  erwarteFreigabeNoetig(await melde(context, freigabeFall()));
});

test("ausmisten-melden: ein Freigabepunkt öffnet den PR ohne Auto-Merge und nennt ihn unter eigener Überschrift", async (context) => {
  const ergebnis = await melde(context, freigabeFall({ pr: true, offen: false }));
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.ok(
    geoeffneterPrText(ergebnis).includes(
      `## Freigabe durch Antonio20045 nötig\n\n- ${SENKUNG_PUNKT}`,
    ),
  );
  assert.deepEqual(ergebnis.gh.aufrufe(), []);
  assert.match(ergebnis.ausgabe, /ohne Auto-Merge: Freigabe von Antonio20045 nötig/);
});

test("ausmisten-melden: ein offener PR mit Freigabepunkt verliert Auto-Merge und bekommt den neuen Text", async (context) => {
  const ergebnis = await melde(context, freigabeFall({ pr: true }));
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  erwarteNeustartMit(ergebnis, ["--disable-auto"]);
  assert.match(
    neuerPrText(ergebnis),
    /Auto-Merge bleibt aus, bis Antonio20045 diesen PR auf dem Stand/,
  );
});

test("ausmisten-melden: die Zustimmung eines anderen Kontos gibt nichts frei", async (context) => {
  for (const login of ["jonas986", "sundartha-bot"])
    erwarteFreigabeNoetig(
      await melde(context, freigabeFall({ reviews: [review(login, "APPROVED")] })),
    );
});

test("ausmisten-melden: Antonios Zustimmung auf einem alten Stand gibt nichts frei", async (context) => {
  const reviews = [review(ANTONIO, "APPROVED", ANDERE_SHA)];
  erwarteFreigabeNoetig(await melde(context, freigabeFall({ reviews })));
});

test("ausmisten-melden: eine spätere Bitte um Änderungen hebt Antonios Zustimmung auf", async (context) => {
  const reviews = [review(ANTONIO, "APPROVED"), review(ANTONIO, "CHANGES_REQUESTED")];
  erwarteFreigabeNoetig(await melde(context, freigabeFall({ reviews })));
});

test("ausmisten-melden: Antonios Zustimmung auf dem gemessenen Stand gibt frei und schaltet Auto-Merge ein", async (context) => {
  const reviews = [review(ANTONIO, "APPROVED"), review(ANTONIO, "COMMENTED")];
  const status = await melde(context, freigabeFall({ reviews }));
  assert.equal(status.status, EXIT_GRUEN, status.ausgabe);
  assert.equal(status.gesetzt.state, "success");
  const ergebnis = await melde(context, freigabeFall({ reviews, pr: true }));
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  erwarteNeustartMit(ergebnis, ["--auto", "--rebase"]);
  assert.match(
    neuerPrText(ergebnis),
    new RegExp(`Freigegeben von Antonio20045 auf dem Stand ${KOPF}`),
  );
});

test("ausmisten-melden: ein verlorener Mutant bleibt neben einem Freigabepunkt rot, auch mit Freigabe", async (context) => {
  const reviews = [review(ANTONIO, "APPROVED")];
  const branch = { mutanten: { [MUTANT]: "Survived", [BLOCK]: "Killed" } };
  const ergebnis = await melde(context, freigabeFall({ reviews, branch }));
  erwarteRot(ergebnis, `Mutant auf dem Branch nicht mehr getötet: ${MUTANT}`);
  assert.doesNotMatch(ergebnis.ausgabe, /Freigegeben von/);
});

test("ausmisten-melden: eine ungültige Liste gesenkter Unterdrückungen setzt failure", async (context) => {
  const unterdrueckungen = [{ ...SENKUNG, nachher: 41 }];
  erwarteRot(
    await melde(context, { plan: { unterdrueckungen } }),
    "Liste der gesenkten Unterdrückungen ist ungültig",
  );
});

const AUSGENOMMEN = "liest den Quelltext";

const UNVERAENDERT_AUSGENOMMEN = "liest den Quelltext noch einmal";
const VERAENDERTE_AUSNAHMEN = "## Ausgenommene Testfälle, im Branch gelöscht oder geändert";

function ausgenommenerFall(imBranch, { name = AUSGENOMMEN, datei = DATEI } = {}) {
  return { datei, test: ALTER_TEST, name, imBranch };
}

function mitAusnahmen(ausgenommen, weiteres = {}) {
  return freigabeFall({
    plan: { unterdrueckungen: [] },
    basis: { ausgenommen },
    ...weiteres,
  });
}

function mitAusnahme(imBranch, weiteres = {}) {
  return mitAusnahmen([ausgenommenerFall(imBranch)], weiteres);
}

function ausnahmeZeile(stand) {
  return `- Ausgenommener Testfall im Branch ${stand}: ${ALTER_TEST}: ${AUSGENOMMEN}`;
}

function ausnahmeImLog(stand) {
  return `Ausgenommen: ${ALTER_TEST}: ${AUSGENOMMEN} (umgebaute Datei ${DATEI}, im Branch ${stand})`;
}

function veraenderteAusnahmen(text) {
  const anfang = text.indexOf(VERAENDERTE_AUSNAHMEN);
  assert.notEqual(anfang, -1, text);
  const ende = text.indexOf("\n## ", anfang + VERAENDERTE_AUSNAHMEN.length);
  return text.slice(anfang, ende === -1 ? undefined : ende + 1);
}

test("ausmisten-melden: ein gelöschter ausgenommener Fall öffnet den PR mit Auto-Merge und steht unter eigener Überschrift", async (context) => {
  const ausgenommen = [
    ausgenommenerFall("gelöscht"),
    ausgenommenerFall("unverändert", { name: UNVERAENDERT_AUSGENOMMEN }),
  ];
  const ergebnis = await melde(context, mitAusnahmen(ausgenommen, { pr: true, offen: false }));
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
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
  assert.ok(ergebnis.ausgabe.includes(ausnahmeImLog("gelöscht")), ergebnis.ausgabe);
  const text = geoeffneterPrText(ergebnis);
  assert.equal(
    veraenderteAusnahmen(text),
    `${VERAENDERTE_AUSNAHMEN}\n\n${ausnahmeZeile("gelöscht")}\n\n`,
  );
  assert.ok(text.includes(`${ausnahmeZeile("gelöscht")}\n\n## Ausgenommene Testfälle\n`), text);
  assert.doesNotMatch(text, /Freigabe/);
  assert.doesNotMatch(ergebnis.ausgabe, /Freigabe/);
});

test("ausmisten-melden: ein geänderter ausgenommener Fall setzt success ohne Freigabe", async (context) => {
  const ergebnis = await melde(context, mitAusnahme("geändert"));
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.equal(ergebnis.gesetzt.state, "success");
  assert.ok(ergebnis.ausgabe.includes(ausnahmeImLog("geändert")), ergebnis.ausgabe);
  assert.doesNotMatch(ergebnis.ausgabe, /Freigabe/);
});

test("ausmisten-melden: eine gesenkte Unterdrückung braucht neben einem gelöschten ausgenommenen Fall weiter die Freigabe", async (context) => {
  const ergebnis = await melde(
    context,
    mitAusnahme("gelöscht", { plan: { unterdrueckungen: [SENKUNG] } }),
  );
  erwarteFreigabeNoetig(ergebnis);
  assert.doesNotMatch(ergebnis.ausgabe, /Freigabe nötig: Ausgenommener Testfall/);
});

test("ausmisten-melden: ein für zwei umgebaute Dateien ausgenommener gelöschter Fall steht nur einmal unter der eigenen Überschrift", async (context) => {
  const dateien = [DATEI, ZWEITE_DATEI];
  const ausgenommen = [
    ausgenommenerFall("gelöscht"),
    ausgenommenerFall("gelöscht", { datei: ZWEITE_DATEI }),
  ];
  const ergebnis = await melde(
    context,
    mitAusnahmen(ausgenommen, {
      pr: true,
      offen: false,
      plan: { unterdrueckungen: [], dateien, pakete: [{ mutanten: 2, dateien }] },
      basis: { ausgenommen, dateien },
      branch: { dateien },
    }),
  );
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.equal(
    veraenderteAusnahmen(geoeffneterPrText(ergebnis)),
    `${VERAENDERTE_AUSNAHMEN}\n\n${ausnahmeZeile("gelöscht")}\n\n`,
  );
});

test("ausmisten-melden: ein ausgenommener Fall, den die Messung nicht zuordnen kann, macht das Artefakt ungültig", async (context) => {
  erwarteRot(
    await melde(context, mitAusnahme("nicht zuzuordnen")),
    "Liste der ausgenommenen Testfälle ist ungültig",
  );
});

test("ausmisten-melden: ein unveränderter ausgenommener Fall braucht keine Freigabe und steht im PR-Text", async (context) => {
  const ergebnis = await melde(context, mitAusnahme("unverändert", { pr: true, offen: false }));
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  const text = geoeffneterPrText(ergebnis);
  assert.ok(
    text.includes(
      "- `test/post/doppelt.test.js`: liest den Quelltext (umgebaute Datei `src/post/eingang.js`, im Branch unverändert)",
    ),
    text,
  );
  assert.match(text, /## Ausgenommene Testfälle/);
  assert.doesNotMatch(text, /im Branch gelöscht oder geändert/);
  assert.doesNotMatch(text, /Freigabe durch/);
});

test("ausmisten-melden: ein ausgenommener Fall ohne Angabe zum Branch macht das Artefakt ungültig", async (context) => {
  const basis = { ausgenommen: [{ datei: DATEI, test: ALTER_TEST, name: AUSGENOMMEN }] };
  erwarteRot(await melde(context, { basis }), "Liste der ausgenommenen Testfälle ist ungültig");
});
