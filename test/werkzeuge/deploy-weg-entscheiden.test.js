import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  anfragenAn,
  COMMIT_C,
  COMMIT_P,
  entscheidenMit,
  GITHUB_TOKEN,
  HTTP_NICHT_GEFUNDEN,
  laufEreignis,
  PR_KOPF,
  temporaerOrdner,
  weltAnlegen,
} from "./deploy-weg-attrappe.mjs";

const FREMDE_APP = 4242;
const GRUENE_CHECKS = weltAnlegen().checks;

function rotPruefen(lauf, erwartet) {
  assert.equal(lauf.ergebnis.ok, false);
  assert.equal(lauf.ergebnis.deploy, false);
  assert.equal(lauf.ergebnis.hoertest, false);
  assert.match(lauf.text, erwartet);
  assert.match(lauf.text, /Entscheidung: deploy nein, hoertest nein/);
  assert.deepEqual(lauf.abdruck.aufrufe, []);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", /deploys/), []);
}

test("entscheiden grün: grüner Staging-Push, gemergter PR, grüne Pflicht-Checks und gleiches Gespräch ergeben deploy ja", async (kontext) => {
  const datei = join(temporaerOrdner(kontext), "ausgaben");
  writeFileSync(datei, "");
  const lauf = await entscheidenMit(kontext, { mehr: { GITHUB_OUTPUT: datei } });
  assert.equal(lauf.ergebnis.ok, true);
  assert.equal(lauf.ergebnis.deploy, true);
  assert.equal(lauf.ergebnis.hoertest, false);
  assert.deepEqual(
    lauf.abdruck.aufrufe.map(({ alt, neu }) => [alt, neu]),
    [[COMMIT_P, COMMIT_C]],
  );
  const erwartet = ["deploy=ja", "hoertest=nein", "commit=" + COMMIT_C, "produktion=" + COMMIT_P];
  assert.equal(readFileSync(datei, "utf8"), [...erwartet, "teile=", ""].join("\n"));
  const github = anfragenAn(lauf.attrappe, "GET", /^\/gh\//);
  assert.ok(github.length > 0);
  assert.ok(github.every((anfrage) => anfrage.kopf === "Bearer " + GITHUB_TOKEN));
  assert.equal(anfragenAn(lauf.attrappe, "GET", /check-runs/).length, GRUENE_CHECKS.length);
  assert.ok(anfragenAn(lauf.attrappe, "GET", /check-runs/).every(({ pfad }) => pfad.includes(PR_KOPF)));
});

test("entscheiden rot: der Staging-Lauf ist nicht success", async (kontext) => {
  const lauf = await entscheidenMit(kontext, { ereignis: laufEreignis({ conclusion: "failure" }) });
  rotPruefen(lauf, /Rot: der Staging-Lauf ist nicht grün \(failure\)/);
});

test("entscheiden rot: der Staging-Lauf kam von einem Hand-Start statt von einem Push auf master", async (kontext) => {
  const ereignis = laufEreignis({ event: "workflow_dispatch" });
  rotPruefen(await entscheidenMit(kontext, { ereignis }), /nicht von einem Push auf master/);
});

test("entscheiden rot: der Staging-Lauf lief auf einem anderen Branch als master", async (kontext) => {
  const ereignis = laufEreignis({ head_branch: "feature" });
  rotPruefen(await entscheidenMit(kontext, { ereignis }), /nicht von einem Push auf master/);
});

test("entscheiden rot: Fork-PR mit Branch master, der Staging-Lauf gehört zu einem fremden Repository", async (kontext) => {
  const ereignis = laufEreignis({ head_repository: { full_name: "fremd/hermes" } });
  rotPruefen(await entscheidenMit(kontext, { ereignis }), /gehört nicht zu diesem Repository/);
});

test("entscheiden rot: der Commit ist nicht der Merge-Commit eines gemergten PR", async (kontext) => {
  const [pr] = weltAnlegen().pulls;
  const welt = { pulls: [{ ...pr, merged_at: null }] };
  rotPruefen(await entscheidenMit(kontext, { welt }), /nicht der Merge-Commit eines gemergten PR/);
});

test("entscheiden rot: der Commit gehört zu einem PR, ist aber nicht dessen Merge-Commit", async (kontext) => {
  const [pr] = weltAnlegen().pulls;
  const welt = { pulls: [{ ...pr, merge_commit_sha: COMMIT_P }] };
  const lauf = await entscheidenMit(kontext, { welt });
  rotPruefen(lauf, /nicht der Merge-Commit eines gemergten PR/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", /check-runs/), []);
});

test("entscheiden rot: ein Pflicht-Check aus den Regeln für master fehlt auf dem PR-Kopf", async (kontext) => {
  const welt = { checks: GRUENE_CHECKS.filter(({ name }) => name !== "Freigabe-Prüfung") };
  rotPruefen(await entscheidenMit(kontext, { welt }), /Pflicht-Check Freigabe-Prüfung fehlt/);
});

test("entscheiden rot: ein Pflicht-Check stammt von einer fremden App statt von GitHub Actions", async (kontext) => {
  const welt = {
    checks: GRUENE_CHECKS.map((lauf) =>
      lauf.name === "CI" ? { ...lauf, app: { id: FREMDE_APP } } : lauf,
    ),
  };
  rotPruefen(await entscheidenMit(kontext, { welt }), /Pflicht-Check CI stammt nicht von GitHub Actions/);
});

test("entscheiden rot: die Regel verlangt einen Pflicht-Check einer anderen App als GitHub Actions", async (kontext) => {
  const regel = {
    type: "required_status_checks",
    parameters: { required_status_checks: [{ context: "CI", integration_id: FREMDE_APP }] },
  };
  const welt = { regeln: [regel] };
  rotPruefen(await entscheidenMit(kontext, { welt }), /Pflicht-Check CI stammt nicht von GitHub Actions/);
});

test("entscheiden rot: ein Pflicht-Check ist nicht success", async (kontext) => {
  const welt = {
    checks: GRUENE_CHECKS.map((lauf) =>
      lauf.name === "CI" ? { ...lauf, conclusion: "failure" } : lauf,
    ),
  };
  rotPruefen(await entscheidenMit(kontext, { welt }), /Pflicht-Check CI ist nicht success \(failure\)/);
});

test("entscheiden rot: die Regeln für master nennen keinen Pflicht-Check", async (kontext) => {
  const welt = { regeln: [{ type: "pull_request", parameters: {} }] };
  rotPruefen(await entscheidenMit(kontext, { welt }), /nennen keine Pflicht-Checks/);
});

test("entscheiden rot: die Regeln für master sind nicht lesbar", async (kontext) => {
  const welt = { regelnStatus: HTTP_NICHT_GEFUNDEN };
  const lauf = await entscheidenMit(kontext, { welt });
  rotPruefen(lauf, /GitHub-API antwortet im Schritt pflicht_checks mit HTTP 404/);
});

test("entscheiden rot: der Produktions-Commit aus /healthz ist unbekannt", async (kontext) => {
  const welt = { produktion: ["unbekannt"] };
  rotPruefen(await entscheidenMit(kontext, { welt }), /Produktions-Commit aus \/healthz ist unbekannt/);
});

test("entscheiden rot: der Kandidat ist älter als der Produktions-Commit", async (kontext) => {
  const welt = { vergleiche: { [COMMIT_P + "..." + COMMIT_C]: "behind" } };
  rotPruefen(await entscheidenMit(kontext, { welt }), /nicht neuer als Produktion \(behind\)/);
});

test("entscheiden rot: der Kandidat liegt nicht auf master", async (kontext) => {
  const welt = { vergleiche: { ["master..." + COMMIT_C]: "diverged" } };
  rotPruefen(await entscheidenMit(kontext, { welt }), /liegt nicht auf master \(diverged\)/);
});

test("entscheiden grün ohne Deploy: Produktion fährt den Kandidaten schon (identical)", async (kontext) => {
  const lauf = await entscheidenMit(kontext, { welt: { produktion: [COMMIT_C] } });
  assert.equal(lauf.ergebnis.ok, true);
  assert.equal(lauf.ergebnis.deploy, false);
  assert.equal(lauf.ergebnis.hoertest, false);
  assert.match(lauf.text, /Nichts zu tun: Produktion fährt bereits diesen Commit/);
  assert.deepEqual(lauf.abdruck.aufrufe, []);
});

test("entscheiden meldet alle Rot-Gründe auf einmal", async (kontext) => {
  const ereignis = laufEreignis({ conclusion: "cancelled", head_repository: { full_name: "x/y" } });
  const welt = { pulls: [], produktion: ["unbekannt"] };
  const lauf = await entscheidenMit(kontext, { ereignis, welt });
  rotPruefen(lauf, /nicht grün \(cancelled\)/);
  assert.match(lauf.text, /gehört nicht zu diesem Repository/);
  assert.match(lauf.text, /nicht der Merge-Commit eines gemergten PR/);
  assert.match(lauf.text, /Produktions-Commit aus \/healthz ist unbekannt/);
});

test("entscheiden rot: unbekanntes Ereignis", async (kontext) => {
  const lauf = await entscheidenMit(kontext, { ereignis: { name: "push", nutzlast: {} } });
  rotPruefen(lauf, /unbekanntes oder unvollständiges Ereignis/);
  assert.equal(lauf.ergebnis.commit, null);
});
