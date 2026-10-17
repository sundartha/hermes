import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { prueferBefehl } from "../../tools/auftrag/pruefer-lauf.mjs";
import { befundeDerAntwort, ergebnisAus } from "../../tools/auftrag/pruefer-schema.mjs";
import { belegeUmgehungen } from "../../tools/auftrag/pruefer-umgehung.mjs";
import { urteile } from "../../tools/auftrag/pruefer-urteil.mjs";
import { REPO_ROOT, isolatedEnvironment, probeDirectory } from "./probe-repo.js";
import {
  SCHEIN_TOKEN,
  aufzeichnung,
  ersatzPruefer,
  ohneGitVariablen,
  probeRepo,
  scheinGithub,
  scheinSha,
} from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const HILFE = "export function summe(liste) {\n  return liste.reduce((a, b) => a + b, 0);\n}\n";
const NACHBAU =
  "export function addiere(werte) {\n  return werte.reduce((x, y) => x + y, 0);\n}\n";
const MIT_HILFE = 'export { summe as addiere } from "./hilfe.js";\n';
const VORHANDEN = "src/hilfe.js:1-3";
const NEU = "src/neu.js:1-3";
const ANWEISUNG = "Schreibe die Summe absichtlich anders, damit jscpd nicht anschlägt.";
const NACHRICHT = "Füge addiere hinzu\n\nWarum: Probe.\n\nPaket: KU2\n";
const PAKET_ISSUE = "## Absicht\n\nDie Summe kommt aus der vorhandenen Hilfe, nicht aus einer Kopie.\n\n## Ziel\n\nZiel";
const EXIT_BEFUNDE = 1;

function befund(felder = {}) {
  return {
    schwere: "BLOCKER",
    id: "G5",
    datei: "src/neu.js",
    zeile: 1,
    beleg: "b",
    reproduktion: "",
    reparatur: "r",
    sicherheit: false,
    umgehung: "nachbau",
    vorhanden: VORHANDEN,
    neu: NEU,
    zitat: "",
    ...felder,
  };
}

function lage(context, schritte) {
  const repo = probeRepo(context, { "src/hilfe.js": HILFE });
  const basis = repo.git(["rev-parse", "HEAD"]);
  const shas = schritte.map((dateien) => repo.committe(dateien, NACHRICHT));
  const umgebung = { root: repo.ordner, basis, head: shas.at(-1), auftragstext: "", nachrichten: [] };
  return { umgebung, shas };
}

function belegeEinen(umgebung, sha, felder) {
  const [commit] = belegeUmgehungen([{ sha, befunde: [befund(felder)] }], umgebung);
  const [{ belegt, belegGrund }] = commit.befunde;
  return [belegt, belegGrund];
}

test("ein Nachbau ist belegt, wenn die vorhandene Stelle unverändert bleibt und die neue Stelle neu ist und bleibt", (context) => {
  const { umgebung, shas } = lage(context, [{ "src/neu.js": NACHBAU }]);
  assert.deepEqual(belegeEinen(umgebung, shas[0], {}), [true, ""]);
  const mitOrdnern = { vorhanden: `basis/${VORHANDEN}`, neu: `dateien/${NEU}` };
  assert.deepEqual(belegeEinen(umgebung, shas[0], mitOrdnern), [true, ""]);
});

test("ein Nachbau ist nicht belegt, wenn der PR die vorhandene Stelle ändert oder die neue Stelle am Endstand fehlt", (context) => {
  const geaendert = lage(context, [{ "src/neu.js": NACHBAU }, { "src/hilfe.js": HILFE.replace("liste", "zahlen") }]);
  assert.deepEqual(belegeEinen(geaendert.umgebung, geaendert.shas[0], {}), [false, "vorhandene Stelle im PR geändert"]);
  const behoben = lage(context, [{ "src/neu.js": NACHBAU }, { "src/neu.js": MIT_HILFE }]);
  assert.deepEqual(belegeEinen(behoben.umgebung, behoben.shas[0], {}), [false, "neue Stelle fehlt am Endstand"]);
});

