import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { fristEintraegeNachUmzug } from "../../tools/auftrag/listen-eintraege-umzug.mjs";

import { datei } from "./auslagerung-hilfen.js";
import { codeOhneFreigabe, freigabeImProbeRepo, grundZeile } from "./freigabe/hilfen.mjs";
import { BASIS_VERGLEICH, auslagernMit, gateFuer, umziehen } from "./listenumzug-hilfen.js";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const LISTE = "tools/basis/anfrage-mit-frist.json";
const ALT = "src/fristen.js";
const NEU = "src/holen.js";
const ZWEITE_NEU = "src/laden.js";
const FREMD = "src/anderes.js";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

const HOLE = "export async function hole(url) {\n  const antwort = await fetch(url);\n  return antwort.text();\n}";
const HOLE_ANDERS = "export async function hole(url) {\n  const antwort = await fetch(url, { method: \"GET\" });\n  return antwort.text();\n}";
const SENDE = "export async function sende(url, daten) {\n  return fetch(url, { method: \"POST\", body: daten });\n}";
const BLEIBT = "export function bleibt(wert) {\n  return wert;\n}";
const HOLE_REPARIERT = "export async function hole(url) {\n  const antwort = await fetch(url, { signal: AbortSignal.timeout(5000) });\n  return antwort.text();\n}";
const LADE = "export async function lade(url) {\n  const antwort = await fetch(url);\n  return antwort.json();\n}";
const SAMMLE = "export function sammle(urls) {\n  return urls.map((url) => fetch(url));\n}";
const SAMMLE_REPARIERT = "export function sammle(urls) {\n  return urls.map((url) => fetch(url, { signal: AbortSignal.timeout(5000) }));\n}";
const SAMMLE_NEU = "export function laden(urls) {\n  return urls.map((url) => fetch(url));\n}";
const WEITERGEREICHT = 'export { hole } from "./holen.js";';

const HASH_HOLE = "1111111111111111";
const HASH_SENDE = "2222222222222222";
const eintrag = (pfad, hash) => `${pfad}|${hash}`;
const fund = (pfad, hash) => ({ key: eintrag(pfad, hash), text: `${pfad} ${hash}` });
const alles = { neueDatei: () => true, stammtAus: () => true, nochDort: () => false };

function umgezogenNach({ liste, aktuell, pruefen = {} }) {
  return fristEintraegeNachUmzug({ liste, aktuell, pruefen: { ...alles, ...pruefen } });
}

test("Frist-Einträge nach Umzug: der Eintrag der alten Datei zieht auf die neue Datei, die Liste bleibt gleich lang", () => {
  const ergebnis = umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(NEU, HASH_HOLE)] });
  assert.deepEqual(ergebnis, { neu: [eintrag(NEU, HASH_HOLE)], anzahl: 1 });
});

test("Frist-Einträge nach Umzug: Einträge in fremden Dateien bleiben unberührt, die Liste bleibt sortiert", () => {
  const liste = [eintrag(ALT, HASH_HOLE), eintrag(FREMD, HASH_SENDE)];
  const ergebnis = umgezogenNach({ liste, aktuell: [fund(FREMD, HASH_SENDE), fund(NEU, HASH_HOLE)] });
  assert.deepEqual(ergebnis, { neu: [eintrag(FREMD, HASH_SENDE), eintrag(NEU, HASH_HOLE)], anzahl: 1 });
});

test("Frist-Einträge nach Umzug: findet die Regel die alte Stelle noch, ist der Eintrag gültig und die neue Stelle bleibt neu", () => {
  const aktuell = [fund(ALT, HASH_HOLE), fund(NEU, HASH_HOLE)];
  assert.equal(umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell }), undefined);
});

test("Frist-Einträge nach Umzug: ein anderer Fingerabdruck in der neuen Datei ist eine neue Stelle und zieht nichts um", () => {
  assert.equal(umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(NEU, HASH_SENDE)] }), undefined);
});

test("Frist-Einträge nach Umzug: ein Fund, der schon als Eintrag in der Liste steht, ersetzt keinen offenen Eintrag", () => {
  const liste = [eintrag(ALT, HASH_HOLE), eintrag(NEU, HASH_HOLE)];
  assert.equal(umgezogenNach({ liste, aktuell: [fund(NEU, HASH_HOLE)] }), undefined);
});

