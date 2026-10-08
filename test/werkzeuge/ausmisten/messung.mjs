import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ereignisDatei } from "../pruefer/hilfen.mjs";
import { probeDirectory } from "../probe-repo.js";
import {
  DOPPELT,
  EINGANG_ID,
  RECHNEN_TEST,
  REPOSITORY,
  artefaktRouten,
  ausmistenRepo,
  eingangsLauf,
  scheinApi,
  starte,
} from "./hilfen.mjs";

const WERKZEUG = "tools/tests-ausmisten.mjs";
export const EXIT_GRUEN = 0;
export const EXIT_ROT = 1;
const LAUF_ID = "4711";
const AUTOR = [
  "-c",
  "user.name=Probe",
  "-c",
  "user.email=probe@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

export function testDatei(importPfad, name, pruefung) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import * as modul from ${JSON.stringify(importPfad)};`,
    "",
    `test(${JSON.stringify(name)}, () => {`,
    `  ${pruefung}`,
    "});",
    "",
  ].join("\n");
}

export const WIRKSAME_TESTS = {
  "test/post/eingang.test.js": testDatei(
    "../../src/post/eingang.js",
    "kürzt den Eingang",
    'assert.equal(modul.eingang("  a  "), "a");',
  ),
  [DOPPELT]: testDatei(
    "../../src/post/eingang.js",
    "kürzt den Eingang noch einmal",
    'assert.equal(modul.eingang("  a  "), "a");',
  ),
  [RECHNEN_TEST]: testDatei(
    "../hilfe/rechnen.js",
    "verdoppelt",
    "assert.equal(modul.doppelt(3), 6);",
  ),
};

export function ausgaben(datei) {
  const zeilen = readFileSync(datei, "utf8").split("\n").filter(Boolean);
  return Object.fromEntries(
    zeilen.map((zeile) => [
      zeile.slice(0, zeile.indexOf("=")),
      zeile.slice(zeile.indexOf("=") + 1),
    ]),
  );
}

export function bieteAn(routen, artefakte, alleNamen) {
  const namen = alleNamen.filter((name) => existsSync(join(artefakte, name, `${name}.json`)));
  const eintraege = namen.map((name) => ({
    name,
    text: readFileSync(join(artefakte, name, `${name}.json`), "utf8"),
  }));
  for (const [route, antwort] of artefaktRouten(LAUF_ID, eintraege)) routen.set(route, antwort);
}

export async function laufe(werkzeug, { repo, umgebung }) {
  const ergebnis = await starte(WERKZEUG, {
    args: werkzeug.args,
    cwd: repo.ordner,
    umgebung: { ...umgebung, ...werkzeug.umgebung },
  });
  repo.git(["reset", "-q", "--hard"]);
  return ergebnis;
}

export async function plane(context, branch, dateien = {}) {
  const repo = ausmistenRepo(context, { ...WIRKSAME_TESTS, ...dateien });
  repo.committe(branch.neu ?? {}, branch.weg);
  if (branch.nachricht) repo.git([...AUTOR, "commit", "-q", "--amend", "-m", branch.nachricht]);
  const kopf = repo.git(["rev-parse", "HEAD"]).stdout.trim();
  repo.git(["checkout", "-q", repo.master]);
  const artefakte = probeDirectory(context, { "planen.txt": "" });
  const routen = new Map([
    [`GET /repos/${REPOSITORY}/actions/workflows/ausmisten-eingang.yml`, { id: EINGANG_ID }],
    [`POST /repos/${REPOSITORY}/statuses/${kopf}`, {}],
  ]);
  const github = await scheinApi(context, routen);
  const umgebung = {
    NODE_ENV: "test",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_EVENT_PATH: ereignisDatei(context, eingangsLauf(kopf)),
    GITHUB_API_URL: github.url,
    GITHUB_TOKEN: "actions-token",
    GITHUB_RUN_ID: LAUF_ID,
  };
  const stand = { repo, umgebung, artefakte, routen, github, kopf };
  const planen = await laufe(
    {
      args: ["planen", "--aus", join(artefakte, "plan")],
      umgebung: { GITHUB_OUTPUT: join(artefakte, "planen.txt") },
    },
    stand,
  );
  return { ...stand, planen, plan: ausgaben(join(artefakte, "planen.txt")) };
}

export async function messePaket(stand, { art, paket, zusatz }) {
  const { artefakte, plan } = stand;
  const name = `${art}-${paket}`;
  const args = [
    art,
    "--plan-daten",
    artefakte,
    "--paket",
    String(paket),
    "--aus",
    join(artefakte, name),
  ];
  const umgebung = {
    PLAN_PRUEFSUMME: plan.pruefsumme,
    GITHUB_OUTPUT: join(artefakte, `${name}.txt`),
    ...zusatz,
  };
  return laufe(
    { args: art === "branch" ? [...args, "--basis-daten", artefakte] : args, umgebung },
    stand,
  );
}

const ERSTE_JOB_ID = 700;
const JOBS_JE_PAKET = 2;
const ZEITSTEMPEL = "2026-10-08T10:00:00.0000000Z";

function alsProtokoll(ausgabe) {
  return Buffer.from(
    ausgabe
      .split("\n")
      .map((zeile) => `${ZEITSTEMPEL} ${zeile}`)
      .join("\n"),
  );
}

function ergebnisVon(lauf) {
  if (lauf === undefined) return "cancelled";
  return lauf.status === EXIT_GRUEN ? "success" : "failure";
}

export function bieteJobsAn(routen, ketten) {
  const jobs = ketten.flatMap(({ basis, zweig }, paket) => [
    {
      id: ERSTE_JOB_ID + JOBS_JE_PAKET * paket,
      name: `Paket ${paket} / Basis messen`,
      lauf: basis,
    },
    {
      id: ERSTE_JOB_ID + JOBS_JE_PAKET * paket + 1,
      name: `Paket ${paket} / Branch messen`,
      lauf: zweig,
    },
  ]);
  routen.set(`GET /repos/${REPOSITORY}/actions/runs/${LAUF_ID}/jobs`, {
    total_count: jobs.length,
    jobs: jobs.map(({ id, name, lauf }) => ({
      id,
      name,
      status: "completed",
      conclusion: ergebnisVon(lauf),
    })),
  });
  for (const { id, lauf } of jobs)
    routen.set(
      `GET /repos/${REPOSITORY}/actions/jobs/${id}/logs`,
      alsProtokoll(lauf?.ausgabe ?? ""),
    );
}

function pruefsummeDer(artefakte, name) {
  const datei = join(artefakte, `${name}.txt`);
  return existsSync(datei) ? (ausgaben(datei).pruefsumme ?? "") : "";
}

async function messeKette(stand, paket) {
  const basis = await messePaket(stand, { art: "basis", paket });
  if (basis.status !== EXIT_GRUEN) return { basis };
  stand.vorBranch?.(stand.artefakte);
  const zusatz = { BASIS_PRUEFSUMME: pruefsummeDer(stand.artefakte, `basis-${paket}`) };
  return { basis, zweig: await messePaket(stand, { art: "branch", paket, zusatz }) };
}

export async function messeUndMelde(context, branch, { dateien = {}, vorBranch, vorMelden } = {}) {
  const stand = { ...(await plane(context, branch, dateien)), vorBranch };
  const { artefakte, plan, routen } = stand;
  const pakete = JSON.parse(plan.pakete);
  const ketten = [];
  for (const paket of pakete) {
    const kette = await messeKette(stand, paket);
    ketten.push(kette);
    if (kette.zweig?.status !== EXIT_GRUEN) break;
  }
  const namen = pakete.flatMap((paket) => [`basis-${paket}`, `branch-${paket}`]);
  vorMelden?.(artefakte);
  bieteAn(routen, artefakte, ["plan", ...namen]);
  bieteJobsAn(routen, ketten);
  const gruen =
    ketten.length === pakete.length && ketten.every(({ zweig }) => zweig?.status === EXIT_GRUEN);
  const jobs = {
    planen: { result: ergebnisVon(stand.planen), outputs: plan },
    vorpruefen: { result: "success", outputs: {} },
    kette: { result: gruen ? "success" : "failure", outputs: {} },
  };
  const melden = await laufe(
    { args: ["melden"], umgebung: { JOB_ERGEBNISSE: JSON.stringify(jobs) } },
    stand,
  );
  const gelesen = JSON.parse(readFileSync(join(artefakte, "basis-0", "basis-0.json"), "utf8"));
  const { anfragen } = stand.github;
  const status = anfragen.find(({ methode }) => methode === "POST")?.rumpf;
  const [erste] = ketten;
  return {
    basis: erste.basis,
    zweig: erste.zweig,
    melden,
    gelesen,
    status,
    artefakte,
    ketten,
    stand,
  };
}
