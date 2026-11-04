import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { teilStand } from "../../tools/mutationspruefung/lauf-teile.mjs";
import { BASIS, EXIT_ABBRUCH, EXIT_ROT, quelle } from "./mutationspruefung-hilfen.js";
import { probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";
import { umgebung } from "./schwerlauf-lauf.js";
import { workflowJobLines } from "./workflow-dateien.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const NACHLAUFPLAN = join(REPO_ROOT, "tools/mutationspruefung/nachlauf-plan.mjs");
const ERSATZ = fileURLToPath(new URL("mutationspruefung-nachlauf-ersatz.mjs", import.meta.url));
const CI = "ci.yml";
const FRIST = { timeout: 600_000 };
const PLAETZE = 2;
const ZEILENZAHL = 40;
const MUTANTEN = ZEILENZAHL + 1;
const VERSCHOBEN = 32;
const GRENZE_MS = 6_000_000;
const ZWEITE_TESTDATEI = { "test/zwei.test.js": 'import { einordnen } from "../src/zahl.js";\nimport { test } from "node:test";\ntest("zwei", () => einordnen(1));\n' };
const URTEILSZEILE = /^(?:Verstoß|Hinweis|Bestätigung|rot|grün)\b.*$/gm;
const UEBERLEBT = /^Verstoß: Mutant überlebt: src\/zahl\.js:\d+:\d+-\d+:\d+ EqualityOperator → m(\d+)$/gm;
const UEBERLEBENDE = [24, 25, 26, 27, 28, 29, 30, 31, 36, 37, 38, 39, 40];
const BILANZ = "Bestätigung: 8 bestätigt getötet, 20 nur durch Zeitablauf oder Absturz erkannt.";
const ROT_URTEIL = "rot: 13 von 41 Mutanten überleben in den neuen Zeilen unter src/; kein Test verlangt diese Zeilen.";
const NICHT_BESTAETIGTER = 28;
const OHNE_ZEITGRENZE_ROT = /^rot: 13 von 41 Mutanten überleben/m;
const ZEILEN = Array.from({ length: ZEILENZAHL }, (_leer, index) => `  if (zahl === ${index + 2}) return "m${index}";`);

function probe(context) {
  const repo = probeRepository(context, { ...BASIS, ...ZWEITE_TESTDATEI });
  writeFiles(repo, { "src/zahl.js": quelle(...ZEILEN) });
  return repo;
}

function aufruf(context, repo, zusatz = {}) {
  const ablage = probeDirectory(context, {});
  return (argumente, kostenName = "kosten") => {
    const kosten = join(ablage, kostenName);
    const lauf = spawnSync(process.execPath, ["--import", ERSATZ, WERKZEUG, "--basis", "HEAD", ...argumente], {
      cwd: repo,
      encoding: "utf8",
      env: { ...umgebung(context, PLAETZE), KOSTEN_DATEI: kosten, ...zusatz },
    });
    const zeilen = existsSync(kosten) ? readFileSync(kosten, "utf8").split("\n").filter(Boolean) : [];
    return { ...lauf, kostenMs: zeilen.reduce((summe, wert) => summe + Number(wert), 0) };
  };
}

function gruen(lauf) {
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return lauf;
}

function ersteWelle(context, lauf) {
  const ordner = probeDirectory(context, {});
  const planDatei = join(ordner, "plan.json");
  gruen(lauf(["--plan", planDatei]));
  const { teile, anzahl } = JSON.parse(readFileSync(planDatei, "utf8"));
  const berichte = join(ordner, "teile");
  mkdirSync(berichte);
  const kosten = teile.map((teil) => gruen(lauf(["--teil", String(teil), "--teile", String(anzahl), "--ergebnis", join(berichte, `mutation-teil-${teil}.json`)], `welle1-${teil}`)).kostenMs);
  return { ordner, berichte, anzahl, kosten };
}

function nachlaufPlan(welle) {
  const ziel = join(welle.ordner, "nachlauf.json");
  gruen(spawnSync(process.execPath, [NACHLAUFPLAN, welle.berichte, ziel], { encoding: "utf8" }));
  return { ziel, plan: JSON.parse(readFileSync(ziel, "utf8")) };
}

function zweiteWelle(welle, lauf) {
  const { ziel, plan } = nachlaufPlan(welle);
  const kosten = plan.teile.map((teil) => {
    const argumente = ["--teil", String(teil), "--teile", String(welle.anzahl), "--ergebnis", join(welle.berichte, `mutation-teil-${teil}.json`), "--nachlauf", ziel];
    return gruen(lauf(argumente, `welle2-${teil}`)).kostenMs;
  });
  return { plan, kosten };
}

function urteilszeilen(ausgabe) {
  return [...ausgabe.matchAll(URTEILSZEILE)].map(([zeile]) => zeile).sort();
}

function ueberlebende(ausgabe) {
  return [...ausgabe.matchAll(UEBERLEBT)].map(([, nummer]) => Number(nummer)).sort((links, rechts) => links - rechts);
}

test("ein Teil mit vielen Zeitgrenzen-Mutanten bleibt unter der Grenze, die zweite Welle auch, und das Urteil gleicht dem Lauf ohne Teilung", FRIST, (context) => {
  const lauf = aufruf(context, probe(context));
  const ganz = lauf([], "ganz");
  assert.equal(ganz.status, EXIT_ROT, ganz.stdout + ganz.stderr);
  assert.ok(ganz.kostenMs > GRENZE_MS, `ohne Teilung müssen die Kosten über der Grenze liegen: ${ganz.kostenMs}`);

  const welle = ersteWelle(context, lauf);
  const zweite = zweiteWelle(welle, lauf);
  for (const kosten of [...welle.kosten, ...zweite.kosten]) assert.ok(kosten <= GRENZE_MS, `Teil kostet ${kosten} ms`);
  assert.ok(zweite.kosten.length > 1, "die zweite Welle muss die Zeitgrenzen-Mutanten auf mehrere Teile verteilen");

  const urteil = lauf(["--urteil", welle.berichte]);
  assert.equal(urteil.status, EXIT_ROT, urteil.stdout + urteil.stderr);
  assert.deepEqual(urteilszeilen(urteil.stdout), urteilszeilen(ganz.stdout));
  assert.ok(urteilszeilen(urteil.stdout).includes(BILANZ), urteil.stdout);
  assert.ok(urteilszeilen(urteil.stdout).includes(ROT_URTEIL), urteil.stdout);
  assert.deepEqual(ueberlebende(urteil.stdout), UEBERLEBENDE);
});

test("ein Zeitgrenzen-Mutant zählt erst nach der Bestätigung mit langer Grenze: ohne zweite Welle kein Urteil, unbestätigt überlebt er", FRIST, (context) => {
  const lauf = aufruf(context, probe(context));
  const welle = ersteWelle(context, lauf);
  const bericht = JSON.parse(readFileSync(join(welle.berichte, "mutation-teil-1.json"), "utf8"));
  const ergebnisse = bericht.messungen.flatMap((messung) => messung.ergebnisse);
  assert.deepEqual(ergebnisse.filter(({ status }) => status === "Timeout"), [], "kein Mutant der ersten Welle zählt schon wegen der kurzen Grenze");
  assert.equal(ergebnisse.length, MUTANTEN - VERSCHOBEN);

  const ohneZweite = lauf(["--urteil", welle.berichte]);
  assert.equal(ohneZweite.status, EXIT_ABBRUCH, ohneZweite.stdout + ohneZweite.stderr);
  assert.match(ohneZweite.stderr, /^Abbruch: erwartet die Teile 1, 2, 3, 4, gefunden 1$/m);

  zweiteWelle(welle, lauf);
  const urteil = lauf(["--urteil", welle.berichte]);
  assert.match(urteil.stdout, new RegExp(`^Hinweis: im Bestätigungslauf nicht bestätigt, Mutant zählt als überlebt .*→ m${NICHT_BESTAETIGTER}$`, "m"));
  assert.ok(ueberlebende(urteil.stdout).includes(NICHT_BESTAETIGTER));
});

test("das Urteil bricht ab, wenn ein verschobener Mutant in der zweiten Welle kein Ergebnis hat", FRIST, (context) => {
  const lauf = aufruf(context, probe(context));
  const welle = ersteWelle(context, lauf);
  const { plan } = zweiteWelle(welle, lauf);
  const datei = join(welle.berichte, `mutation-teil-${plan.teile[0]}.json`);
  const bericht = JSON.parse(readFileSync(datei, "utf8"));
  const [messung] = bericht.messungen;
  const [fehlt, ...rest] = messung.ergebnisse;
  writeFileSync(datei, JSON.stringify({ ...bericht, messungen: [{ ...messung, ergebnisse: rest }] }));
  const urteil = lauf(["--urteil", welle.berichte]);
  assert.equal(urteil.status, EXIT_ABBRUCH, urteil.stdout + urteil.stderr);
  assert.ok(urteil.stderr.includes(`Abbruch: verschobener Mutant ohne Ergebnis im Nachlauf: ${fehlt.schluessel}`), urteil.stderr);
});

test("ohne Zeitgrenzen-Mutanten gibt es keine zweite Welle und das Urteil braucht keine", FRIST, (context) => {
  const lauf = aufruf(context, probe(context), { OHNE_ZEITGRENZE: "ja" });
  const welle = ersteWelle(context, lauf);
  const { plan } = nachlaufPlan(welle);
  assert.equal(plan.messen, false);
  assert.deepEqual(plan.teile, [0]);
  const urteil = lauf(["--urteil", welle.berichte]);
  assert.equal(urteil.status, EXIT_ROT, urteil.stdout + urteil.stderr);
  assert.match(urteil.stdout, OHNE_ZEITGRENZE_ROT);
});

test("die Fortschrittsanzeige zählt Teile beider Wellen auch mit dem Namen des aufrufenden Jobs davor, andere Jobs nicht", () => {
  const job = (name) => ({ name, status: "completed", conclusion: "success" });
  const faelle = ["Mutationsprüfung 1", "Mutationsteile / Mutationsprüfung 2", "Mutationsnachlauf / Mutationsprüfung 257", "Vorprüfung Mutation / Mutationsteile / Mutationsprüfung 3"];
  const andere = ["Mutationsplan", "Mutationsurteil", "Mutationsnachlauf-Plan", "CI"];
  assert.equal(teilStand([...faelle, ...andere].map(job)).gesamt, faelle.length);
});

test("die Jobs der zweiten Welle laufen vor dem Urteil und ihr Scheitern macht den Pflicht-Check CI rot", () => {
  const braucht = (job, name) => workflowJobLines(CI, job).some((zeile) => zeile.trim().startsWith("needs: ") && zeile.includes(name));
  for (const job of ["mutationsnachlaufplan", "mutationsnachlauf"]) {
    assert.ok(braucht("mutationsurteil", job), `mutationsurteil braucht ${job}`);
    assert.ok(braucht("ci", job), `ci braucht ${job}`);
  }
  assert.ok(braucht("mutationsnachlaufplan", "mutationspruefung"));
  assert.ok(braucht("mutationsnachlauf", "mutationsnachlaufplan"));
});
