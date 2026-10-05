import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  abdruckAttrappe,
  anfragenAn,
  COMMIT_C,
  COMMIT_P,
  entscheidenMit,
  handEreignis,
  NEUERER,
  temporaerOrdner,
  weltAnlegen,
} from "./deploy-weg-attrappe.mjs";

const GEAENDERT = { geaendert: true, teile: ["anrufstart.de.eigentuemer", "prompts/de.js:SYSTEM"] };
const [GRUENER_STAGING_LAUF] = weltAnlegen().stagingLaeufe;

function keinDeploy(lauf) {
  assert.equal(lauf.ergebnis.deploy, false);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", /deploys/), []);
}

test("Hand-Start rot: ausgelöst von einem Nutzer ohne Freigaberecht", async (kontext) => {
  const lauf = await entscheidenMit(kontext, { ereignis: handEreignis({ login: "fremder" }) });
  keinDeploy(lauf);
  assert.equal(lauf.ergebnis.ok, false);
  assert.match(lauf.text, /Rot: Hand-Start durch einen Nutzer ohne Freigaberecht/);
});

test("Hand-Start rot: Antonio20045 startet, aber ein fremder Nutzer wiederholt den Lauf", async (kontext) => {
  const mehr = { GITHUB_ACTOR: "Antonio20045", GITHUB_TRIGGERING_ACTOR: "fremder" };
  const lauf = await entscheidenMit(kontext, { ereignis: handEreignis(), mehr });
  keinDeploy(lauf);
  assert.match(lauf.text, /Hand-Start durch einen Nutzer ohne Freigaberecht/);
});

test("Hand-Start rot: nicht auf master gestartet", async (kontext) => {
  const ereignis = handEreignis({ ref: "refs/heads/feature" });
  const lauf = await entscheidenMit(kontext, { ereignis });
  keinDeploy(lauf);
  assert.equal(lauf.ergebnis.ok, false);
  assert.match(lauf.text, /Rot: Hand-Start nicht auf master/);
});

test("Hand-Start rot: GITHUB_REF zeigt nicht auf master", async (kontext) => {
  const mehr = { GITHUB_REF: "refs/heads/feature" };
  const lauf = await entscheidenMit(kontext, { ereignis: handEreignis(), mehr });
  keinDeploy(lauf);
  assert.match(lauf.text, /Rot: Hand-Start nicht auf master/);
});

test("Hand-Start rot: kein grüner Push-Lauf von staging für genau diesen Commit", async (kontext) => {
  const welt = { stagingLaeufe: [{ ...GRUENER_STAGING_LAUF, head_sha: NEUERER }] };
  const lauf = await entscheidenMit(kontext, { ereignis: handEreignis(), welt });
  keinDeploy(lauf);
  assert.match(lauf.text, /Rot: kein grüner Push-Lauf von staging für genau diesen Commit/);
  const [anfrage] = anfragenAn(lauf.attrappe, "GET", /staging\.yml\/runs/);
  assert.ok(anfrage.pfad.includes("head_sha=" + COMMIT_C));
});

test("Hand-Start rot: der einzige staging-Lauf für den Commit war selbst ein Hand-Start", async (kontext) => {
  const welt = { stagingLaeufe: [{ ...GRUENER_STAGING_LAUF, event: "workflow_dispatch" }] };
  const lauf = await entscheidenMit(kontext, { ereignis: handEreignis(), welt });
  keinDeploy(lauf);
  assert.match(lauf.text, /kein grüner Push-Lauf von staging/);
});

test("Hand-Start rot: der staging-Lauf für den Commit kam aus einem fremden Repository", async (kontext) => {
  const fremd = { ...GRUENER_STAGING_LAUF, head_repository: { full_name: "fremd/hermes" } };
  const lauf = await entscheidenMit(kontext, { ereignis: handEreignis(), welt: { stagingLaeufe: [fremd] } });
  keinDeploy(lauf);
  assert.match(lauf.text, /kein grüner Push-Lauf von staging/);
});

test("Hand-Start grün: Antonio20045 bestätigt bei geändertem Gespräch den Hörtest, deploy ja", async (kontext) => {
  const abdruck = abdruckAttrappe(GEAENDERT);
  const mehr = { GITHUB_ACTOR: "Antonio20045", GITHUB_REF: "refs/heads/master" };
  const lauf = await entscheidenMit(kontext, { ereignis: handEreignis(), abdruck, mehr });
  assert.equal(lauf.ergebnis.ok, true);
  assert.equal(lauf.ergebnis.deploy, true);
  assert.equal(lauf.ergebnis.hoertest, false);
  assert.match(lauf.text, /Hörtest gilt als bestätigt/);
  assert.equal(lauf.ergebnis.commit, COMMIT_C);
});

test("Gespräch geändert: Hörtest statt Deploy, die Teile stehen in den Ausgaben", async (kontext) => {
  const datei = join(temporaerOrdner(kontext), "ausgaben");
  writeFileSync(datei, "");
  const abdruck = abdruckAttrappe(GEAENDERT);
  const lauf = await entscheidenMit(kontext, { abdruck, mehr: { GITHUB_OUTPUT: datei } });
  keinDeploy(lauf);
  assert.equal(lauf.ergebnis.ok, true);
  assert.equal(lauf.ergebnis.hoertest, true);
  assert.deepEqual(lauf.ergebnis.teile, GEAENDERT.teile);
  assert.match(lauf.text, /Geänderter Teil des Gesprächsabdrucks: anrufstart\.de\.eigentuemer/);
  const zeilen = readFileSync(datei, "utf8").split("\n");
  assert.ok(zeilen.includes("deploy=nein"));
  assert.ok(zeilen.includes("hoertest=ja"));
  assert.ok(zeilen.includes("teile=" + GEAENDERT.teile.join(",")));
  assert.deepEqual(abdruck.aufrufe, [{ repoDir: process.cwd(), alt: COMMIT_P, neu: COMMIT_C }]);
});

test("Gesprächsabgleich wirft einen Fehler: das zählt als geändertes Gespräch", async (kontext) => {
  const abdruck = abdruckAttrappe(new Error("abdruck kaputt"));
  const lauf = await entscheidenMit(kontext, { abdruck });
  keinDeploy(lauf);
  assert.equal(lauf.ergebnis.hoertest, true);
  assert.deepEqual(lauf.ergebnis.teile, ["abgleich-gescheitert"]);
  assert.match(lauf.text, /Gesprächsabgleich gescheitert/);
});

test("Gesprächsabgleich mit unzulässigem Teil-Namen: nichts davon landet im Log", async (kontext) => {
  const abdruck = abdruckAttrappe({ geaendert: true, teile: ["+49 151 1234 5678"] });
  const lauf = await entscheidenMit(kontext, { abdruck });
  keinDeploy(lauf);
  assert.equal(lauf.ergebnis.hoertest, true);
  assert.ok(!lauf.text.includes("1234"));
  assert.deepEqual(lauf.ergebnis.teile, ["abgleich-gescheitert"]);
});

test("Hand-Start rot: der Lauf gehört zu einem fremden Repository", async (kontext) => {
  const ereignis = handEreignis();
  const nutzlast = { ...ereignis.nutzlast, repository: { full_name: "fremd/hermes" } };
  const lauf = await entscheidenMit(kontext, { ereignis: { ...ereignis, nutzlast } });
  keinDeploy(lauf);
  assert.match(lauf.text, /gehört nicht zu diesem Repository/);
});
