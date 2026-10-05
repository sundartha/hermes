import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { artefakt, pruefen } from "../../tools/auftrag/pruefer-befehle.mjs";
import { probeDirectory } from "./probe-repo.js";
import {
  SCHEIN_TOKEN,
  aufzeichnung,
  ciLauf,
  ersatzPruefer,
  ohneGitVariablen,
  probeRepo,
  setzeAusloeser,
  workflowAbfrage,
} from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const PR_NUMMER = 7;
const KURZ = 12;
const NACHRICHT = "Setze die Zahl\n\nWarum: Auftrag a1.\n\nAuftrag: probe/a1\n";
const OFFEN = "Lauf vorzeitig beendet";

function zweiCommits(context) {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  const erster = repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, NACHRICHT);
  const zweiter = repo.committe({ "src/zahl.js": "export const ZAHL = 3;\n" }, NACHRICHT);
  return { repo, basis, erster, zweiter };
}

function scheinGithub({ basis, zweiter }) {
  const pr = { number: PR_NUMMER, state: "open", head: { sha: zweiter }, body: "" };
  return {
    hole: async (pfad) =>
      pfad === `/commits/${zweiter}/pulls`
        ? [{ ...pr, base: { sha: basis, ref: "master" } }]
        : workflowAbfrage(pfad),
    alle: async () => [],
    sende: async () => ({}),
  };
}

function zeilen(datei) {
  if (!existsSync(datei)) return [];
  return readFileSync(datei, "utf8").trim().split("\n").filter(Boolean);
}

function schrittAusgabe(context) {
  const ausgabe = join(probeDirectory(context, {}), "github-output.txt");
  process.env.GITHUB_OUTPUT = ausgabe;
  context.after(() => {
    delete process.env.GITHUB_OUTPUT;
  });
  return ausgabe;
}

async function pruefeZweiCommits(context) {
  const lage = zweiCommits(context);
  const aus = join(probeDirectory(context, {}), "ergebnis");
  const liste = join(probeDirectory(context, {}), "schnappschuesse.jsonl");
  const ersatz = ersatzPruefer(context, {
    aufnahme: aufzeichnung("gueltig"),
    beobachtet: { datei: join(aus, "ergebnis.json"), liste },
  });
  const ausgabe = schrittAusgabe(context);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = SCHEIN_TOKEN;
  setzeAusloeser(context, ciLauf());
  const log = [];
  context.mock.method(console, "log", (zeile) => log.push([zeile, zeilen(liste).length]));
  const optionen = { head: lage.zweiter, "pr-branch": "fix/zahl", aus };
  const status = await pruefen(optionen, lage.repo.ordner, {
    github: scheinGithub(lage),
    programm: ersatz.programm,
  });
  return { ...lage, status, aus, ausgabe, log, schnappschuesse: zeilen(liste).map(JSON.parse) };
}

const zustaende = (ergebnis) => ergebnis.commits.map(({ zustand, grund }) => [zustand, grund]);

test("pruefen schreibt ergebnis.json nach jedem Commit fort und meldet jeden Commit sofort", async (context) => {
  const lauf = await pruefeZweiCommits(context);
  assert.equal(lauf.status, 0);
  const [waehrendErstem, waehrendZweitem] = lauf.schnappschuesse;
  assert.deepEqual(zustaende(waehrendErstem), [
    ["nicht_gelaufen", OFFEN],
    ["nicht_gelaufen", OFFEN],
  ]);
  assert.deepEqual(zustaende(waehrendZweitem), [
    ["geprueft", ""],
    ["nicht_gelaufen", OFFEN],
  ]);
  const ende = JSON.parse(readFileSync(join(lauf.aus, "ergebnis.json"), "utf8"));
  assert.deepEqual(zustaende(ende), [
    ["geprueft", ""],
    ["geprueft", ""],
  ]);
  const ersteZeile = lauf.log.find(([zeile]) =>
    zeile.startsWith(`Commit ${lauf.erster.slice(0, KURZ)}: geprueft`),
  );
  assert.equal(ersteZeile[1], 1);
});

test("artefakt nennt den Artefakt-Namen mit der PR-Nummer als Schritt-Ausgabe, ohne zu prüfen", async (context) => {
  const lage = zweiCommits(context);
  const ausgabe = schrittAusgabe(context);
  setzeAusloeser(context, ciLauf());
  context.mock.method(console, "log", () => {});
  const status = await artefakt({ head: lage.zweiter }, lage.repo.ordner, {
    github: scheinGithub(lage),
  });
  assert.equal(status, 0);
  assert.equal(readFileSync(ausgabe, "utf8"), `artefakt=pruefer-ergebnis-pr${PR_NUMMER}\n`);
});

test("pruefen schreibt keine Schritt-Ausgabe, der Name steht schon vor dem Prüfschritt fest", async (context) => {
  const lauf = await pruefeZweiCommits(context);
  assert.equal(lauf.status, 0);
  assert.equal(existsSync(lauf.ausgabe), false);
});