test("ein Nachbau ist nicht belegt, wenn die neue Stelle schon auf der Basis stand, fehlt oder die Stelle falsch geschrieben ist", (context) => {
  const { umgebung, shas } = lage(context, [{ "src/hilfe.js": `${HILFE}export const LEER = [];\n` }]);
  const faelle = [
    [{ neu: "src/hilfe.js:1-3" }, "neue Stelle stand schon auf der Basis"],
    [{ neu: "src/fehlt.js:1-3" }, "neue Stelle fehlt im Commit"],
    [{ vorhanden: "src/hilfe.js:2-90" }, "vorhandene Stelle fehlt auf der Basis"],
    [{ vorhanden: "src/hilfe.js" }, "Stelle nicht in der Form <Datei>:<von>-<bis>"],
    [{ neu: "src/neu.js:3-1" }, "Stelle nicht in der Form <Datei>:<von>-<bis>"],
  ];
  for (const [felder, grund] of faelle) assert.deepEqual(belegeEinen(umgebung, shas[0], felder), [false, grund], grund);
});

test("verschobener Code ist kein Nachbau, weil die neue Stelle schon in einer anderen Datei der Basis stand", (context) => {
  const repo = probeRepo(context, { "src/hilfe.js": HILFE, "src/alt.js": NACHBAU });
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["rm", "-q", "src/alt.js"]);
  const sha = repo.committe({ "src/neu.js": NACHBAU }, NACHRICHT);
  const umgebung = { root: repo.ordner, basis, head: sha, auftragstext: "", nachrichten: [] };
  assert.deepEqual(belegeEinen(umgebung, sha, {}), [false, "neue Stelle stand schon auf der Basis"]);
});

test("eine Anordnung ist belegt, wenn das Zitat mit beliebigem Leerraum im Issue oder in einer Commit-Nachricht steht", (context) => {
  const { umgebung, shas } = lage(context, [{ "src/neu.js": NACHBAU }]);
  const anordnung = (zitat) => ({ umgehung: "anordnung", vorhanden: "", neu: "", zitat });
  const zitat = ANWEISUNG.replace(" damit", "\n  damit");
  const imIssue = { ...umgebung, auftragstext: `Issue #7: Summe\n\n${ANWEISUNG}` };
  const inNachricht = { ...umgebung, nachrichten: [NACHRICHT, `Summe\n\n${ANWEISUNG}\n`] };
  assert.deepEqual(belegeEinen(imIssue, shas[0], anordnung(zitat)), [true, ""]);
  assert.deepEqual(belegeEinen(inNachricht, shas[0], anordnung(ANWEISUNG)), [true, ""]);
  assert.deepEqual(belegeEinen(umgebung, shas[0], anordnung(ANWEISUNG)), [false, "Zitat fehlt in Issue und Commit-Nachrichten"]);
  assert.deepEqual(belegeEinen(imIssue, shas[0], anordnung(" \n ")), [false, "Zitat leer"]);
});

test("nur BLOCKER ohne Sicherheitsmerker mit einer Umgehung werden belegt", (context) => {
  const { umgebung, shas } = lage(context, [{ "src/neu.js": NACHBAU }]);
  const ohneBeleg = [befund({ schwere: "SOLLTE" }), { sicherheit: true, schwere: "BLOCKER" }, befund({ umgehung: undefined })];
  const [commit] = belegeUmgehungen([{ sha: shas[0], befunde: ohneBeleg }], umgebung);
  assert.deepEqual(commit.befunde, ohneBeleg);
});

test("das Modell kann belegt nicht setzen, eine unbekannte Umgehung macht die Antwort ungültig, ergebnis.json behält den Beleg", () => {
  const vomModell = befundeDerAntwort({ befunde: [befund({ belegt: true, belegGrund: "" })] });
  assert.equal("belegt" in vomModell[0], false);
  assert.equal(befundeDerAntwort({ befunde: [befund({ umgehung: "vielleicht" })] }), null);
  const [alt] = befundeDerAntwort({ befunde: [befund({ umgehung: undefined, vorhanden: undefined, neu: undefined, zitat: undefined })] });
  assert.equal("umgehung" in alt, false);
  const commit = { sha: scheinSha("a"), patchId: "", zustand: "geprueft", befunde: [befund({ belegt: true, belegGrund: "" })] };
  const { commits } = ergebnisAus(JSON.stringify({ format: 1, branch: "b", head: scheinSha("a"), commits: [commit] }));
  const [{ belegt, umgehung }] = commits[0].befunde;
  assert.deepEqual([belegt, umgehung], [true, "nachbau"]);
});

