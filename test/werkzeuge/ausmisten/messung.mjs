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
  const artefakte = probeDirectory(context, { "planen.txt": "", "sammeln.txt": "" });
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
  const stand = { repo, umgebung, artefakte, routen, github };
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

export async function messeUndMelde(context, branch, { dateien = {}, vorBranch } = {}) {
  const stand = { ...(await plane(context, branch, dateien)), vorBranch };
  const { artefakte, plan, routen } = stand;
  const pakete = JSON.parse(plan.pakete);
  const basisLaeufe = [];
  for (const paket of pakete) basisLaeufe.push(await messePaket(stand, { art: "basis", paket }));
  const basisNamen = pakete.map((paket) => `basis-${paket}`);
  bieteAn(routen, artefakte, ["plan", ...basisNamen]);
  const sammelUmgebung = {
    PAKETE: plan.pakete,
    PLAN_PRUEFSUMME: plan.pruefsumme,
    GITHUB_OUTPUT: join(artefakte, "sammeln.txt"),
  };
  const sammeln = await laufe({ args: ["sammeln"], umgebung: sammelUmgebung }, stand);
  const { summen } = ausgaben(join(artefakte, "sammeln.txt"));
  stand.vorBranch?.(artefakte);
  const zweige = [];
  for (const paket of pakete)
    zweige.push(
      await messePaket(stand, { art: "branch", paket, zusatz: { BASIS_SUMMEN: summen } }),
    );
  bieteAn(routen, artefakte, ["plan", ...basisNamen, ...pakete.map((paket) => `branch-${paket}`)]);
  const ergebnis = (liste) =>
    liste.every(({ status }) => status === EXIT_GRUEN) ? "success" : "failure";
  const jobs = {
    planen: { result: ergebnis([stand.planen]), outputs: plan },
    basis: { result: ergebnis(basisLaeufe), outputs: {} },
    sammeln: { result: ergebnis([sammeln]), outputs: { summen } },
    branch: { result: ergebnis(zweige), outputs: {} },
  };
  const melden = await laufe(
    { args: ["melden"], umgebung: { JOB_ERGEBNISSE: JSON.stringify(jobs) } },
    stand,
  );
  const gelesen = JSON.parse(readFileSync(join(artefakte, "basis-0", "basis-0.json"), "utf8"));
  const { anfragen } = stand.github;
  const status = anfragen.find(({ methode }) => methode === "POST")?.rumpf;
  return { basis: basisLaeufe[0], zweig: zweige[0], melden, gelesen, status, sammeln };
}