test("Frist-Einträge nach Umzug: ein offener Eintrag ersetzt höchstens einen Fund, der zweite Fund bleibt neu", () => {
  const ergebnis = umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(NEU, HASH_HOLE), fund(ZWEITE_NEU, HASH_HOLE)] });
  assert.deepEqual(ergebnis, { neu: [eintrag(NEU, HASH_HOLE)], anzahl: 1 });
});

test("Frist-Einträge nach Umzug: zwei gleiche Einträge der alten Datei ziehen mit zwei gleichen Funden, die Liste bleibt gleich lang", () => {
  const ergebnis = umgezogenNach({
    liste: [eintrag(ALT, HASH_HOLE), eintrag(ALT, HASH_HOLE)],
    aktuell: [fund(NEU, HASH_HOLE), fund(NEU, HASH_HOLE)],
  });
  assert.deepEqual(ergebnis, { neu: [eintrag(NEU, HASH_HOLE), eintrag(NEU, HASH_HOLE)], anzahl: 2 });
});

test("Frist-Einträge nach Umzug: bleibt eine von zwei gleichen Stellen in der alten Datei, zieht nur der freie Eintrag um", () => {
  const ergebnis = umgezogenNach({
    liste: [eintrag(ALT, HASH_HOLE), eintrag(ALT, HASH_HOLE)],
    aktuell: [fund(ALT, HASH_HOLE), fund(NEU, HASH_HOLE)],
  });
  assert.deepEqual(ergebnis, { neu: [eintrag(ALT, HASH_HOLE), eintrag(NEU, HASH_HOLE)], anzahl: 1 });
});

test("Frist-Einträge nach Umzug: ein Fund in derselben Datei wie der offene Eintrag ist kein Umzug", () => {
  assert.equal(umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(ALT, HASH_SENDE)] }), undefined);
});

test("Frist-Einträge nach Umzug: war die Datei des Funds schon auf der Basis, zieht nichts um", () => {
  const neueDatei = (pfad) => pfad !== NEU;
  assert.equal(umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(NEU, HASH_HOLE)], pruefen: { neueDatei } }), undefined);
});

test("Frist-Einträge nach Umzug: stammt der Text der Stelle nicht aus der alten Datei, zieht nichts um", () => {
  const stammtAus = () => false;
  assert.equal(umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(NEU, HASH_HOLE)], pruefen: { stammtAus } }), undefined);
});

test("Frist-Einträge nach Umzug: steht der Text der Stelle noch in der alten Datei, zieht nichts um", () => {
  const nochDort = () => true;
  assert.equal(umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(NEU, HASH_HOLE)], pruefen: { nochDort } }), undefined);
});

test("Frist-Einträge nach Umzug: die Prüfung bekommt den Text des Funds, die alte und die neue Datei", () => {
  const gesehen = [];
  const stammtAus = (text, dateien) => gesehen.push({ text, dateien });
  umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(NEU, HASH_HOLE)], pruefen: { stammtAus } });
  assert.deepEqual(gesehen, [{ text: `${NEU} ${HASH_HOLE}`, dateien: { von: ALT, nach: NEU } }]);
});

test("Frist-Einträge nach Umzug: die Prüfung auf Reste fragt nach dem Text des Funds in der alten Datei", () => {
  const gesehen = [];
  const nochDort = (text, dateien) => gesehen.push({ text, dateien });
  umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [fund(NEU, HASH_HOLE)], pruefen: { nochDort } });
  assert.deepEqual(gesehen, [{ text: `${NEU} ${HASH_HOLE}`, dateien: { von: ALT } }]);
});

test("Frist-Einträge nach Umzug: ohne Funde bleibt die Liste", () => {
  assert.equal(umgezogenNach({ liste: [eintrag(ALT, HASH_HOLE)], aktuell: [] }), undefined);
});

function lesen(repo) {
  return JSON.parse(readFileSync(join(repo, LISTE), "utf8"));
}

function basisRepo(context, { dazu = {}, aendern = (befunde) => befunde } = {}) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "eslint.config.js": "export default [];\n",
    [ALT]: datei(HOLE, BLEIBT),
    [FREMD]: datei(HOLE),
    ...dazu,
  });
  const angelegt = runIn(repo, process.execPath, [BASIS_VERGLEICH, "anfrage-mit-frist", "--basis-anlegen"]);
  assert.equal(angelegt.status, EXIT_GRUEN, `${angelegt.stdout}${angelegt.stderr}`);
  writeFiles(repo, { [LISTE]: `${JSON.stringify({ befunde: aendern(lesen(repo).befunde) }, null, 2)}\n` });
  commitAll(repo, "Liste");
  return repo;
}