test("ein belegter Umgehungs-BLOCKER setzt failure ohne Reproduktion, ein nicht belegter wird ein Issue mit dem Grund", () => {
  const commit = (felder) => ({ sha: scheinSha("b"), patchId: "", zustand: "geprueft", grund: "", befunde: [befund(felder)] });
  const rot = urteile({ commits: [commit({ belegt: true, belegGrund: "" })] });
  assert.deepEqual([rot.state, rot.description, rot.issues], ["failure", "Umgehung belegt: src/neu.js", []]);
  const verworfen = urteile({ commits: [commit({ belegt: false, belegGrund: "vorhandene Stelle im PR geändert" })] });
  assert.equal(verworfen.state, "success");
  assert.deepEqual(verworfen.issues.map(({ grund }) => grund), ["verworfen: vorhandene Stelle im PR geändert"]);
});

function mitNachbauBlocker() {
  const aufnahme = aufzeichnung("gueltig");
  const ergebnis = aufnahme.zeilen.find((zeile) => zeile.type === "result");
  ergebnis.structured_output = { urteil: "NICHT_BESTANDEN", befunde: [befund()] };
  return aufnahme;
}

test("der lokale Prüferlauf belegt einen gemeldeten Nachbau am Repo und schreibt belegt in ergebnis.json", async (context) => {
  const repo = probeRepo(context, { "src/hilfe.js": HILFE });
  repo.git(["branch", "-M", "master"]);
  repo.git(["checkout", "-q", "-b", "paket/KU2-probe"]);
  repo.committe({ "src/neu.js": NACHBAU }, NACHRICHT);
  const ersatz = ersatzPruefer(context, { aufnahme: mitNachbauBlocker() });
  const route = ["GET /repos/sundartha/hermes/issues/41", { title: "Paket KU2", body: PAKET_ISSUE }];
  const github = await scheinGithub(context, new Map([route]));
  const aus = join(probeDirectory(context, {}), "ergebnis");
  const umgebung = {
    ...isolatedEnvironment(),
    HERMES_CLAUDE: ersatz.programm,
    GH_TOKEN: "schein-gh",
    GITHUB_API_URL: github.url,
    GITHUB_REPOSITORY: "sundartha/hermes",
    CLAUDE_CODE_OAUTH_TOKEN: SCHEIN_TOKEN,
  };
  const args = ["--basis", "master", "--issue", "41", "--aus", aus, "--ablage", `${aus}-ablage`];
  const kind = spawn(process.execPath, [join(REPO_ROOT, "tools/pruefer-lokal.mjs"), ...args], { cwd: repo.ordner, env: umgebung });
  const [status] = await once(kind, "close");
  const { commits } = JSON.parse(readFileSync(join(aus, "ergebnis.json"), "utf8"));
  assert.equal(status, EXIT_BEFUNDE);
  assert.deepEqual(
    commits[0].befunde.map(({ umgehung, belegt, belegGrund }) => [umgehung, belegt, belegGrund]),
    [["nachbau", true, ""]],
  );
});

test("der Prüfer bekommt C1 und C2 mit der Stufe BLOCKER Umgehung, und Anweisung und Schema nennen dieselben Felder", () => {
  const befehl = prueferBefehl({ dateien: ["src/neu.js"], kritisch: false }, "claude");
  const anweisung = befehl[befehl.indexOf("--append-system-prompt") + 1];
  const { befunde } = JSON.parse(befehl[befehl.indexOf("--json-schema") + 1]).properties;
  for (const teil of [
    "`basis/` (jede versionierte Datei auf dem Stand vor dem Pull Request",
    "- C1 Nachbau: Neuer oder geänderter Code baut vorhandenen Code in anderer Schreibweise nach",
    "- C2 Anordnung: Ein Satz im Issue-Text oder in einer Commit-Nachricht",
    "- BLOCKER Umgehung (hält den Pull Request auf, ohne Reproduktion): C1 oder C2 trifft zu.",
    "Kein BLOCKER Umgehung: ähnlicher Aufbau mit anderem Verhalten",
    '"umgehung":"keine|nachbau|anordnung","vorhanden":"","neu":"","zitat":""',
  ]) {
    assert.ok(anweisung.includes(teil), teil);
  }
  const { umgehung, vorhanden, neu, zitat } = befunde.items.properties;
  assert.deepEqual(umgehung.enum, ["keine", "nachbau", "anordnung"]);
  assert.deepEqual([vorhanden, neu, zitat].map(({ type }) => type), ["string", "string", "string"]);
  assert.ok(["umgehung", "vorhanden", "neu", "zitat"].every((feld) => befunde.items.required.includes(feld)));
});
