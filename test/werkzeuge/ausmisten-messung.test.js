import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DOPPELT,
  EINGANG_ID,
  FREMDE_QUELLE,
  GATE_TEST,
  GRUNDDATEIEN,
  RECHNEN_HILFE,
  RECHNEN_TEST,
  REPOSITORY,
  artefaktRouten,
  ausmistenRepo,
  eingangsLauf,
  scheinApi,
  starte,
} from "./ausmisten/hilfen.mjs";
import { ereignisDatei } from "./pruefer/hilfen.mjs";
import { probeDirectory } from "./probe-repo.js";

const WERKZEUG = "tools/tests-ausmisten.mjs";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const LAUF_ID = "4711";
const ZEILEN_JE_GROSSER_QUELLE = 1600;
const GROSSE_QUELLEN_FUER_ZWEI_PAKETE = 2;
const ZU_VIELE_GROSSE_QUELLEN = 21;
const MAX_MUTANTEN_JE_PAKET = 3000;
const SHA256_ZEICHEN = 64;
const BERECHNET_TEST = "test/post/berechnet.test.js";

function testDatei(importPfad, name, pruefung) {
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

const WIRKSAME_TESTS = {
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

function ausgaben(datei) {
  const zeilen = readFileSync(datei, "utf8").split("\n").filter(Boolean);
  return Object.fromEntries(
    zeilen.map((zeile) => [
      zeile.slice(0, zeile.indexOf("=")),
      zeile.slice(zeile.indexOf("=") + 1),
    ]),
  );
}

function bieteAn(routen, artefakte, alleNamen) {
  const namen = alleNamen.filter((name) => existsSync(join(artefakte, name, `${name}.json`)));
  const eintraege = namen.map((name) => ({
    name,
    text: readFileSync(join(artefakte, name, `${name}.json`), "utf8"),
  }));
  for (const [route, antwort] of artefaktRouten(LAUF_ID, eintraege)) routen.set(route, antwort);
}

async function laufe(werkzeug, { repo, umgebung }) {
  const ergebnis = await starte(WERKZEUG, {
    args: werkzeug.args,
    cwd: repo.ordner,
    umgebung: { ...umgebung, ...werkzeug.umgebung },
  });
  repo.git(["reset", "-q", "--hard"]);
  return ergebnis;
}

async function plane(context, branch, dateien = {}) {
  const repo = ausmistenRepo(context, { ...WIRKSAME_TESTS, ...dateien });
  const kopf = repo.committe(branch.neu ?? {}, branch.weg);
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

async function messePaket(stand, { art, paket, zusatz }) {
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

async function messeUndMelde(context, branch, { dateien = {}, vorBranch } = {}) {
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

test("ausmisten-messung: ein Mutant, den der gelöschte Test tötet und ein unveränderter Test auch, bleibt grün", async (context) => {
  const ergebnis = await messeUndMelde(context, { weg: [DOPPELT] });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  assert.deepEqual(ergebnis.gelesen.tests, { alt: [DOPPELT], neu: [] });
  assert.ok(Object.values(ergebnis.gelesen.mutanten).includes("Killed"), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
  assert.equal(ergebnis.status.state, "success");
});

test("ausmisten-messung: ein Mutant, den nur der gelöschte Test tötet, macht den Lauf rot", async (context) => {
  const ergebnis = await messeUndMelde(context, { weg: [RECHNEN_TEST] });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.deepEqual(ergebnis.gelesen.dateien, [FREMDE_QUELLE, "src/post/eingang.js"]);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(
    ergebnis.melden.ausgabe,
    /Mutant auf dem Branch nicht mehr getötet: src\/fremd\/rechnen\.js:/,
  );
  assert.equal(ergebnis.status.state, "failure");
});

test("ausmisten-messung: eine geänderte Testhilfe bringt die Testdatei, die sie lädt, in die Messung", async (context) => {
  const neu = { [RECHNEN_HILFE]: `${GRUNDDATEIEN[RECHNEN_HILFE]}void process.env.HOME;\n` };
  const ergebnis = await messeUndMelde(context, { weg: [], neu });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.deepEqual(ergebnis.gelesen.tests, { alt: [RECHNEN_TEST], neu: [RECHNEN_TEST] });
  assert.ok(ergebnis.gelesen.dateien.includes(FREMDE_QUELLE));
  assert.ok(Object.values(ergebnis.gelesen.mutanten).includes("Killed"), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
});

test("ausmisten-messung: ein gelöschter Test, der eine src-Datei über einen berechneten Import lädt, wird rot", async (context) => {
  const berechnet = [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "",
    'test("verdoppelt über einen berechneten Import", async () => {',
    "  const stand = 1;",
    "  const { doppelt } = await import(`../../src/fremd/rechnen.js?stand=${stand}`);",
    "  assert.equal(doppelt(3), 6);",
    "});",
    "",
  ].join("\n");
  const dateien = { [BERECHNET_TEST]: berechnet, [RECHNEN_TEST]: GRUNDDATEIEN[RECHNEN_TEST] };
  const ergebnis = await messeUndMelde(context, { weg: [BERECHNET_TEST] }, { dateien });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.ok(ergebnis.gelesen.dateien.includes(FREMDE_QUELLE), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(
    ergebnis.melden.ausgabe,
    /Mutant auf dem Branch nicht mehr getötet: src\/fremd\/rechnen\.js:/,
  );
});

test("ausmisten-messung: ein geschwächter Gate-Test wird im Gate-Lauf rot, auch wenn ein anderer Test den Mutanten tötet", async (context) => {
  const pruefung =
    'assert.equal(modul.gesperrt("+900 1"), true);\n  assert.equal(modul.gesperrt("+49 1"), false);';
  const dateien = {
    [GATE_TEST]: testDatei("../src/sperre.js", "sperrt teure Ziele", pruefung),
    "test/sperre-zusatz.test.js": testDatei("../src/sperre.js", "sperrt auch hier", pruefung),
  };
  const schwach = testDatei("../src/sperre.js", "sperrt teure Ziele", "assert.ok(modul.gesperrt);");
  const ergebnis = await messeUndMelde(
    context,
    { weg: [], neu: { [GATE_TEST]: schwach } },
    { dateien },
  );
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.ok(Object.values(ergebnis.gelesen.gate).includes("Killed"), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(ergebnis.melden.ausgabe, /Gate-Lauf: Mutant nicht mehr getötet: src\/sperre\.js:/);
  assert.doesNotMatch(ergebnis.melden.ausgabe, /Verstoß: Mutant auf dem Branch nicht mehr getötet/);
});

function grosseQuelle(nummer) {
  const zeilen = Array.from(
    { length: ZEILEN_JE_GROSSER_QUELLE },
    (_leer, zeile) => `export const w${nummer}_${zeile} = ${zeile} + 1;`,
  );
  return `${zeilen.join("\n")}\n`;
}

function grosseQuellen(anzahl) {
  return Object.fromEntries(
    Array.from({ length: anzahl }, (_leer, nummer) => [
      `src/post/gross-${nummer}.js`,
      grosseQuelle(nummer),
    ]),
  );
}

test("ausmisten-messung: der Planer teilt eine große Messmenge in mehrere Pakete", async (context) => {
  const stand = await plane(
    context,
    { weg: [DOPPELT] },
    grosseQuellen(GROSSE_QUELLEN_FUER_ZWEI_PAKETE),
  );
  assert.equal(stand.planen.status, EXIT_GRUEN, stand.planen.ausgabe);
  const plan = JSON.parse(readFileSync(join(stand.artefakte, "plan", "plan.json"), "utf8"));
  assert.equal(JSON.parse(stand.plan.pakete).length, GROSSE_QUELLEN_FUER_ZWEI_PAKETE);
  assert.ok(
    plan.pakete.every(({ mutanten }) => mutanten <= MAX_MUTANTEN_JE_PAKET),
    stand.planen.ausgabe,
  );
  const alle = plan.pakete.flatMap(({ dateien }) => dateien).sort();
  assert.deepEqual(alle, plan.dateien);
});

test("ausmisten-messung: zu viele Pakete machen den Plan rot", async (context) => {
  const stand = await plane(context, { weg: [DOPPELT] }, grosseQuellen(ZU_VIELE_GROSSE_QUELLEN));
  assert.equal(stand.planen.status, EXIT_ROT, stand.planen.ausgabe);
  assert.match(
    stand.planen.ausgabe,
    /Zu viel auf einmal geändert: die Messung bräuchte 21 Pakete, höchstens 20/,
  );
});

test("ausmisten-messung: ein nach dem Festhalten verändertes Basis-Paket stoppt den Branch-Job", async (context) => {
  const vorBranch = (artefakte) => appendFileSync(join(artefakte, "basis-0", "basis-0.json"), " ");
  const ergebnis = await messeUndMelde(context, { weg: [DOPPELT] }, { vorBranch });
  assert.equal(ergebnis.zweig.status, EXIT_ROT, ergebnis.zweig.ausgabe);
  assert.match(
    ergebnis.zweig.ausgabe,
    /Basis-Artefakt unbrauchbar: Artefakt basis-0 passt nicht zur Prüfsumme/,
  );
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
});

test("ausmisten-messung: ein Plan, der nicht zur Prüfsumme passt, stoppt das Festhalten der Basis", async (context) => {
  const stand = await plane(context, { weg: [DOPPELT] });
  const basis = await messePaket(stand, { art: "basis", paket: 0 });
  assert.equal(basis.status, EXIT_GRUEN, basis.ausgabe);
  bieteAn(stand.routen, stand.artefakte, ["plan", "basis-0"]);
  const umgebung = {
    PAKETE: stand.plan.pakete,
    PLAN_PRUEFSUMME: "0".repeat(SHA256_ZEICHEN),
    GITHUB_OUTPUT: join(stand.artefakte, "sammeln.txt"),
  };
  const sammeln = await laufe({ args: ["sammeln"], umgebung }, stand);
  assert.equal(sammeln.status, EXIT_ROT, sammeln.ausgabe);
  assert.match(sammeln.ausgabe, /Der Plan passt nicht zur Prüfsumme/);
});

test("ausmisten-messung: ein Plan, der nicht zur Prüfsumme passt, stoppt die Basis-Messung", async (context) => {
  const stand = await plane(context, { weg: [DOPPELT] });
  const basis = await messePaket(
    { ...stand, plan: { ...stand.plan, pruefsumme: "0".repeat(SHA256_ZEICHEN) } },
    { art: "basis", paket: 0 },
  );
  assert.equal(basis.status, EXIT_ROT, basis.ausgabe);
  assert.match(basis.ausgabe, /Plan unbrauchbar: Der Plan passt nicht zur Prüfsumme/);
});
