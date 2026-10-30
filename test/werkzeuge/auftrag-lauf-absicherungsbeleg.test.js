import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { trailerZeile } from "../../tools/auftrag/absicherungsbeleg.mjs";
import { LAUF, legeGhAn, summen } from "./absicherungsbeleg-hilfen.js";
import { MIT_MUTATION } from "./auftrag-lauf-hilfen.js";
import { BASIS, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { commitAll, runIn, writeFiles } from "./probe-repo.js";

const AUFRUFE = ".fortschritt/mutation-aufrufe.txt";
const UMBAU_QUELLE = { "src/text.js": "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n" };
const ALTE_ZEILEN = ["export function gross(text) {", "  return text.toUpperCase();", "}", ""];
const ERSATZ_MUTATION = `import { appendFileSync, mkdirSync } from "node:fs";
mkdirSync(".fortschritt", { recursive: true });
appendFileSync(${JSON.stringify(AUFRUFE)}, process.argv.slice(2).join(" ") + "\\n");
console.log("grün: keiner überlebt");
`;

function imBranch(repo, auftrag, aenderungen) {
  runIn(repo, "git", ["switch", "-q", "-c", "absicherung/probe"]);
  aenderungen();
  runIn(repo, "git", ["commit", "-q", "--allow-empty", "-m", `Teste vorab\n\n${trailerZeile(LAUF, auftrag.id)}`]);
  runIn(repo, "git", ["switch", "-q", "-"]);
}

function umbau(context, { vermerk = true, beleg = {}, lauf = {}, ohneBeleg = false, auftrag = UMBAU, branch = null, danach = () => {} } = {}) {
  const vorbereiten = (repo) => {
    runIn(repo, "git", ["config", "user.name", "Probe"]);
    runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
    const belegCommit = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
    runIn(repo, "git", ["update-ref", "refs/remotes/upstream/master", belegCommit]);
    if (vermerk && branch !== null) imBranch(repo, auftrag, () => branch(repo));
    else if (vermerk) runIn(repo, "git", ["commit", "-q", "--allow-empty", "-m", `Teste vorab\n\n${trailerZeile(LAUF, auftrag.id)}`]);
    danach(repo);
    legeGhAn(context, { basis: belegCommit, bloecke: [{ datei: "src/text.js", von: 1, pruefsummen: summen(ALTE_ZEILEN) }], beleg, lauf, ohneBeleg });
  };
  const dateien = { ...MIT_MUTATION, "mutation.mjs": ERSATZ_MUTATION };
  const probe = starte(context, { auftrag, drehbuch: { bau: UMBAU_QUELLE }, dateien, vorbereiten, mitUpstream: false });
  const aufrufe = join(probe.repo, AUFRUFE);
  const mutationen = existsSync(aufrufe) ? readFileSync(aufrufe, "utf8").split("\n").filter(Boolean) : [];
  const nachricht = runIn(probe.repo, "git", ["log", "-1", "--format=%B"]).stdout;
  return { ...probe, mutationen, nachricht, alterStand: mutationen.filter((aufruf) => aufruf.includes("--alter-stand")) };
}

test("mit einem echten grünen Beleg lässt der Lauf die Mutationsprüfung am alten Stand weg, prüft die neuen Zeilen und nennt Lauf und Grund im Bericht", (context) => {
  const { lauf, alterStand, mutationen, nachricht } = umbau(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(alterStand, []);
  assert.equal(mutationen.length, 1);
  assert.ok(nachricht.includes(`Prüfung am alten Stand ausgelassen: Beleg aus Lauf ${LAUF}, `), nachricht);
});

test("ist das Urteil im Beleg nicht grün, prüft der Lauf den alten Stand voll und nennt den Grund im Bericht", (context) => {
  const { lauf, alterStand, nachricht } = umbau(context, { beleg: { urteil: 1 } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(alterStand.length, 1);
  assert.ok(nachricht.includes(`Beleg verworfen: das Urteil des Belegs ist nicht grün (Exit 1) (Lauf ${LAUF}); volle Prüfung am alten Stand.`), nachricht);
});

test("ein Beleg, der die verschobenen Zeilen nicht wortgleich abdeckt, lässt die Prüfung am alten Stand nicht weg", (context) => {
  const { lauf, alterStand, nachricht } = umbau(context, { beleg: { bloecke: [{ datei: "src/text.js", von: 1, pruefsummen: summen(["export function gross(text) {", "  return text;", "}", ""]) }] } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(alterStand.length, 1);
  assert.ok(nachricht.includes("nicht wortgleich zur geprüften Fassung"), nachricht);
});

test("ein Lauf, der kein Abruf ist, lässt die Prüfung am alten Stand nicht weg", (context) => {
  const { lauf, alterStand, nachricht } = umbau(context, { lauf: { event: "push" } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(alterStand.length, 1);
  assert.ok(nachricht.includes("Beleg verworfen: der Lauf 123 gehört nicht zum Abruf des Workflows CI"), nachricht);
});

test("ohne Absicherungsvermerk im Verlauf prüft der Lauf den alten Stand voll und schreibt keine Belegzeile", (context) => {
  const { lauf, alterStand, nachricht } = umbau(context, { vermerk: false });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(alterStand.length, 1);
  assert.ok(!nachricht.includes("Beleg"), nachricht);
});

test("hat der Auftrag einen Satz aus wasDarfNiePassieren ohne Schutztest, prüft der Lauf den alten Stand trotz echtem Beleg", (context) => {
  const auftrag = { ...UMBAU, wasDarfNiePassieren: ["Ein Text wird nie klein ausgegeben."] };
  const { alterStand, nachricht } = umbau(context, { auftrag });
  assert.ok(alterStand.length >= 1, nachricht);
  assert.ok(!nachricht.includes("ausgelassen"), nachricht);
});

const VORAB_DATEI = "test/vorab.test.js";

function vorabTest(repo) {
  writeFiles(repo, { [VORAB_DATEI]: 'import { test } from "node:test";\ntest("vorab", () => {});\n' });
  commitAll(repo, "Teste vorab\n\nPaket: PAS");
}

function imVerlauf(repo, text) {
  return runIn(repo, "git", ["log", "--format=%B"]).stdout.split(text).length - 1;
}

test("der Lauf übernimmt die Commits des Absicherungs-Branches vor dem Auftrag einmal und lässt dann die Prüfung am alten Stand weg", (context) => {
  const { repo, lauf, alterStand } = umbau(context, { branch: vorabTest });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(alterStand, []);
  assert.equal(imVerlauf(repo, trailerZeile(LAUF, UMBAU.id)), 1);
  assert.match(runIn(repo, "git", ["show", `HEAD:${VORAB_DATEI}`]).stdout, /vorab/);
});

test("ändert der Absicherungs-Branch eine Testdatei, die der Paket-Branch seitdem auch geändert hat, bricht der Lauf laut ab und übernimmt nichts", (context) => {
  const aenderung = (repo) => {
    writeFiles(repo, { "test/text.test.js": `${BASIS["test/text.test.js"]}test("a", () => {});\n` });
    commitAll(repo, "Teste vorab\n\nPaket: PAS");
  };
  const { repo, lauf, kopf, basis } = umbau(context, {
    branch: aenderung,
    danach: (verzeichnis) => {
      writeFiles(verzeichnis, { "test/text.test.js": `${BASIS["test/text.test.js"]}test("b", () => {});\n` });
      commitAll(verzeichnis, "Teste anders\n\nPaket: PAS");
    },
  });
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes("test/text.test.js: beide ändern diese Testdatei"), lauf.stderr);
  assert.equal(imVerlauf(repo, trailerZeile(LAUF, UMBAU.id)), 0);
  assert.equal(kopf, basis);
});

test("ändert ein Commit des Absicherungs-Branches etwas außerhalb von test/, übernimmt der Lauf nichts und bricht laut ab", (context) => {
  const quelle = (repo) => {
    writeFiles(repo, { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" });
    commitAll(repo, "Teste vorab\n\nPaket: PAS");
  };
  const { repo, lauf } = umbau(context, { branch: quelle });
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes("src/rechnen.js außerhalb von test/"), lauf.stderr);
  assert.equal(runIn(repo, "git", ["show", "HEAD:src/rechnen.js"]).stdout, BASIS["src/rechnen.js"]);
});
