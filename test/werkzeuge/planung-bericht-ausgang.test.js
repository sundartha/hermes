import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, GRUPPEN, KENNUNG, LAUF_FRIST_MS, ORDNER, WEGPRUEFUNGEN, alsJson, bericht, exit, phaseFuer, plane, schnittliste } from "./planung-probe.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const AUFTRAG = join(REPO_ROOT, "tools/auftrag.mjs");
const START = join(REPO_ROOT, "tools/auftrag/planung/neuschnitt-start.mjs");
const PHASENDATEI = `${ORDNER}/phase.json`;
const EXIT_ABBRUCH = 1;
const EXIT_BEFUNDE = 4;
const RUECKSENDUNGEN = 3;
const EISDIR = /^unerwarteter Fehler: Error: EISDIR/u;
const ANLASS = "Der Abnahmetest von a2 wurde nach dem Bau nicht grün.";
const VERLAUF = "test: a2 rot wie erwartet";

function lies(datei) {
  assert.equal(existsSync(datei), true, `${datei} fehlt`);
  return JSON.parse(readFileSync(datei, "utf8"));
}

function neuschnitt(context) {
  const ablage = probeDirectory(context, {});
  const vorbereitung = (wurzel) => {
    const claude = join(wurzel, "CLAUDE.md");
    rmSync(claude, { force: true });
    mkdirSync(claude, { recursive: true });
    writeFileSync(join(wurzel, PHASENDATEI), `${JSON.stringify(phaseFuer(wurzel), null, 2)}\n`);
    const eingabe = { root: wurzel, ordner: ORDNER, datei: PHASENDATEI, auftragId: "a2", fertig: ["a1"], anlass: ANLASS, kopf: `\n## Neuschnitt\n\n${ANLASS}\n\n## Verlauf\n\n${VERLAUF}`, verlauf: [VERLAUF], hinweise: [] };
    writeFileSync(join(ablage, "eingabe.json"), JSON.stringify(eingabe));
    return [ablage];
  };
  return { ...plane(context, { werkzeug: START, grund: {}, ueberschrieben: {}, argumente: vorbereitung }), ablage };
}

function zuschnittMitNull(auftraege) {
  const antwort = alsJson({ schnitt: { ...schnittliste(), auftraege } });
  const erkunder = GRUPPEN.map(({ nummern: [erste, ...rest] }) => [`erkunder|## Erkundung|${erste}`, [bericht([erste, ...rest])]]);
  return {
    "planer|## Gliederung": [alsJson({ gruppen: GRUPPEN })],
    ...Object.fromEntries(erkunder),
    "planer|## Zuschnitt": [antwort],
    "planer|## Befunde": Array.from({ length: RUECKSENDUNGEN }, () => antwort),
    "pruefer-planung|## Wegprüfung": Array.from({ length: WEGPRUEFUNGEN }, () => GRUEN_PRUEFLISTE),
  };
}

test("Neuschnitt: ein unerwarteter Fehler im Lauf endet mit Exit 1, planung.json und ergebnis.json nennen den Fehlertext", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = neuschnitt(context);
  exit(lauf, EXIT_ABBRUCH);
  const planung = lies(join(lauf.ablage, "planung.json"));
  assert.equal(planung.exit, EXIT_ABBRUCH);
  assert.match(planung.grund, EISDIR);
  assert.deepEqual(planung.befunde.offen, []);
  const ergebnis = lies(join(lauf.ablage, "ergebnis.json"));
  assert.equal(ergebnis.exitCode, EXIT_ABBRUCH);
  assert.match(ergebnis.grund, EISDIR);
  assert.deepEqual(ergebnis.planung, planung);
});

function planeMitSchnitt(context, auftraege) {
  const lauf = plane(context, { werkzeug: AUFTRAG, grund: zuschnittMitNull(auftraege), ueberschrieben: {}, argumente: ["plane", ORDNER] });
  return { lauf, planung: lies(join(lauf.wurzel, ".fortschritt", KENNUNG, "planung.json")) };
}

test("plane: ein Eintrag null in der Schnittliste lässt den Bericht entstehen und steht dort als ungültig", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf, planung } = planeMitSchnitt(context, [null, ...schnittliste().auftraege]);
  assert.equal(lauf.status, EXIT_BEFUNDE, `${lauf.stdout}\n${lauf.stderr}`);
  assert.equal(planung.exit, EXIT_BEFUNDE);
  assert.deepEqual(planung.auftraege.filter(({ id }) => id !== undefined).map(({ id }) => id), ["a0", "a1", "a2", "a3"]);
  assert.deepEqual(planung.auftraege.filter(({ ungueltig }) => ungueltig !== undefined), [{ ungueltig: "null" }]);
  assert.ok(lauf.stdout.includes("ungültig\tnull"), lauf.stdout);
});

test("plane: ein Eintrag null in abhaengigVon eines Auftrags lässt den Bericht entstehen", { timeout: LAUF_FRIST_MS }, (context) => {
  const auftraege = schnittliste().auftraege.map((eintrag) => (eintrag.id === "a2" ? { ...eintrag, abhaengigVon: [null] } : eintrag));
  const { lauf, planung } = planeMitSchnitt(context, auftraege);
  assert.equal(lauf.status, EXIT_BEFUNDE, `${lauf.stdout}\n${lauf.stderr}`);
  assert.equal(planung.exit, EXIT_BEFUNDE);
  assert.deepEqual(planung.auftraege.map(({ id }) => id), ["a0", "a1", "a2", "a3"]);
});