function auslagern(repo, dateien = {}) {
  auslagernMit(repo, { [ALT]: datei(WEITERGEREICHT, BLEIBT), [NEU]: datei(HOLE), ...dateien });
}

function gate(repo) {
  return gateFuer(repo, "anfrage-mit-frist");
}

async function ausgelagert(context, { dazu, aendern, dateien } = {}) {
  const repo = basisRepo(context, { dazu, aendern });
  auslagern(repo, dateien);
  const vorher = lesen(repo).befunde;
  const vorab = gate(repo);
  assert.equal(vorab.status, EXIT_ROT, vorab.ausgabe);
  const ausgabe = await umziehen(context, repo);
  return { repo, vorher, nachher: lesen(repo).befunde, ausgabe };
}

function bleibtRot(ergebnis, stelle) {
  assert.deepEqual(ergebnis.nachher, ergebnis.vorher);
  const pruefung = gate(ergebnis.repo);
  assert.equal(pruefung.status, EXIT_ROT, pruefung.ausgabe);
  assert.match(pruefung.ausgabe, stelle);
}

test("wortgleicher Umzug: der Eintrag zieht auf die neue Datei, die Liste bleibt gleich lang, die Prüfung meldet nichts Neues", async (context) => {
  const { repo, vorher, nachher, ausgabe } = await ausgelagert(context);
  const [hash] = vorher.filter((eintragText) => eintragText.startsWith(`${ALT}|`));
  assert.equal(vorher.length, 2);
  assert.deepEqual(nachher, [FREMD, NEU].map((pfad) => hash.replace(ALT, pfad)).toSorted());
  assert.match(ausgabe, /1 Einträge der Regel „Anfrage mit Frist“ mit ihrer wortgleich ausgelagerten Stelle umgezogen/);
  const pruefung = gate(repo);
  assert.equal(pruefung.status, EXIT_GRUEN, pruefung.ausgabe);
});

test("Code beim Umzug verändert: kein Umzug, die Prüfung meldet die Stelle in der neuen Datei als neu", async (context) => {
  bleibtRot(await ausgelagert(context, { dateien: { [NEU]: datei(HOLE_ANDERS) } }), /src\/holen\.js/);
});

test("Stelle kopiert statt verschoben: der alte Eintrag ist noch gültig, kein Umzug, die Kopie ist neu", async (context) => {
  bleibtRot(await ausgelagert(context, { dateien: { [ALT]: datei(HOLE, BLEIBT) } }), /src\/holen\.js/);
});

test("neue Altstelle ohne Umzug: kein Eintrag zieht um, die Prüfung meldet die Stelle als neu", async (context) => {
  bleibtRot(await ausgelagert(context, { dateien: { [NEU]: datei(SENDE) } }), /src\/holen\.js/);
});

test("Stelle geht in eine Datei, die es auf der Basis schon gab: kein Umzug, die Prüfung meldet sie als neu", async (context) => {
  bleibtRot(await ausgelagert(context, { dazu: { [NEU]: datei(BLEIBT) } }), /src\/holen\.js/);
});

test("alter Eintrag ohne Stelle in der alten Datei der Basis: der Text stammt nicht von dort, kein Umzug", async (context) => {
  const aendern = (befunde) => [...befunde, befunde[0].replace(FREMD, ALT)];
  const ergebnis = await ausgelagert(context, { dazu: { [ALT]: datei(BLEIBT) }, aendern });
  assert.equal(ergebnis.vorher.length, 2);
  bleibtRot(ergebnis, /src\/holen\.js/);
});

test("zwei neue Dateien mit der Stelle, ein offener Eintrag: einer zieht um, die Liste wächst nicht, die andere Stelle bleibt neu", async (context) => {
  const { repo, vorher, nachher } = await ausgelagert(context, { dateien: { [ZWEITE_NEU]: datei(HOLE) } });
  assert.equal(nachher.length, vorher.length);
  assert.ok(nachher.includes(vorher.find((text) => text.startsWith(`${FREMD}|`))));
  assert.equal(nachher.filter((text) => text.startsWith(`${NEU}|`)).length, 1);
  const pruefung = gate(repo);
  assert.equal(pruefung.status, EXIT_ROT, pruefung.ausgabe);
  assert.match(pruefung.ausgabe, /src\/laden\.js/);
});

