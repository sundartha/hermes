import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { env } from "node:process";
import { mock, test } from "node:test";

import { postgresDa } from "../../tools/mutationspruefung/vorher-aus-ci.mjs";
import { mitVorherSpeicher } from "../../tools/mutationspruefung/vorher-speicher.mjs";
import { werkzeug as werkzeugAufruf } from "./mutationspruefung-probe.js";
import { commitAll, probeDirectory, probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";

const EXIT_ABBRUCH = 2;
const AUSFUEHRBAR = 0o755;
const LAUF = "4711";
const GEAENDERT = ["test/rechnen.test.js"];
const LOCK = JSON.stringify({
  packages: { "": {}, "node_modules/a": { version: "1.0.0", integrity: "sha512-a" }, "node_modules/b-andere-plattform": { version: "1.0.0", optional: true } },
});
const INSTALLIERT = '{"packages": {"node_modules/a": {"version": "1.0.0", "integrity": "sha512-a"}}}\n';
const WORKFLOW = ".github/workflows/testumbau-vorher.yml";
const PROBE_AUTOR = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid"];
const DATEIEN = {
  [WORKFLOW]: "name: testumbau-vorher\n",
  "package.json": '{ "type": "module" }\n',
  "package-lock.json": LOCK,
  ".gitignore": "node_modules/\n",
  "node_modules/.package-lock.json": INSTALLIERT,
  "stryker.config.json": "{}\n",
  "tools/werkzeug.mjs": "export const w = 1;\n",
  "src/rechnen.js": "export const doppelt = (zahl) => zahl * 2;\n\nexport const halb = (zahl) => zahl / 2;\n",
  "test/rechnen.test.js": 'import { doppelt } from "../src/rechnen.js";\nexport { doppelt };\n',
};
const GH_ATTRAPPE = [
  "#!/usr/bin/env node",
  'const { cpSync, readFileSync } = require("node:fs");',
  'const { dirname, join } = require("node:path");',
  "const hier = dirname(process.argv[1]);",
  "const argumente = process.argv.slice(2);",
  'if (argumente[1] === "view") process.stdout.write(readFileSync(join(hier, "lauf.json"), "utf8"));',
  'else cpSync(join(hier, "artefakte"), argumente[argumente.indexOf("-D") + 1], { recursive: true });',
  "",
].join("\n");
const GRUENER_LAUF = { workflowName: "testumbau-vorher", status: "completed", conclusion: "success" };

function kopf(repo) {
  return runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

function fallMitUmbau(context) {
  const repo = probeRepository(context, DATEIEN);
  const basis = kopf(repo);
  writeFileSync(join(repo, "test/rechnen.test.js"), 'import { doppelt } from "../src/rechnen.js";\nexport const umgebaut = doppelt;\n');
  commitAll(repo, "Umbau");
  return { context, repo, basis };
}

function planAus(repo, basis) {
  const ziel = join(repo, "node_modules", "plan.out");
  const lauf = werkzeugAufruf(repo, basis, "--tests", GEAENDERT.join(","), "--vorher-plan", ziel, "--stueck-sekunden", "1");
  assert.equal(lauf.status, 0, lauf.stderr);
  return JSON.parse(readFileSync(ziel, "utf8"));
}

function berichtZu(plan, stueck) {
  const getoetet = [{ schluessel: `${stueck.datei}:${stueck.zeilen[0][0]} Mutant`, datei: stueck.datei, status: "Killed", lage: stueck.zeilen[0] }];
  const { basis, tests, betroffen, umgebung } = plan;
  return { basis, tests, betroffen, stueck: { nummer: stueck.nummer, datei: stueck.datei, zeilen: stueck.zeilen }, anzahl: 1, getoetet, sekunden: 1, umgebung, postgres: postgresDa() };
}

function ghAttrappe(context, { plan, berichte, lauf = GRUENER_LAUF, plaene = [plan] }) {
  const ordner = probeDirectory(context, { gh: GH_ATTRAPPE, "lauf.json": JSON.stringify(lauf) });
  chmodSync(join(ordner, "gh"), AUSFUEHRBAR);
  plaene.forEach((inhalt, index) => {
    const artefakt = join(ordner, "artefakte", index === 0 ? "vorher-plan" : `vorher-plan-${index}`);
    mkdirSync(artefakt, { recursive: true });
    writeFileSync(join(artefakt, "plan.json"), JSON.stringify(inhalt));
  });
  for (const bericht of berichte) {
    const nummer = bericht.stueck.nummer;
    mkdirSync(join(ordner, "artefakte", `vorher-stueck-${nummer}`));
    writeFileSync(join(ordner, "artefakte", `vorher-stueck-${nummer}`, `stueck-${nummer}.json`), JSON.stringify(bericht));
  }
  const pfad = env.PATH;
  env.PATH = `${ordner}${delimiter}${pfad}`;
  context.after(() => {
    env.PATH = pfad;
  });
}

function einlesen({ context, repo, basis }, artefakte) {
  ghAttrappe(context, { lauf: { ...GRUENER_LAUF, headSha: kopf(repo) }, ...artefakte });
  return werkzeugAufruf(repo, basis, "--vorher-aus-ci", LAUF);
}

async function nachEinlesen(repo, basis) {
  const aufrufe = { gerechnet: 0 };
  const ausgabe = mock.method(console, "log", () => {});
  try {
    const ergebnis = await mitVorherSpeicher({ basis, geaendert: GEAENDERT, root: repo }, async () => {
      aufrufe.gerechnet += 1;
      return { tests: [], quellen: [], getoetet: [] };
    });
    return { ergebnis, gerechnet: aufrufe.gerechnet, zeilen: ausgabe.mock.calls.map(({ arguments: [zeile] }) => zeile) };
  } finally {
    ausgabe.mock.restore();
  }
}

function vollstaendig(plan) {
  return { plan, berichte: plan.stuecke.map((stueck) => berichtZu(plan, stueck)) };
}

async function abgelehnt(fall, artefakte, grund) {
  const { repo, basis } = fall;
  const lauf = einlesen(fall, artefakte);
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout);
  assert.match(lauf.stderr, grund);
  const { gerechnet } = await nachEinlesen(repo, basis);
  assert.equal(gerechnet, 1);
}

test("Vorher aus der CI: ein passender Lauf landet im Vorher-Speicher und die Testumbau-Prüfung nimmt ihn mit CI-Herkunft", async (context) => {
  const fall = fallMitUmbau(context);
  const { repo, basis } = fall;
  const plan = planAus(repo, basis);
  assert.ok(plan.stuecke.length > 1);
  const artefakte = vollstaendig(plan);
  const lauf = einlesen(fall, artefakte);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.match(lauf.stdout, new RegExp(`^Vorher-Seite aus der CI abgelegt \\(Schlüssel [0-9a-f]{12}\\): Lauf ${LAUF}, Kopf ${kopf(repo)}, `, "m"));
  const { ergebnis, gerechnet, zeilen } = await nachEinlesen(repo, basis);
  assert.equal(gerechnet, 0);
  assert.match(zeilen.join("\n"), new RegExp(`^Vorher-Seite aus dem Speicher \\(Schlüssel [0-9a-f]{12}, gerechnet in der CI: Lauf ${LAUF} auf ${plan.umgebung.plattform}, Kopf ${kopf(repo).slice(0, 12)}\\)\\.$`, "m"));
  assert.deepEqual(ergebnis.getoetet, artefakte.berichte.flatMap(({ getoetet }) => getoetet));
  assert.deepEqual(ergebnis.quellen, ["src/rechnen.js"]);
  assert.deepEqual(ergebnis.herkunft, { art: "ci", lauf: LAUF, kopf: kopf(repo), plattform: plan.umgebung.plattform, node: plan.umgebung.node });
});

test("Vorher aus der CI: ein Lauf auf einer anderen Basis wird abgelehnt und nichts abgelegt", async (context) => {
  const fall = fallMitUmbau(context);
  const plan = { ...planAus(fall.repo, fall.basis), basis: "b".repeat(40) };
  await abgelehnt(fall, vollstaendig(plan), /^- Basis: CI "b{40}", lokal "[0-9a-f]{40}"$/m);
});

test("Vorher aus der CI: ein Lauf mit einer anderen Testliste wird abgelehnt und nichts abgelegt", async (context) => {
  const fall = fallMitUmbau(context);
  const plan = planAus(fall.repo, fall.basis);
  const anders = { ...plan, tests: [...plan.tests, "test/anders.test.js"] };
  await abgelehnt(fall, vollstaendig(anders), /^- Testliste: CI \["test\/rechnen\.test\.js","test\/anders\.test\.js"\], lokal \["test\/rechnen\.test\.js"\]$/m);
});

test("Vorher aus der CI: ein fehlendes Stück wird abgelehnt und nichts abgelegt", async (context) => {
  const fall = fallMitUmbau(context);
  const { plan, berichte } = vollstaendig(planAus(fall.repo, fall.basis));
  await abgelehnt(fall, { plan, berichte: berichte.slice(1) }, /Abbruch: es fehlen die Stücke 1 von/);
});

test("Vorher aus der CI: ein anderer Werkzeugstand wird abgelehnt und nichts abgelegt", async (context) => {
  const fall = fallMitUmbau(context);
  const artefakte = vollstaendig(planAus(fall.repo, fall.basis));
  writeFileSync(join(fall.repo, "tools/werkzeug.mjs"), "export const w = 2;\n");
  await abgelehnt(fall, artefakte, /^- Werkzeugstand: abweichende Dateien 1 \(tools\/werkzeug\.mjs\)$/m);
});

async function jeFrischerFall(context, faelle) {
  for (const [artefakte, grund] of faelle) {
    const fall = fallMitUmbau(context);
    await abgelehnt(fall, artefakte(fall), grund);
  }
}

function mitLauf(lauf) {
  return (fall) => ({ ...vollstaendig(planAus(fall.repo, fall.basis)), lauf: { ...GRUENER_LAUF, ...lauf } });
}

function mitPlan(aendern) {
  return (fall) => vollstaendig(aendern(planAus(fall.repo, fall.basis)));
}

function fremdeQuelle(plan) {
  const quellen = [...plan.quellen, { datei: "src/fremd.js", zeilen: 1 }];
  return { ...plan, quellen, stuecke: [...plan.stuecke, { nummer: plan.stuecke.length + 1, datei: "src/fremd.js", zeilen: [[1, 1]] }] };
}

function anderesPostgres(fall) {
  const { plan, berichte } = vollstaendig(planAus(fall.repo, fall.basis));
  return { plan, berichte: berichte.map((bericht) => ({ ...bericht, postgres: !postgresDa() })) };
}

test("Vorher aus der CI: ein offener, roter oder fremder Lauf wird abgelehnt und nichts abgelegt", async (context) => {
  await jeFrischerFall(context, [
    [mitLauf({ conclusion: "failure" }), /Lauf 4711 ist nicht grün abgeschlossen \(completed, failure\)/],
    [mitLauf({ status: "in_progress" }), /Lauf 4711 ist nicht grün abgeschlossen \(in_progress, success\)/],
    [mitLauf({ workflowName: "ci" }), /Lauf 4711 gehört zum Workflow ci, nicht zu testumbau-vorher/],
  ]);
});

test("Vorher aus der CI: andere betroffene Tests, Quelldateien, Postgres oder Node werden abgelehnt", async (context) => {
  await jeFrischerFall(context, [
    [mitPlan((plan) => ({ ...plan, betroffen: [...plan.betroffen, "test/b.test.js"] })), /^- betroffene Tests: CI /m],
    [mitPlan(fremdeQuelle), /^- Quelldateien: CI \["src\/rechnen\.js","src\/fremd\.js"\], lokal \["src\/rechnen\.js"\]$/m],
    [mitPlan((plan) => ({ ...plan, umgebung: { ...plan.umgebung, node: "v0.0.1" } })), /^- Node: CI "v0\.0\.1", lokal "v/m],
    [anderesPostgres, /^- Postgres: CI \[(true|false)\], lokal \[(true|false)\]$/m],
  ]);
});

function installiert(pakete) {
  return (fall) => {
    writeFileSync(join(fall.repo, "node_modules/.package-lock.json"), JSON.stringify({ packages: pakete }));
    return vollstaendig(planAus(fall.repo, fall.basis));
  };
}

function zweiPlaene(fall) {
  const artefakte = vollstaendig(planAus(fall.repo, fall.basis));
  return { ...artefakte, plaene: [artefakte.plan, artefakte.plan] };
}

const MODULE_NEBEN_LOCK = /^- Werkzeugstand: lokale Module passen nicht zu package-lock\.json: 1 \(node_modules\/a\)$/m;

test("Vorher aus der CI: ein Lauf ohne Werkzeugstand, mit zwei Plänen oder lokale Module neben der Lockdatei werden abgelehnt", async (context) => {
  await jeFrischerFall(context, [
    [mitPlan((plan) => ({ ...plan, umgebung: undefined })), /^- Werkzeugstand: der Lauf nennt keinen \(älteres Werkzeug\)$/m],
    [installiert({ "node_modules/a": { version: "2.0.0", integrity: "sha512-a" } }), MODULE_NEBEN_LOCK],
    [installiert({ "node_modules/a": { version: "1.0.0", integrity: "sha512-b" } }), MODULE_NEBEN_LOCK],
    [installiert({}), MODULE_NEBEN_LOCK],
    [zweiPlaene, /Abbruch: der Lauf enthält 2 Pläne statt einem/],
  ]);
});

test("Vorher aus der CI: ein Stück mit anderem Werkzeugstand als der Plan wird abgelehnt", async (context) => {
  const fall = fallMitUmbau(context);
  const { plan, berichte } = vollstaendig(planAus(fall.repo, fall.basis));
  const fremd = { ...berichte[0], umgebung: { ...plan.umgebung, plattform: "anders" } };
  await abgelehnt(fall, { plan, berichte: [fremd, ...berichte.slice(1)] }, /Abbruch: Stück 1 gehört zu einem anderen Plan/);
});

test("Vorher aus der CI: eine schon gespeicherte Vorher-Seite wird nicht überschrieben", async (context) => {
  const fall = fallMitUmbau(context);
  const { repo, basis } = fall;
  const artefakte = vollstaendig(planAus(repo, basis));
  assert.equal(einlesen(fall, artefakte).status, 0);
  const zweiter = einlesen(fall, { ...artefakte, lauf: { ...GRUENER_LAUF, headSha: basis } });
  assert.equal(zweiter.status, 0, zweiter.stderr);
  assert.match(zweiter.stdout, /^Vorher-Seite für diesen Fall liegt schon im Speicher \(Schlüssel [0-9a-f]{12}\); Lauf 4711 nicht übernommen\.$/m);
  const { ergebnis } = await nachEinlesen(repo, basis);
  assert.equal(ergebnis.herkunft.kopf, kopf(repo));
});

function vonKopf(headSha) {
  return (fall) => ({ ...vollstaendig(planAus(fall.repo, fall.basis)), lauf: { ...GRUENER_LAUF, headSha: headSha(fall) } });
}

function seitenCommit({ repo, basis }) {
  return runIn(repo, "git", [...PROBE_AUTOR, "commit-tree", `${basis}^{tree}`, "-p", basis, "-m", "Seite"]).stdout.trim();
}

const KEIN_VORFAHR = /^- Kopf des Laufs: [0-9a-f]{40} ist lokal nicht vorhanden oder kein Vorfahr des lokalen Stands$/m;

test("Vorher aus der CI: ein Lauf von einem fremden Kopf wird abgelehnt und nichts abgelegt", async (context) => {
  await jeFrischerFall(context, [
    [vonKopf(() => "e".repeat(40)), KEIN_VORFAHR],
    [vonKopf(seitenCommit), KEIN_VORFAHR],
    [vonKopf(() => "--output=x"), /^- Kopf des Laufs: "--output=x" ist keine Commit-SHA$/m],
  ]);
});

test("Vorher aus der CI: ein Lauf mit anderer Workflow-Datei am Kopf wird abgelehnt und nichts abgelegt", async (context) => {
  const fall = fallMitUmbau(context);
  const artefakte = vollstaendig(planAus(fall.repo, fall.basis));
  writeFileSync(join(fall.repo, WORKFLOW), "name: testumbau-vorher\non: push\n");
  await abgelehnt(fall, artefakte, /^- Workflow: \.github\/workflows\/testumbau-vorher\.yml am Kopf des Laufs ist anders als lokal$/m);
});

test("Vorher aus der CI: falsche Aufrufe brechen ab, ohne GitHub zu fragen", (context) => {
  const { repo, basis } = fallMitUmbau(context);
  for (const argumente of [["--vorher-aus-ci", LAUF, "--tests", GEAENDERT[0]], ["--vorher-aus-ci", LAUF, "--ergebnis", "x.out"], ["--vorher-aus-ci", LAUF, "--testumbau"]]) {
    const lauf = werkzeugAufruf(repo, basis, ...argumente);
    assert.equal(lauf.status, EXIT_ABBRUCH, argumente.join(" "));
    assert.match(lauf.stderr, /^Aufruf: /, argumente.join(" "));
  }
  const ohneBasis = runIn(repo, process.execPath, [join(REPO_ROOT, "tools/mutationspruefung.mjs"), "--vorher-aus-ci", LAUF]);
  assert.equal(ohneBasis.status, EXIT_ABBRUCH);
  assert.match(ohneBasis.stderr, /^Aufruf: /);
  const keineNummer = werkzeugAufruf(repo, basis, "--vorher-aus-ci", "../4711");
  assert.equal(keineNummer.status, EXIT_ABBRUCH);
  assert.match(keineNummer.stderr, /--vorher-aus-ci verlangt die Nummer eines Laufs, nicht \.\.\/4711/);
});
