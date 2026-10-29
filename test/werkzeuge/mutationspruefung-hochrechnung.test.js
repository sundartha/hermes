import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as zeitlog from "../../tools/mutationspruefung/zeitlog.mjs";
import { BASIS, EXIT_ABBRUCH, logeintraege, mitProtokoll, NEGATIV, NULL, PROTOKOLL, quelle } from "./mutationspruefung-hilfen.js";
import { isolatedEnvironment, outputLines, probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const ERSATZ = fileURLToPath(new URL("mutationspruefung-hochrechnung-ersatz.mjs", import.meta.url));
const VORPLANUNG = pathToFileURL(join(REPO_ROOT, "tools/mutationspruefung/vorplanung.mjs")).href;
const WORKFLOW = join(REPO_ROOT, ".github/workflows/ci.yml");
const GEPLANT = 25;
const ZEILEN_MIT_MUTANTEN = 12;
const ERSTER_VERGLEICHSWERT = 100;
const SCHNELL_MS = 1000;
const LANGSAM_MS = 30 * 60_000;
const GRUNDLAUF_MINUTEN = 61;
const LOESCHZEILEN = 3;
const TOLERANZ_MINUTEN = 6;
const QUELLE_MIT_VIELEN_MUTANTEN = quelle(NEGATIV, ...Array.from({ length: ZEILEN_MIT_MUTANTEN }, (_leer, stelle) => `  if (zahl === ${stelle + ERSTER_VERGLEICHSWERT}) return "z${stelle}";`));
const MS_JE_MINUTE = 60_000;
const SPAET_LANGSAM_MS = 6 * MS_JE_MINUTE;
const HALBE_MINUTE_MS = MS_JE_MINUTE / 2;
const JOB_GRENZE = 120;
const ABBRUCH = /^Abbruch: Hochrechnung (\d+) min über Grenze (\d+) min/m;
const QUELLE_MIT_DREI_LOESCHZEILEN = mitProtokoll(["export function verdoppeln(zahl) {", ...Array(LOESCHZEILEN).fill(PROTOKOLL), "  return zahl * 2;", "}", ""].join("\n"));

function probe(context, text = quelle(NEGATIV, NULL)) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": text });
  return repo;
}

function teilLauf(context, repo, { erstlaufMs, msJeMutant, ...weitere }) {
  const ordner = probeDirectory(context, {});
  const ergebnis = join(ordner, "teil.json");
  const getestet = join(ordner, "getestet");
  const lauf = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD", "--teil", "1", "--teile", "1", "--ergebnis", ergebnis], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), ERSTLAUF_MS: String(erstlaufMs), MS_JE_MUTANT: String(msJeMutant), GETESTET: getestet, ...weitere },
  });
  const getestete = existsSync(getestet) ? outputLines(readFileSync(getestet, "utf8")).length : 0;
  return { ...lauf, ergebnisdatei: existsSync(ergebnis), getestete };
}

function pruefeDurchgelaufen(lauf) {
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, ABBRUCH);
  assert.equal(lauf.ergebnisdatei, true);
}

function mutantenzahl(context, repo) {
  const skript = join(probeDirectory(context, {}), "zaehle.mjs");
  writeFileSync(skript, `import { teilumfang } from ${JSON.stringify(VORPLANUNG)};\nconsole.log(JSON.stringify(await teilumfang([{ datei: "src/zahl.js", bereiche: [[1, 100]] }], { mitLoeschprobe: false })));\n`);
  const lauf = spawnSync(process.execPath, [skript], { cwd: repo, encoding: "utf8", env: isolatedEnvironment() });
  assert.equal(lauf.status, 0, lauf.stderr);
  const { dateien } = JSON.parse(lauf.stdout);
  return dateien[0].mutanten;
}