test("umschließende Funktion anders, alte Stelle repariert: der Eintrag zieht nicht zu der neuen Stelle ohne Frist", async (context) => {
  const ergebnis = await ausgelagert(context, { dateien: { [ALT]: datei(HOLE_REPARIERT, BLEIBT), [NEU]: datei(LADE) } });
  assert.equal(ergebnis.vorher.length, 2);
  bleibtRot(ergebnis, /src\/holen\.js/);
});

test("verschachtelte Anfrage, alte Stelle repariert: nicht die Anweisung, die ganze äußere Funktion muss wortgleich umziehen", async (context) => {
  const dazu = { [ALT]: datei(SAMMLE, BLEIBT) };
  const dateien = { [ALT]: datei(SAMMLE_REPARIERT, BLEIBT), [NEU]: datei(SAMMLE_NEU) };
  bleibtRot(await ausgelagert(context, { dazu, dateien }), /src\/holen\.js/);
});

test("verschachtelte Anfrage in wortgleich umgezogener Funktion: der Eintrag zieht um, die Prüfung meldet nichts Neues", async (context) => {
  const dazu = { [ALT]: datei(SAMMLE, BLEIBT) };
  const ergebnis = await ausgelagert(context, { dazu, dateien: { [ALT]: datei(WEITERGEREICHT, BLEIBT), [NEU]: datei(SAMMLE) } });
  assert.equal(ergebnis.nachher.filter((text) => text.startsWith(`${NEU}|`)).length, 1);
  const pruefung = gate(ergebnis.repo);
  assert.equal(pruefung.status, EXIT_GRUEN, pruefung.ausgabe);
});

const LISTE_SCHLUESSEL = (pfad, text) => befundSchluessel(pfad, text);
const FRIST_CALL = "fetch(url)";

function freigabeBasis() {
  return {
    ".gitignore": "node_modules\n",
    ".github/CODEOWNERS": "/tools/ @Antonio20045\n",
    "package.json": '{ "type": "module" }\n',
    "eslint.config.js": "export default [];\n",
    [ALT]: datei(HOLE, BLEIBT),
    [FREMD]: datei(HOLE),
    [LISTE]: listeText([ALT, FREMD]),
  };
}

function listeText(pfade) {
  const befunde = pfade.map((pfad) => LISTE_SCHLUESSEL(pfad, FRIST_CALL)).toSorted();
  return `${JSON.stringify({ befunde }, null, 2)}\n`;
}

async function freigabe(context, aenderung) {
  const verzeichnis = probeRepository(context, freigabeBasis());
  symlinkSync(join(REPO_ROOT, "node_modules"), join(verzeichnis, "node_modules"));
  const basis = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(verzeichnis, { [ALT]: datei(WEITERGEREICHT, BLEIBT), [NEU]: datei(HOLE), ...aenderung });
  commitAll(verzeichnis, "Auslagerung");
  return freigabeImProbeRepo(context, { verzeichnis, basis });
}

function bleibtPruefung(lauf) {
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Art art:pruefung\./);
  assert.match(grundZeile(lauf.stdout), /anfrage-mit-frist\.json/);
}

test("Freigabe: ein wortgleicher Umzug mit genau nachgerechneter Frist-Liste ist art:code ohne Freigabe", async (context) => {
  codeOhneFreigabe(await freigabe(context, { [LISTE]: listeText([NEU, FREMD]) }));
});

test("Freigabe: wächst die Frist-Liste beim Umzug um einen Eintrag, bleibt sie art:pruefung", async (context) => {
  bleibtPruefung(await freigabe(context, { [LISTE]: listeText([ALT, NEU, FREMD]) }));
});

test("Freigabe: ein Eintrag ohne passende Stelle in der neuen Datei bleibt art:pruefung", async (context) => {
  const lauf = await freigabe(context, { [NEU]: datei(HOLE_ANDERS), [LISTE]: listeText([NEU, FREMD]) });
  bleibtPruefung(lauf);
});

test("Freigabe: wird ein Eintrag ohne jeden Umzug getauscht, bleibt die Frist-Liste art:pruefung", async (context) => {
  bleibtPruefung(await freigabe(context, { [ALT]: datei(HOLE, BLEIBT), [LISTE]: listeText([NEU, FREMD]) }));
});
