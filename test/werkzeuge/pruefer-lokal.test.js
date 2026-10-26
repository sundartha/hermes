import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment, probeDirectory } from "./probe-repo.js";
import {
  SCHEIN_TOKEN,
  aufzeichnung,
  ersatzPruefer,
  ohneGitVariablen,
  probeRepo,
  scheinGithub,
} from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const EINSTIEG = join(REPO_ROOT, "tools/pruefer-lokal.mjs");
const ISSUE_NUMMER = 41;
const NACHRICHT = "Setze die Zahl\n\nWarum: Auftrag a1.\n\nPaket: EF5\n";
const PAKET_ABSICHT = "Die Zahl soll 2 sein, ohne Sonderfall für die Testeingabe.";
const PAKET_ISSUE = `## Absicht\n\n${PAKET_ABSICHT}\n\n## Ziel\n\nZiel`;
const EXIT_BEFUNDE = 1;
const EXIT_AUFRUF = 2;
const EXIT_NICHT_GELAUFEN = 3;
const AUSFUEHRBAR = 0o755;
const ERSATZ = fileURLToPath(new URL("pruefer/ersatz-pruefer.mjs", import.meta.url));
const PROBE_GIT = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

function mitBefunden(schweren) {
  const aufnahme = aufzeichnung("gueltig");
  const ergebnis = aufnahme.zeilen.find((zeile) => zeile.type === "result");
  const befunde = ergebnis.structured_output.befunde.filter(({ schwere }) => schweren.includes(schwere));
  ergebnis.structured_output = { urteil: befunde.length ? "NICHT_BESTANDEN" : "BESTANDEN", befunde };
  return aufnahme;
}

function ohneBefunde() {
  return mitBefunden([]);
}

function paketBranch(context, { letzterLeer, phase }) {
  const repo = probeRepo(context);
  repo.git(["branch", "-M", "master"]);
  repo.git(["checkout", "-q", "-b", "paket/EF5-probe"]);
  if (phase) repo.committe(phase, "Lege die Phase an\n");
  repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, NACHRICHT);
  repo.committe({ "src/name.js": "export const NAME = 'b';\n" }, NACHRICHT);
  if (letzterLeer) repo.git([...PROBE_GIT, "commit", "-q", "--allow-empty", "-m", NACHRICHT]);
  return repo;
}

function diffZaehler(context, aufnahme) {
  const ordner = probeDirectory(context, { "aufnahme.json": JSON.stringify(aufnahme) });
  const liste = join(ordner, "diffs.txt");
  const programm = join(ordner, "claude.mjs");
  const einstellung = { aufzeichnung: join(ordner, "aufnahme.json"), protokoll: join(ordner, "protokoll.json"), liestDiffs: true };
  writeFileSync(
    programm,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync, readFileSync, readdirSync } from "node:fs";',
      `import { spiele } from ${JSON.stringify(ERSATZ)};`,
      'const inhalt = readdirSync("diff").map((name) => readFileSync(`diff/${name}`, "utf8")).join("");',
      `appendFileSync(${JSON.stringify(liste)}, \`\${inhalt.length}\\n\`);`,
      `spiele(${JSON.stringify(einstellung)});`,
      "",
    ].join("\n"),
  );
  chmodSync(programm, AUSFUEHRBAR);
  const laengen = () => readFileSync(liste, "utf8").trim().split("\n").map(Number);
  return { programm, protokoll: () => null, laengen };
}

function issueRouten({ issueLesbar = true, issueText = PAKET_ISSUE }) {
  return issueLesbar ? [[`GET /repos/sundartha/hermes/issues/${ISSUE_NUMMER}`, { title: "Paket EF5", body: issueText }]] : [];
}

