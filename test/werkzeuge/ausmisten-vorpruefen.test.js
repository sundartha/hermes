import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { probeDirectory } from "./probe-repo.js";
import { DOPPELT, ausmistenRepo, starte } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, EXIT_ROT, WIRKSAME_TESTS } from "./ausmisten/messung.mjs";
import {
  FUND,
  WERKZEUG_PRUEFUNGEN,
  aufrufe,
  scheinGitleaks,
  verlinkeLintWerkzeuge,
  vorpruefDateien,
} from "./ausmisten/vorpruefen.mjs";

const WERKZEUG = "tools/tests-ausmisten.mjs";
const GEAENDERTER_TEST = "test/post/eingang.test.js";
const UNGENUTZT = "const ungenutzt = 1;\n";
const UEBERLANG = 80;
const LANGE_ZEILE = `Probe ${"x".repeat(UEBERLANG)}`;
const PROBE_IDENTITAET = [
  "-c",
  "user.name=Probe",
  "-c",
  "user.email=probe@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

function vorpruefRepo(context, aenderung = {}) {
  const protokoll = join(probeDirectory(context, {}), "aufrufe.txt");
  const repo = ausmistenRepo(context, { ...WIRKSAME_TESTS, ...vorpruefDateien(protokoll) });
  verlinkeLintWerkzeuge(repo.ordner);
  const kopf = repo.committe(aenderung.neu ?? {}, aenderung.weg ?? [DOPPELT]);
  repo.git(["checkout", "-q", repo.master]);
  return { ...repo, kopf, protokoll };
}

async function vorpruefen(context, repo, gitleaks) {
  const args = ["vorpruefen", "--kopf", repo.kopf, "--aus", probeDirectory(context, {})];
  const mitGitleaks = gitleaks === undefined ? args : [...args, "--gitleaks", gitleaks];
  return starte(WERKZEUG, { args: mitGitleaks, cwd: repo.ordner, umgebung: {} });
}

async function lokal(context, repo, gitleaks) {
  const aus = probeDirectory(context, {});
  const basis = ["lokal", "--bereich", "posteingang", "--master", repo.master];
  const args = [...basis, "--kopf", repo.kopf, "--aus", aus];
  const mitGitleaks = gitleaks === undefined ? args : [...args, "--gitleaks", gitleaks];
  const ergebnis = await starte(WERKZEUG, { args: mitGitleaks, cwd: repo.ordner, umgebung: {} });
  return { ...ergebnis, aus };
}

function erwarteNichtsGemessen(ergebnis) {
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Lokal: rot vor der Messung; es wurde nichts gemessen\./);
  assert.doesNotMatch(ergebnis.ausgabe, /Lokal: planen/);
  assert.equal(existsSync(join(ergebnis.aus, "plan")), false);
}

test("ausmisten-vorpruefen: eine ungenutzte Variable im geänderten Test macht lokal rot, bevor etwas gemessen wird", async (context) => {
  const repo = vorpruefRepo(context, { neu: { [GEAENDERTER_TEST]: UNGENUTZT } });
  const gitleaks = scheinGitleaks(context, { protokoll: repo.protokoll });
  const ergebnis = await lokal(context, repo, gitleaks);
  erwarteNichtsGemessen(ergebnis);
  assert.match(ergebnis.ausgabe, /'ungenutzt' is assigned a value but never used/);
  assert.match(ergebnis.ausgabe, /Vorprüfung rot: Lint rot \(1\)/);
});

test("ausmisten-vorpruefen: ein Fund des Secret-Scans im Branch macht lokal rot, bevor etwas gemessen wird", async (context) => {
  const repo = vorpruefRepo(context, { neu: { "test/post/notiz.txt": `${FUND}\n` } });
  const gitleaks = scheinGitleaks(context, { protokoll: repo.protokoll });
  const ergebnis = await lokal(context, repo, gitleaks);
  erwarteNichtsGemessen(ergebnis);
  assert.match(ergebnis.ausgabe, /Vorprüfung rot: Secret-Scan rot \(1\)/);
});

test("ausmisten-vorpruefen: lokal ohne --gitleaks ist rot und misst nichts", async (context) => {
  const repo = vorpruefRepo(context);
  const ergebnis = await lokal(context, repo, undefined);
  erwarteNichtsGemessen(ergebnis);
  assert.match(ergebnis.ausgabe, /Die Option --gitleaks <pfad> fehlt/);
  assert.deepEqual(aufrufe(repo.protokoll), []);
});

