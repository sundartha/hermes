import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AUFWACHEN_SCHUTZGRENZE_MS,
  AUFWACHEN_TAKT_MS,
  FRISCH_GEWECKT_AB_MS,
} from "../../tools/deploy-weg/takt.mjs";
import {
  anfragenAn,
  COMMIT_C,
  COMMIT_P,
  entscheidenMit,
  GITHUB_TOKEN,
  HTML_MIT_COMMIT,
  HTTP_NICHT_GEFUNDEN,
  HTTP_OK,
  JSON_OHNE_COMMIT,
  LADESEITE,
  laufEreignis,
  PR_KOPF,
  temporaerOrdner,
  weltAnlegen,
} from "./deploy-weg-attrappe.mjs";

const FREMDE_APP = 4242;
const GRUENE_CHECKS = weltAnlegen().checks;
const PROD_HEALTHZ = /^\/prod\/healthz$/;
const LANGSAME_ANTWORT_MS = 40_000;
const ZWEI_ANFRAGEN = 2;
const DREI_WECKVERSUCHE = 3;
const KURZE_COMMIT_LAENGE = 7;
const KURZER_COMMIT = COMMIT_P.slice(0, KURZE_COMMIT_LAENGE);
const JSON_MIT_KURZEM_COMMIT = Object.freeze([HTTP_OK, { ok: true, commit: KURZER_COMMIT }]);

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
  const ende = ["teile=", "frisch_geweckt=nein", ""];
  assert.equal(readFileSync(datei, "utf8"), [...erwartet, ...ende].join("\n"));
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

function healthzAnfragen(lauf) {
  return anfragenAn(lauf.attrappe, "GET", PROD_HEALTHZ);
}

test("entscheiden: Produktion schläft, wacht innerhalb der Grenze auf, danach läuft die Messung normal und frisch_geweckt=ja geht an deploy", async (kontext) => {
  const datei = join(temporaerOrdner(kontext), "ausgaben");
  writeFileSync(datei, "");
  const welt = { wach: [false, false, true] };
  const lauf = await entscheidenMit(kontext, { welt, mehr: { GITHUB_OUTPUT: datei } });
  assert.equal(lauf.ergebnis.ok, true);
  assert.equal(lauf.ergebnis.deploy, true);
  assert.equal(lauf.ergebnis.produktion, COMMIT_P);
  assert.equal(lauf.ergebnis.frischGeweckt, true);
  assert.deepEqual(lauf.uhr.wartezeiten, [AUFWACHEN_TAKT_MS, AUFWACHEN_TAKT_MS]);
  assert.equal(healthzAnfragen(lauf).length, DREI_WECKVERSUCHE + 1);
  assert.match(lauf.text, /Produktion hat geschlafen und ist frisch geweckt/);
  assert.match(lauf.text, new RegExp("Produktion fährt: " + COMMIT_P));
  const zeilen = readFileSync(datei, "utf8").split("\n");
  assert.ok(zeilen.includes("deploy=ja"));
  assert.ok(zeilen.includes("frisch_geweckt=ja"));
});

test("entscheiden rot: Produktion wacht nicht innerhalb von 5 Minuten auf (rot_aufwachen_zeitgrenze), ohne Messung", async (kontext) => {
  const lauf = await entscheidenMit(kontext, { welt: { wach: [false] } });
  rotPruefen(lauf, /Rot: Produktion ist im Schritt produktion nach 5 Minuten nicht aufgewacht/);
  assert.equal(lauf.uhr.jetzt(), AUFWACHEN_SCHUTZGRENZE_MS);
  assert.equal(healthzAnfragen(lauf).length, AUFWACHEN_SCHUTZGRENZE_MS / AUFWACHEN_TAKT_MS);
  assert.equal(lauf.ergebnis.produktion, null);
  assert.equal(lauf.ergebnis.frischGeweckt, false);
});

test("entscheiden rot: Ladeseite mit HTTP 200, JSON ohne Commit und HTML mit Commit zählen nicht als wach", async (kontext) => {
  for (const schlafAntwort of [LADESEITE, JSON_OHNE_COMMIT, HTML_MIT_COMMIT]) {
    const lauf = await entscheidenMit(kontext, { welt: { wach: [false], schlafAntwort } });
    rotPruefen(lauf, /im Schritt produktion nach 5 Minuten nicht aufgewacht/);
  }
});

test("entscheiden rot: JSON mit kurzem commit (7 Zeichen) zählt nicht als wach", async (kontext) => {
  const welt = { wach: [false], schlafAntwort: JSON_MIT_KURZEM_COMMIT };
  const lauf = await entscheidenMit(kontext, { welt });
  rotPruefen(lauf, /im Schritt produktion nach 5 Minuten nicht aufgewacht/);
  assert.equal(lauf.ergebnis.produktion, null);
});

test("entscheiden rot: Produktion ist wach, die Messung danach scheitert ohne Wiederholung", async (kontext) => {
  const lauf = await entscheidenMit(kontext, { welt: { wach: [true, false] } });
  rotPruefen(lauf, /Produktions-Commit aus \/healthz ist unbekannt/);
  assert.doesNotMatch(lauf.text, /nicht aufgewacht/);
  assert.equal(healthzAnfragen(lauf).length, ZWEI_ANFRAGEN);
  assert.deepEqual(lauf.uhr.wartezeiten, []);
});

test("entscheiden: eine erste Weck-Antwort nach 40 Sekunden gilt als frisch geweckt, eine nach 15 Sekunden nicht", async (kontext) => {
  const langsam = await entscheidenMit(kontext, { welt: { healthzDauerMs: [LANGSAME_ANTWORT_MS, 0] } });
  assert.equal(langsam.ergebnis.deploy, true);
  assert.equal(langsam.ergebnis.frischGeweckt, true);
  assert.deepEqual(langsam.uhr.wartezeiten, []);
  const schnell = await entscheidenMit(kontext, { welt: { healthzDauerMs: [FRISCH_GEWECKT_AB_MS, 0] } });
  assert.equal(schnell.ergebnis.deploy, true);
  assert.equal(schnell.ergebnis.frischGeweckt, false);
});
