import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { HILFE, NEGATIV, TESTBANK, ZAHLTEST, ghAttrappe, holeVorergebnis, nachrundeRepo, quelle, temporaer, werkzeugLauf } from "./mutationspruefung-nachrunde-hilfen.js";

export const GEAENDERT = '  if (zahl <= -1) return "negativ";';
const ANDERE = "export const ANDERE = 1;\n";
const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/hilfe.js": HILFE,
  "test/testbaenke-run.mjs": TESTBANK,
  "test/zahl.test.js": ZAHLTEST,
};

function rev(repo, ref) {
  const lauf = runIn(repo, "git", ["rev-parse", ref]);
  assert.equal(lauf.status, 0, lauf.stderr);
  return lauf.stdout.trim();
}

export function messeAlteSeite(repo, basis, { datei, zusatz = [] }) {
  const lauf = werkzeugLauf(repo, ["--basis", basis, "--alter-stand", "--teil", "1", "--teile", "1", "--ergebnis", datei, ...zusatz]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return lauf.stdout;
}

export function lesePruefung(datei) {
  return JSON.parse(readFileSync(datei, "utf8"));
}

export function zahlGemessen(teil) {
  return teil.messungen.flatMap(({ ergebnisse }) => ergebnisse).length;
}

export function vorlaufAlteSeite(aufraeumer) {
  const repo = probeRepository({ after: (aufgabe) => aufraeumer.push(aufgabe) }, BASIS);
  const ursprung = rev(repo, "HEAD");
  writeFiles(repo, { "src/andere.js": ANDERE });
  commitAll(repo, "Basis des Vorlaufs");
  const basis = rev(repo, "HEAD");
  writeFiles(repo, { "src/zahl.js": quelle(GEAENDERT) });
  commitAll(repo, "Runde 1");
  const ordner = temporaer(aufraeumer, "uebernahme-vorlauf-");
  messeAlteSeite(repo, basis, { datei: join(ordner, "mutation-teil-1.json") });
  const artefakte = temporaer(aufraeumer, "uebernahme-artefakte-");
  mkdirSync(join(artefakte, "mutation-teil-1"));
  cpSync(join(ordner, "mutation-teil-1.json"), join(artefakte, "mutation-teil-1", "mutation-teil-1.json"));
  return { repo, basis, ursprung, kopf: rev(repo, "HEAD"), artefakte, ordner };
}

export function folgerundeAlteSeite(vorlauf, aufraeumer, { dateien, basis = vorlauf.basis }) {
  const repo = nachrundeRepo(vorlauf, aufraeumer, { dateien });
  const attrappe = ghAttrappe(vorlauf, aufraeumer);
  const vorergebnis = join(temporaer(aufraeumer, "uebernahme-vorergebnis-"), "vorergebnis.json");
  const geholt = holeVorergebnis(repo, attrappe, { ziel: vorergebnis, basis });
  assert.equal(geholt.status, 0, geholt.stdout + geholt.stderr);
  const ordner = temporaer(aufraeumer, "uebernahme-folgerunde-");
  const ausgabe = messeAlteSeite(repo, basis, { datei: join(ordner, "mutation-teil-1.json"), zusatz: ["--vorergebnis", vorergebnis] });
  return { ausgabe, ordner, teil: lesePruefung(join(ordner, "mutation-teil-1.json")) };
}