async function starte(context, { aufnahme, token = SCHEIN_TOKEN, argumente, unterordner = "", ersatz: eigenerErsatz, letzterLeer = false, phase, ...issue }) {
  const repo = paketBranch(context, { letzterLeer, phase });
  const ersatz = eigenerErsatz ?? ersatzPruefer(context, { aufnahme });
  const github = await scheinGithub(context, new Map(issueRouten(issue)));
  const ablage = join(probeDirectory(context, {}), "nicht-oeffentlich");
  const aus = join(probeDirectory(context, {}), "ergebnis");
  const umgebung = {
    ...isolatedEnvironment(),
    HERMES_CLAUDE: ersatz.programm,
    GH_TOKEN: "schein-gh",
    GITHUB_API_URL: github.url,
    GITHUB_REPOSITORY: "sundartha/hermes",
    CLAUDE_CODE_OAUTH_TOKEN: token,
  };
  const args = argumente ?? ["--basis", "master", "--issue", String(ISSUE_NUMMER), "--aus", aus, "--ablage", ablage];
  const kind = spawn(process.execPath, [EINSTIEG, ...args], { cwd: join(repo.ordner, unterordner), env: umgebung });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const [status] = await once(kind, "close");
  const datei = join(aus, "ergebnis.json");
  const ergebnis = existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null;
  const hinweisDatei = join(ablage, "sicherheitshinweise.json");
  const hinweise = existsSync(hinweisDatei) ? JSON.parse(readFileSync(hinweisDatei, "utf8")).hinweise : null;
  return { status, ausgabe, ergebnis, hinweise, repo, anfragen: github.anfragen, protokoll: ersatz.protokoll() };
}

test("lokal prüft jeden Commit seit master mit dem Befehl der CI, endet bei einem BLOCKER mit 1 und schreibt nichts nach GitHub", async (context) => {
  const { status, ausgabe, ergebnis, repo, anfragen, protokoll } = await starte(context, {
    aufnahme: aufzeichnung("gueltig"),
  });
  assert.equal(status, EXIT_BEFUNDE, ausgabe);
  assert.equal(ergebnis.head, repo.git(["rev-parse", "HEAD"]));
  assert.equal(ergebnis.basis, repo.git(["rev-parse", "master"]));
  assert.equal(ergebnis.lokal, true);
  assert.deepEqual(
    ergebnis.commits.map(({ zustand }) => zustand),
    ["geprueft", "geprueft"],
  );
  assert.deepEqual(
    anfragen.map(({ methode, pfad }) => `${methode} ${pfad}`),
    [`GET /repos/sundartha/hermes/issues/${ISSUE_NUMMER}`],
  );
  assert.match(protokoll.argumente.join(" "), /^-p --restricted --tools Read,Grep,Glob /);
  assert.deepEqual(Object.keys(protokoll.umgebung).filter((name) => !name.startsWith("__CF_")).sort(), [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "HOME",
    "PATH",
  ]);
  assert.match(ausgabe, /kein Merge-Signal/);
  assert.doesNotMatch(ausgabe, /success/);
});

test("lokal prüft auch einen leeren letzten Commit am ganzen PR, damit Auftrag und Bereich geprüft werden", async (context) => {
  const { status, ausgabe, ergebnis, protokoll } = await starte(context, { aufnahme: ohneBefunde(), letzterLeer: true });
  assert.equal(status, 0, ausgabe);
  assert.equal(ergebnis.commits.at(-1).grund, "");
  assert.ok(protokoll.dateien.includes("pr/gesamt.patch"), protokoll.dateien.join(", "));
});

test("lokal aus einem Unterordner gibt dem Prüfer dieselben Diffs wie aus der Wurzel", async (context) => {
  const wurzel = diffZaehler(context, ohneBefunde());
  await starte(context, { ersatz: wurzel });
  const unten = diffZaehler(context, ohneBefunde());
  const { status, ausgabe } = await starte(context, { ersatz: unten, unterordner: "src" });
  assert.equal(status, 0, ausgabe);
  assert.ok(unten.laengen().every((laenge) => laenge > 0));
  assert.deepEqual(unten.laengen(), wurzel.laengen());
});

