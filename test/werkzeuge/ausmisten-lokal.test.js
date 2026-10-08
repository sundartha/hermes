import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { probeDirectory } from "./probe-repo.js";
import { DOPPELT, RECHNEN_TEST, ausmistenRepo, starte } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, EXIT_ROT, WIRKSAME_TESTS, messeUndMelde } from "./ausmisten/messung.mjs";
import { KUERZEN, MIT_TEXT, TEXTTEST, VERHALTEN, fall, texttest } from "./ausmisten/texttest.mjs";
import { scheinGitleaks, verlinkeLintWerkzeuge, vorpruefDateien } from "./ausmisten/vorpruefen.mjs";

const WERKZEUG = "tools/tests-ausmisten.mjs";

function lokalesRepo(context, weg, { dateien = {}, neu = {} } = {}) {
  const protokoll = join(probeDirectory(context, {}), "aufrufe.txt");
  const repo = ausmistenRepo(context, {
    ...WIRKSAME_TESTS,
    ...vorpruefDateien(protokoll),
    ...dateien,
  });
  verlinkeLintWerkzeuge(repo.ordner);
  const kopf = repo.committe(neu, weg);
  repo.git(["checkout", "-q", repo.master]);
  return { ...repo, kopf, gitleaks: scheinGitleaks(context, { protokoll }) };
}

async function lokal(context, repo, zusatz = []) {
  const aus = probeDirectory(context, {});
  const args = [
    "lokal",
    "--bereich",
    "posteingang",
    "--master",
    repo.master,
    "--kopf",
    repo.kopf,
    "--aus",
    aus,
    "--gitleaks",
    repo.gitleaks,
    ...zusatz,
  ];
  const ergebnis = await starte(WERKZEUG, { args, cwd: repo.ordner, umgebung: {} });
  return { ...ergebnis, aus };
}

function artefakt(aus, name) {
  return JSON.parse(readFileSync(join(aus, name, `${name}.json`), "utf8"));
}

test("ausmisten-lokal: ein Branch ohne Verlust ist lokal grün", async (context) => {
  const ergebnis = await lokal(context, lokalesRepo(context, [DOPPELT]));
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Lokal: grün/);
});

test("ausmisten-lokal: ein verlorener Mutant macht die lokale Messung früh rot und nennt ihn", async (context) => {
  const ergebnis = await lokal(context, lokalesRepo(context, [RECHNEN_TEST]));
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(
    ergebnis.ausgabe,
    /Verstoß: Mutant auf dem Branch nicht mehr getötet: src\/fremd\/rechnen\.js:2:/,
  );
  assert.match(
    ergebnis.ausgabe,
    /Lokal: rot in Paket 0; die übrigen Pakete werden nicht gemessen\./,
  );
  assert.doesNotMatch(ergebnis.ausgabe, /Lokal: grün/);
});

test("ausmisten-lokal: lokal und CI messen dieselben Mutanten mit demselben Ergebnis", async (context) => {
  const ci = await messeUndMelde(context, { weg: [RECHNEN_TEST] });
  const lokalesErgebnis = await lokal(context, lokalesRepo(context, [RECHNEN_TEST]));
  const basisLokal = artefakt(lokalesErgebnis.aus, "basis-0");
  assert.deepEqual(basisLokal.mutanten, ci.gelesen.mutanten);
  assert.deepEqual(basisLokal.gate, ci.gelesen.gate);
  assert.deepEqual(
    artefakt(lokalesErgebnis.aus, "branch-0").mutanten,
    artefakt(ci.artefakte, "branch-0").mutanten,
  );
  assert.equal(lokalesErgebnis.status, ci.melden.status);
});

test("ausmisten-lokal: ein Zwischenspeicher liefert beim zweiten Lauf dieselbe Basis ohne neue Messung", async (context) => {
  const repo = lokalesRepo(context, [DOPPELT]);
  const speicher = probeDirectory(context, {});
  const erster = await lokal(context, repo, ["--speicher", speicher]);
  assert.equal(erster.status, EXIT_GRUEN, erster.ausgabe);
  const zweiter = await lokal(context, repo, ["--speicher", speicher]);
  assert.equal(zweiter.status, EXIT_GRUEN, zweiter.ausgabe);
  assert.match(zweiter.ausgabe, /Basis für Paket 0 wiederverwendet: .* aus Lauf lokal\./);
  const vorher = artefakt(erster.aus, "basis-0");
  const nachher = artefakt(zweiter.aus, "basis-0");
  assert.equal(nachher.wiederverwendet.lauf, "lokal");
  assert.deepEqual(nachher.mutanten, vorher.mutanten);
});

test("ausmisten-lokal: nach dem Lauf bleibt kein zusätzlicher Arbeitsordner zurück", async (context) => {
  const repo = lokalesRepo(context, [DOPPELT]);
  await lokal(context, repo);
  const liste = repo.git(["worktree", "list", "--porcelain"]).stdout;
  assert.equal(liste.match(/^worktree /gm).length, 1, liste);
});

test("ausmisten-lokal: ohne --master bricht der Befehl mit der Aufrufhilfe ab", async (context) => {
  const repo = lokalesRepo(context, [DOPPELT]);
  const ergebnis = await starte(WERKZEUG, {
    args: ["lokal", "--bereich", "posteingang"],
    cwd: repo.ordner,
    umgebung: {},
  });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /lokal --bereich <name> --master <rev>/);
});

const EXIT_FREIGABE = 3;

test("ausmisten-lokal: ein gelöschter ausgenommener Texttest endet mit Exit 3 und nennt Fall und Freigabe", async (context) => {
  const repo = lokalesRepo(context, [], {
    dateien: { [TEXTTEST]: MIT_TEXT },
    neu: { [TEXTTEST]: texttest(fall(VERHALTEN, KUERZEN)) },
  });
  const ergebnis = await lokal(context, repo);
  assert.equal(ergebnis.status, EXIT_FREIGABE, ergebnis.ausgabe);
  assert.match(
    ergebnis.ausgabe,
    /Ausgenommen: test\/post\/text\.test\.js: liest den Quelltext \(umgebaute Datei src\/post\/eingang\.js, im Branch gelöscht\)/,
  );
  assert.match(
    ergebnis.ausgabe,
    /Freigabe nötig: Ausgenommener Testfall im Branch gelöscht: test\/post\/text\.test\.js: liest den Quelltext/,
  );
  assert.doesNotMatch(ergebnis.ausgabe, /Lokal: grün\n/);
});