test("liegt die Hochrechnung der Mutanten über der Job-Grenze, bricht der Teil nach den ersten Mutanten mit Exit 2 ab und schreibt kein Teilergebnis", (context) => {
  const repo = probe(context);
  const lauf = teilLauf(context, repo, { erstlaufMs: MS_JE_MINUTE, msJeMutant: LANGSAM_MS });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  const [, minuten, grenze] = ABBRUCH.exec(lauf.stderr);
  assert.deepEqual([Number(minuten) > JOB_GRENZE, Number(grenze)], [true, JOB_GRENZE], lauf.stderr);
  assert.equal(lauf.getestete, zeitlog.MINDEST_MUTANTEN, `${lauf.getestete} Mutanten getestet`);
  assert.equal(lauf.ergebnisdatei, false);
  const eintraege = logeintraege(repo);
  const hochrechnung = eintraege.filter(({ art }) => art === "hochrechnung");
  assert.equal(hochrechnung.length, 1, JSON.stringify(eintraege));
  assert.equal(eintraege.at(-1).exit, EXIT_ABBRUCH, JSON.stringify(eintraege.at(-1)));
});

test("zählt die Hochrechnung die Zeilen der Löschprobe mal den Grundlauf mit, bricht ein Teil mit schnellen Mutanten wegen der Löschprobe ab", (context) => {
  const lauf = teilLauf(context, probe(context, QUELLE_MIT_DREI_LOESCHZEILEN), { erstlaufMs: GRUNDLAUF_MINUTEN * MS_JE_MINUTE, msJeMutant: SCHNELL_MS });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  const minuten = Number(ABBRUCH.exec(lauf.stderr)[1]);
  const untergrenze = GRUNDLAUF_MINUTEN * (1 + LOESCHZEILEN);
  assert.ok(minuten >= untergrenze && minuten <= untergrenze + TOLERANZ_MINUTEN, lauf.stderr);
  assert.equal(lauf.ergebnisdatei, false);
});

test("liegt die Hochrechnung unter der Job-Grenze, läuft der Teil unverändert durch und schreibt sie ins Zeit-Log", (context) => {
  const repo = probe(context);
  const lauf = teilLauf(context, repo, { erstlaufMs: GRUNDLAUF_MINUTEN * MS_JE_MINUTE, msJeMutant: SCHNELL_MS });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, ABBRUCH);
  assert.ok(lauf.getestete >= GEPLANT, `${lauf.getestete} Mutanten getestet`);
  assert.equal(lauf.ergebnisdatei, true);
  const hochrechnungen = logeintraege(repo).filter(({ art }) => art === "hochrechnung");
  assert.equal(hochrechnungen.length, 1, JSON.stringify(hochrechnungen));
  assert.ok(hochrechnungen[0].minuten > GRUNDLAUF_MINUTEN && hochrechnungen[0].minuten <= JOB_GRENZE, JSON.stringify(hochrechnungen[0]));
  assert.match(lauf.stderr, /^Mutationslog: Hochrechnung Teil: /m);
});

test("schreibt die Hochrechnung höchstens einmal je Minute ins Zeit-Log und zieht nie mehr Mutanten ab, als der Teil hat", (context) => {
  const repo = probe(context);
  const lauf = teilLauf(context, repo, { erstlaufMs: GRUNDLAUF_MINUTEN * MS_JE_MINUTE, msJeMutant: HALBE_MINUTE_MS });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const hochrechnungen = logeintraege(repo).filter(({ art }) => art === "hochrechnung");
  const mutantenJeMinute = MS_JE_MINUTE / HALBE_MINUTE_MS;
  assert.equal(hochrechnungen.length, Math.ceil((GEPLANT - zeitlog.MINDEST_MUTANTEN) / mutantenJeMinute), JSON.stringify(hochrechnungen));
  const bisherMinuten = GRUNDLAUF_MINUTEN + (zeitlog.MINDEST_MUTANTEN * HALBE_MINUTE_MS) / MS_JE_MINUTE;
  assert.ok(hochrechnungen[0].minuten >= bisherMinuten && hochrechnungen[0].mutanten === 0, JSON.stringify(hochrechnungen[0]));
});