test("ausmisten-vorpruefen: ein gitleaks in anderer Version ist rot", async (context) => {
  const repo = vorpruefRepo(context);
  const gitleaks = scheinGitleaks(context, { protokoll: repo.protokoll, version: "8.18.0" });
  const ergebnis = await vorpruefen(context, repo, gitleaks);
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /ist nicht gitleaks 8\.30\.1 \(gemeldet: 8\.18\.0\)/);
  assert.deepEqual(aufrufe(repo.protokoll), []);
});

test("ausmisten-vorpruefen: der Secret-Scan läuft wie in der CI genau über die Commits des Branches", async (context) => {
  const repo = vorpruefRepo(context);
  const gitleaks = scheinGitleaks(context, { protokoll: repo.protokoll });
  const ergebnis = await vorpruefen(context, repo, gitleaks);
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Vorprüfung: grün/);
  const scan = aufrufe(repo.protokoll).filter((zeile) => zeile.startsWith("gitleaks "));
  assert.deepEqual(scan, [
    `gitleaks git --config gitleaks.toml --redact --verbose --no-banner --exit-code 1 --log-opts=${repo.master}..${repo.kopf} .`,
  ]);
});

test("ausmisten-vorpruefen: ein Fund, der schon auf master liegt, gehört nicht zum Branch", async (context) => {
  const protokoll = join(probeDirectory(context, {}), "aufrufe.txt");
  const dateien = { ...WIRKSAME_TESTS, ...vorpruefDateien(protokoll), "alt.txt": `${FUND}\n` };
  const repo = ausmistenRepo(context, dateien);
  verlinkeLintWerkzeuge(repo.ordner);
  const kopf = repo.committe({}, [DOPPELT]);
  repo.git(["checkout", "-q", repo.master]);
  const gitleaks = scheinGitleaks(context, { protokoll });
  const ergebnis = await vorpruefen(context, { ...repo, kopf }, gitleaks);
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
});

test("ausmisten-vorpruefen: eine zu lange erste Commit-Zeile macht die Commit-Prüfung rot", async (context) => {
  const repo = vorpruefRepo(context);
  repo.git(["checkout", "-q", repo.kopf]);
  repo.git([...PROBE_IDENTITAET, "commit", "-q", "--amend", "-m", LANGE_ZEILE]);
  const lang = repo.git(["rev-parse", "HEAD"]).stdout.trim();
  repo.git(["checkout", "-q", repo.master]);
  const gitleaks = scheinGitleaks(context, { protokoll: repo.protokoll });
  const ergebnis = await vorpruefen(context, { ...repo, kopf: lang }, gitleaks);
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /header-max-length/);
  assert.match(ergebnis.ausgabe, /Vorprüfung rot: Commit-Prüfung rot \(1\)/);
});

test("ausmisten-vorpruefen: jede Werkzeug-Prüfung läuft gegen master, auch wenn eine andere rot ist", async (context) => {
  const repo = vorpruefRepo(context, {
    neu: { [GEAENDERTER_TEST]: UNGENUTZT, ".rot-neue-kommentare": "\n" },
  });
  const gitleaks = scheinGitleaks(context, { protokoll: repo.protokoll });
  const ergebnis = await vorpruefen(context, repo, gitleaks);
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Vorprüfung rot: Lint rot \(1\)/);
  assert.match(ergebnis.ausgabe, /Vorprüfung rot: Keine neuen Kommentare rot \(1\)/);
  assert.doesNotMatch(ergebnis.ausgabe, /Vorprüfung rot: Kommentar-Wanderung/);
  const werkzeuge = aufrufe(repo.protokoll).filter((zeile) => !zeile.startsWith("gitleaks "));
  assert.deepEqual(
    werkzeuge,
    WERKZEUG_PRUEFUNGEN.map((name) => `${name} --basis ${repo.master}`),
  );
});

test("ausmisten-vorpruefen: nach der Vorprüfung bleibt kein zusätzlicher Arbeitsordner zurück", async (context) => {
  const repo = vorpruefRepo(context, { neu: { [GEAENDERTER_TEST]: UNGENUTZT } });
  const gitleaks = scheinGitleaks(context, { protokoll: repo.protokoll });
  await vorpruefen(context, repo, gitleaks);
  const liste = repo.git(["worktree", "list", "--porcelain"]).stdout;
  assert.equal(liste.match(/^worktree /gm).length, 1, liste);
});