test("lokal mit nicht lesbarem Issue endet mit 2 und startet den Prüfer nicht", async (context) => {
  const { status, ausgabe, protokoll } = await starte(context, { aufnahme: ohneBefunde(), issueLesbar: false });
  assert.equal(status, EXIT_AUFRUF);
  assert.match(ausgabe, /Issue #41 nicht lesbar/);
  assert.equal(protokoll, null);
});

test("lokal mit unbekannter Basis endet mit 2, nicht mit dem Code für Befunde", async (context) => {
  const aus = join(probeDirectory(context, {}), "ergebnis");
  const { status, protokoll } = await starte(context, {
    aufnahme: ohneBefunde(),
    argumente: ["--basis", "gibtsnicht", "--issue", String(ISSUE_NUMMER), "--aus", aus, "--ablage", `${aus}-ablage`],
  });
  assert.equal(status, EXIT_AUFRUF);
  assert.equal(protokoll, null);
});

test("lokal mit der Basis auf HEAD findet keine Commits und endet mit 2 statt mit einem sauberen Ergebnis", async (context) => {
  const aus = join(probeDirectory(context, {}), "ergebnis");
  const { status, ausgabe, protokoll, anfragen } = await starte(context, {
    aufnahme: ohneBefunde(),
    argumente: ["--basis", "HEAD", "--issue", String(ISSUE_NUMMER), "--aus", aus, "--ablage", `${aus}-ablage`],
  });
  assert.equal(status, EXIT_AUFRUF, ausgabe);
  assert.match(ausgabe, /Keine Commits/);
  assert.equal(protokoll, null);
  assert.deepEqual(anfragen, []);
});

test("lokal endet mit nur SOLLTE und HINWEIS mit 0, weil nur ein BLOCKER den PR aufhält", async (context) => {
  const { status, ausgabe } = await starte(context, { aufnahme: mitBefunden(["SOLLTE", "HINWEIS"]) });
  assert.equal(status, 0, ausgabe);
});

test("lokal legt einen Sicherheits-BLOCKER mit Beleg in die Ablage, damit die Sitzung ihn beheben kann", async (context) => {
  const { status, ausgabe, ergebnis, hinweise, repo } = await starte(context, { aufnahme: aufzeichnung("sicherheit") });
  assert.equal(status, EXIT_BEFUNDE, ausgabe);
  assert.equal(JSON.stringify(ergebnis).includes("GEHEIM"), false);
  assert.deepEqual(
    ergebnis.commits.map(({ befunde }) => befunde[0]),
    [{ sicherheit: true, schwere: "BLOCKER" }, { sicherheit: true, schwere: "BLOCKER" }],
  );
  const commits = [repo.git(["rev-parse", "HEAD~1"]), repo.git(["rev-parse", "HEAD"])];
  assert.deepEqual(
    hinweise.map(({ sha, befund }) => [sha, befund.schwere, befund.id, befund.beleg]),
    commits.map((sha) => [sha, "BLOCKER", "SG-3", "GEHEIMER-BELEG-91c2"]),
  );
});

test("lokal endet ohne BLOCKER und SOLLTE mit 0", async (context) => {
  const { status, ausgabe } = await starte(context, { aufnahme: ohneBefunde() });
  assert.equal(status, 0, ausgabe);
});

test("lokal ohne Token startet den Prüfer nicht und endet mit 3", async (context) => {
  const { status, ergebnis, protokoll } = await starte(context, {
    aufnahme: ohneBefunde(),
    token: "",
  });
  assert.equal(status, EXIT_NICHT_GELAUFEN);
  assert.equal(protokoll, null);
  assert.deepEqual(
    ergebnis.commits.map(({ zustand, grund }) => [zustand, grund]),
    [
      ["nicht_gelaufen", "Token fehlt"],
      ["nicht_gelaufen", "Token fehlt, nicht gestartet"],
    ],
  );
});

test("lokal ohne Issue-Nummer endet mit 2 und startet nichts", async (context) => {
  const { status, ausgabe, protokoll } = await starte(context, {
    aufnahme: ohneBefunde(),
    argumente: ["--basis", "master", "--aus", "/tmp/egal", "--ablage", "/tmp/egal-ablage"],
  });
  assert.equal(status, EXIT_AUFRUF);
  assert.match(ausgabe, /Aufruf:/);
  assert.equal(protokoll, null);
});

test("lokal mit einem Paket-Issue ohne Abschnitt „Absicht“ endet mit 3 und startet den Prüfer nicht", async (context) => {
  const lauf = await starte(context, { aufnahme: ohneBefunde(), issueText: "## Ziel\n\nZiel" });
  assert.equal(lauf.status, EXIT_NICHT_GELAUFEN, lauf.ausgabe);
  assert.equal(lauf.protokoll, null);
  assert.deepEqual(
    [...new Set(lauf.ergebnis.commits.map(({ zustand, grund }) => `${zustand}: ${grund}`))],
    [`nicht_gelaufen: Absicht fehlt: Issue #${ISSUE_NUMMER}: Paket-PR und Phase mit Absicht brauchen im Issue den Abschnitt „## Absicht“`],
  );
});

const PHASE = "P-009-probe";
const FALLE = "- Zahl und Wort nie zu einem Satz zusammensetzen, auch wenn die Ausgabe gleich bleibt.";
const NICHT_ZIEL = "- Kein neuer Text für Französisch.";
const NUR_IM_PITCH = "Das Problem steht nur im Pitch und nicht im Auftragszettel.";
const PITCH = ["# Pitch", "", "## Problem", "", NUR_IM_PITCH, "", "## Fallen", "", FALLE, "", "## Nicht-Ziele", "", NICHT_ZIEL, ""].join("\n");
const VORGABEN = "## Fallen und Nicht-Ziele aus dem Pitch";

function auftragszettelDesLetztenCommits(protokoll) {
  const anfang = protokoll.eingabe.indexOf("# Auftragszettel");
  return protokoll.eingabe.slice(anfang, protokoll.eingabe.indexOf("## Commits des Pull Requests", anfang));
}

test("bringt der PR eine Phase aus einem Pitch, stehen Fallen und Nicht-Ziele wörtlich im Auftragszettel des Prüfers, der Rest des Pitches nicht", async (context) => {
  const phase = { [`plaene/${PHASE}/pitch.md`]: PITCH, [`plaene/${PHASE}/phase.json`]: JSON.stringify({ phase: PHASE, auftraege: [] }) };
  const lauf = await starte(context, { aufnahme: ohneBefunde(), phase });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  const zettel = auftragszettelDesLetztenCommits(lauf.protokoll);
  assert.ok(zettel.includes(`${VORGABEN}\n\nQuelle: plaene/${PHASE}/pitch.md am Stand des Pull Requests\n\n## Fallen\n\n${FALLE}\n\n## Nicht-Ziele\n\n${NICHT_ZIEL}\n`), zettel);
  assert.equal(zettel.includes(NUR_IM_PITCH), false, zettel);
});

test("ohne Phase aus einem Pitch sagt der Auftragszettel, dass es keine Fallen und Nicht-Ziele gibt, statt den Abschnitt wegzulassen", async (context) => {
  const lauf = await starte(context, { aufnahme: ohneBefunde() });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.ok(auftragszettelDesLetztenCommits(lauf.protokoll).includes(`${VORGABEN}\n\nkeine Angabe; `));
});

const BEGRIFF = "- `ZAHL`: die Zahl aus src/zahl.js, immer 2.";

test("bringt der PR eine Phase aus einem Pitch mit „Neue Begriffe“, steht der Abschnitt wörtlich im Auftragszettel des Prüfers", async (context) => {
  const mitBegriffen = `${PITCH}\n## Neue Begriffe\n\n${BEGRIFF}\n`;
  const phase = { [`plaene/${PHASE}/pitch.md`]: mitBegriffen, [`plaene/${PHASE}/phase.json`]: JSON.stringify({ phase: PHASE, auftraege: [] }) };
  const lauf = await starte(context, { aufnahme: ohneBefunde(), phase });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  const zettel = auftragszettelDesLetztenCommits(lauf.protokoll);
  assert.ok(zettel.includes(`## Nicht-Ziele\n\n${NICHT_ZIEL}\n\n## Neue Begriffe\n\n${BEGRIFF}\n`), zettel);
  assert.equal(zettel.includes(NUR_IM_PITCH), false, zettel);
});