test("rechnet die Hochrechnung nach jedem Mutanten neu, bricht ein Teil mit schnellen ersten und danach langsamen Mutanten ab, sobald die Rechnung die Grenze übersteigt", (context) => {
  const repo = probe(context, QUELLE_MIT_VIELEN_MUTANTEN);
  const mutanten = mutantenzahl(context, repo);
  const lauf = teilLauf(context, repo, { erstlaufMs: MS_JE_MINUTE, msJeMutant: SCHNELL_MS, GEPLANT: String(mutanten), MS_JE_MUTANT_SPAETER: String(SPAET_LANGSAM_MS) });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  const minuten = Number(ABBRUCH.exec(lauf.stderr)[1]);
  assert.ok(minuten > JOB_GRENZE, lauf.stderr);
  assert.ok(lauf.getestete > zeitlog.MINDEST_MUTANTEN && lauf.getestete < mutanten, `${lauf.getestete} von ${mutanten} Mutanten getestet`);
  assert.equal(lauf.ergebnisdatei, false);
  const eintraege = logeintraege(repo).filter(({ art }) => art === "hochrechnung");
  assert.ok(eintraege.length >= 2 && eintraege.every((eintrag) => eintrag.minuten <= JOB_GRENZE || eintrag === eintraege.at(-1)), JSON.stringify(eintraege));
});

test("läuft ein gleichmäßig schneller Teil mit vielen Mutanten durch, rechnet die Hochrechnung ihn nie über die Grenze", (context) => {
  const repo = probe(context, QUELLE_MIT_VIELEN_MUTANTEN);
  const lauf = teilLauf(context, repo, { erstlaufMs: MS_JE_MINUTE, msJeMutant: SCHNELL_MS, GEPLANT: String(mutantenzahl(context, repo)) });
  pruefeDurchgelaufen(lauf);
});

test("hat ein Teil weniger Mutanten als der Mindestumfang, rechnet er nicht hoch und läuft durch", (context) => {
  const repo = probe(context);
  const lauf = teilLauf(context, repo, { erstlaufMs: MS_JE_MINUTE, msJeMutant: LANGSAM_MS, GEPLANT: String(zeitlog.MINDEST_MUTANTEN - 1) });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Hochrechnung Teil/);
  assert.deepEqual(logeintraege(repo).filter(({ art }) => art === "hochrechnung"), []);
});

test("rechnet ein langsamer Folgelauf nach einer Zeitüberschreitung nicht in die Hochrechnung und bricht den Teil nicht ab", (context) => {
  const lauf = teilLauf(context, probe(context), { erstlaufMs: MS_JE_MINUTE, msJeMutant: SCHNELL_MS, ZEITUEBERSCHREITUNG: "1", FOLGE_MS_JE_MUTANT: String(LANGSAM_MS) });
  pruefeDurchgelaufen(lauf);
});

test("ohne Teil rechnet die Mutationsprüfung nicht hoch und bricht nicht deswegen ab", (context) => {
  const ordner = probeDirectory(context, {});
  const lauf = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD"], {
    cwd: probe(context),
    encoding: "utf8",
    env: { ...isolatedEnvironment(), ERSTLAUF_MS: String(MS_JE_MINUTE), MS_JE_MUTANT: String(LANGSAM_MS), GETESTET: join(ordner, "getestet") },
  });
  assert.doesNotMatch(lauf.stderr, ABBRUCH);
  assert.doesNotMatch(lauf.stderr, /Hochrechnung Teil/);
  assert.doesNotMatch(lauf.stderr, /^Abbruch: /m);
});

test("die Grenze der Hochrechnung ist das Zeitlimit des Teil-Jobs in der CI", () => {
  const job = readFileSync(WORKFLOW, "utf8").split("\n    name: Mutationsprüfung ${{ matrix.teil }}\n")[1];
  const [, minuten] = /^ {4}timeout-minutes: (\d+)$/m.exec(job);
  assert.equal(zeitlog.JOB_GRENZE_MINUTEN, Number(minuten));
});

test("die Hochrechnung der Teildauer addiert Vorlauf, Mutanten mal Zeit je Mutant und Löschprobe-Zeilen mal Grundlauf", () => {
  const faelle = [
    [{ bisherMs: 60_000, mutanten: 100, msJeMutant: SCHNELL_MS, loeschzeilen: 0, grundlaufMs: 50_000 }, 160_000],
    [{ bisherMs: 60_000, mutanten: 0, msJeMutant: SCHNELL_MS, loeschzeilen: 10, grundlaufMs: 50_000 }, 560_000],
    [{ bisherMs: 60_000, mutanten: 100, msJeMutant: SCHNELL_MS, loeschzeilen: 10, grundlaufMs: 50_000 }, 660_000],
  ];
  for (const [eingabe, erwartet] of faelle) assert.equal(zeitlog.teilDauer(eingabe), erwartet, JSON.stringify(eingabe));
});
