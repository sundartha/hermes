import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASIS, NEGATIV, NULL, protokollzeilen, quelle, testdatei } from "./mutationspruefung-hilfen.js";
import { isolatedEnvironment, probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const ERSATZ = fileURLToPath(new URL("mutationspruefung-zeitablauf-ersatz.mjs", import.meta.url));
const ZEITGRENZEN = "Zeitgrenze timeoutMS 60 s, Bestätigung 180 s";
const ZEITABLAUF_ZEILE = /^src\/zahl\.js: Zeitabläufe .+$/gm;
const BESTAETIGUNG = "Bestätigung: 1 bestätigt getötet, 3 nur durch Zeitablauf oder Absturz erkannt.";
const URTEIL = "grün: 4 Mutanten in den neuen Zeilen unter src/, keiner überlebt.";

function zeile(zeitablaeufe, mutanten, haenger) {
  return `src/zahl.js: Zeitabläufe ${zeitablaeufe} von ${mutanten} Mutanten, Hänger oder Abstürze in der Bestätigung ${haenger}; ${ZEITGRENZEN}`;
}

function probe(context) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  return repo;
}

function mitErsatz(repo, argumente, umgebung = {}) {
  const lauf = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD", ...argumente], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), ...umgebung },
  });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return lauf.stdout;
}

function zeitablaufzeilen(ausgabe) {
  return [...ausgabe.matchAll(ZEITABLAUF_ZEILE)].map(([gefunden]) => gefunden);
}

test("Gesamtlauf: die Datei nennt ihre Zeitabläufe und Hänger der Bestätigung, ein nur beim dritten Aufruf getöteter Mutant zählt ohne Wiederholung als Hänger, das Urteil bleibt wie es ist", (context) => {
  const ausgabe = mitErsatz(probe(context), []);
  assert.deepEqual(zeitablaufzeilen(ausgabe), [zeile(2, 4, 3)]);
  assert.match(ausgabe, new RegExp(`^${BESTAETIGUNG}$`, "m"));
  assert.match(ausgabe, new RegExp(`^${URTEIL}$`, "m"));
});

test("Gesamtlauf: eine Datei ohne Zeitablauf nennt 0 Zeitabläufe und 0 Hänger, statt die Zahl wegzulassen", (context) => {
  const ausgabe = mitErsatz(probe(context), [], { MUTANTEN_ARTEN: "flink" });
  assert.deepEqual(zeitablaufzeilen(ausgabe), [zeile(0, 1, 0)]);
});

test("Gesamtlauf: ein Mutant, der im ersten Lauf in die Zeitgrenze läuft und im Bestätigungslauf grün bleibt, überlebt ohne Hinweis und zählt nicht als Hänger", (context) => {
  const lauf = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD"], {
    cwd: probe(context),
    encoding: "utf8",
    env: { ...isolatedEnvironment(), MUTANTEN_ARTEN: "lebt" },
  });
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:\S+ .* → lebt$/m);
  assert.match(lauf.stdout, /^Bestätigung: 0 bestätigt getötet, 0 nur durch Zeitablauf oder Absturz erkannt\.$/m);
  assert.deepEqual(zeitablaufzeilen(lauf.stdout), [zeile(0, 1, 0)]);
});

const DREI_ARTEN = ["haenger", "lebt", "getoetet"];
const ZEITGRENZE_ERSTER_LAUF_MS = 60_000;
const ZEITGRENZE_BESTAETIGUNG_MS = 180_000;

function dreiArten(context) {
  const protokoll = join(probeDirectory(context, {}), "aufrufe.jsonl");
  const lauf = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD"], {
    cwd: probe(context),
    encoding: "utf8",
    env: { ...isolatedEnvironment(), MUTANTEN_ARTEN: DREI_ARTEN.join(","), AUFRUFPROTOKOLL: protokoll },
  });
  const aufrufe = protokollzeilen(protokoll).map((text) => JSON.parse(text));
  return { lauf, aufrufe };
}

test("Gesamtlauf: nach Zeitablauf im ersten Lauf entscheidet der Bestätigungslauf: grün überlebt, Zeitablauf ist Hänger, rot mit gleicher Datei ist bestätigt getötet", (context) => {
  const { lauf } = dreiArten(context);
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:\S+ .* → lebt$/m);
  assert.doesNotMatch(lauf.stdout, /^Verstoß: Mutant überlebt: .*→ (haenger|getoetet)$/m);
  assert.doesNotMatch(lauf.stdout, /^Hinweis: im Bestätigungslauf nicht bestätigt/m);
  assert.match(lauf.stdout, /^Bestätigung: 1 bestätigt getötet, 1 nur durch Zeitablauf oder Absturz erkannt\.$/m);
  assert.deepEqual(zeitablaufzeilen(lauf.stdout), [zeile(1, 3, 1)]);
});

test("Gesamtlauf: zwischen erstem Lauf und Bestätigungslauf läuft kein weiterer Lauf, nur der bestätigt getötete Mutant bekommt einen dritten Lauf mit einer Testdatei", (context) => {
  const { aufrufe } = dreiArten(context);
  assert.deepEqual(
    aufrufe.map(({ zeitgrenzeMS, mutanten }) => [zeitgrenzeMS, mutanten]),
    [
      [ZEITGRENZE_ERSTER_LAUF_MS, DREI_ARTEN],
      [ZEITGRENZE_BESTAETIGUNG_MS, DREI_ARTEN],
      [ZEITGRENZE_BESTAETIGUNG_MS, ["getoetet"]],
    ],
  );
  assert.equal(aufrufe[2].tests.length, 1);
});

test("--teil: der Teil nennt die Zeitabläufe und Hänger seiner Datei", (context) => {
  const repo = probe(context);
  const ergebnis = join(probeDirectory(context, {}), "teil.json");
  const ausgabe = mitErsatz(repo, ["--teil", "1", "--teile", "1", "--ergebnis", ergebnis]);
  assert.deepEqual(zeitablaufzeilen(ausgabe), [zeile(2, 4, 1)]);
});

test("Testumbau: Vorher- und Nachher-Seite nennen je ihre Zeitabläufe und Hänger", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "test/zahl.test.js": testdatei([-1, "negativ"], [1, "positiv"]).replace("});", "  // umgebaut\n});") });
  const ausgabe = mitErsatz(repo, ["--testumbau"]);
  assert.deepEqual(zeitablaufzeilen(ausgabe), [zeile(2, 4, 3), zeile(1, 4, 2)]);
  assert.match(ausgabe, /^grün: 4 vorher getötete Mutanten in 1 Quelldateien \(src\/zahl\.js\) werden nach dem Testumbau weiter getötet\.$/m);
});
