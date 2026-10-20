import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { fuerDenPitch, nachpruefSchluessel, planweiteSchluessel, prueflisteSoll } from "../../tools/auftrag/planung/antworten.mjs";
import { REGEL, schnittBefunde } from "../../tools/auftrag/planung/schnitt.mjs";
import { probeMitEslint } from "./eslint-probe.js";
import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const AUFTRAG_TOOL = join(REPO_ROOT, "tools/auftrag.mjs");
const ORDNER = "plaene/P-003-umbau";
const EXIT_SCHNITT_BEFUNDE = 4;
const DURCHSTICH_ZEILE = "durchstich:a1";
const REGEL_DURCHSTICH = `Regel ${REGEL.durchstich}: `;
const UMBAU_PITCH = [
  "# P-003 Umbau",
  "",
  "## Anforderungen",
  "",
  "keine neuen, weil sich nach außen nichts zeigt; das Prüfbare steht unter „Bleibt unverändert“",
  "",
  "## Bleibt unverändert",
  "",
  "keins, weil die bestehenden Tests das Verhalten unverändert prüfen",
  "",
].join("\n");
const SICHERHEIT = ["# P-003 Umbau: Sicherheitsprüfung", "", "## 2. Angriffswege", "", "keine Angriffswege gefunden", "", "## 3. Lückenprüfung", ""].join("\n");
const DATEI = "src/rechnen.js";
const ANDERE_DATEI = "src/zaehlen.js";
const NIE = "Eine Zahl wird nie negativ.";
const DATEI_JE_NUMMER = { S1: DATEI, S2: ANDERE_DATEI };
const FREMDE_DATEI = { bereich: ANDERE_DATEI, erwarteteDateien: [ANDERE_DATEI] };
const SOLL = new Map([
  ["S1", { text: "Gegeben die Zahl 2\nWenn sie verdoppelt wird\nDann ist sie 4" }],
  ["S2", { text: "Gegeben die Zahl 2\nWenn sie gezählt wird\nDann ist sie 3" }],
]);

function umbau(id, datei = DATEI) {
  return { id, art: "umbau", ziel: "Zieh die Prüfung heraus", bereich: datei, erwarteteDateien: [datei], vorbild: datei, abnahme: "test/rechnen/bestand.test.js", erwarteterFehler: "keiner", prueft: UMBAU_AUSWEG, abhaengigVon: [], altfunktionen: [] };
}

function funktion(id, nummer, zusatz = {}) {
  const datei = DATEI_JE_NUMMER[nummer];
  const abnahme = `test/rechnen/${id}-neu.test.js`;
  const nie = [{ satz: NIE, quelle: "pitch.md", abschnitt: "## Nicht-Ziele" }];
  return { id, art: "funktion", ziel: `Ziel ${id}`, bereich: datei, erwarteteDateien: [datei], vorbild: datei, abnahme, erwarteterFehler: "fehlt", wasDarfNiePassieren: nie, prueft: [nummer], abhaengigVon: [], eingang: "erreicht", ...zusatz };
}

function schnittMit(auftraege) {
  return { annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege };
}

function aenderung(datei, funktionsname) {
  return { aenderungen: [{ datei, funktion: funktionsname, von: 1, bis: 3, neueZeilen: 2 }], codeowners: [], ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist", schema: { aenderung: false, fundstelle: `${datei} Zeile 1` } };
}

function pruefeSchnitt(context, auftraege, pitch = {}) {
  const root = probeDirectory(context, {
    ".github/CODEOWNERS": "/src/geschuetzt.js @owner\n",
    "tools/bereiche.json": JSON.stringify([{ bereich: "rechnen" }]),
    "test/rechnen/bestand.test.js": "",
  });
  const berichte = [{ gruppe: ["S1"], nummern: { S1: aenderung(DATEI, "verdopple") } }, { gruppe: ["S2"], nummern: { S2: aenderung(ANDERE_DATEI, "zaehle") } }];
  const dateikarte = auftraege.filter(({ art }) => art === "umbau").map(({ erwarteteDateien, abnahme }) => ({ datei: erwarteteDateien[0], tests: [abnahme] }));
  const eingaben = { soll: SOLL, berichte, funktionsliste: [], dateikarte, dokumente: { "pitch.md": UMBAU_PITCH }, root, ...pitch };
  return schnittBefunde(schnittMit(auftraege), eingaben).befunde;
}

function durchstichBefunde(befunde) {
  return befunde.filter((befund) => befund.startsWith(REGEL_DURCHSTICH)).map((befund) => befund.slice(REGEL_DURCHSTICH.length));
}

function schnittBefehl(context, auftraege) {
  const wurzel = probeMitEslint(context, {
    "tools/bereiche.json": readFileSync(join(REPO_ROOT, "tools/bereiche.json"), "utf8"),
    [DATEI]: "export const verdopple = (zahl) => zahl * 2;\n",
    [ANDERE_DATEI]: "export const zaehle = (zahl) => zahl + 1;\n",
    "test/rechnen/bestand.test.js": 'import "../../src/rechnen.js";\n',
    [`${ORDNER}/pitch.md`]: UMBAU_PITCH,
    [`${ORDNER}/sicherheit.md`]: SICHERHEIT,
  });
  mkdirSync(join(wurzel, ORDNER, "planung"));
  writeFileSync(join(wurzel, ORDNER, "planung/schnitt.json"), JSON.stringify(schnittMit(auftraege)));
  return runIn(wurzel, process.execPath, [AUFTRAG_TOOL, "schnitt", ORDNER]);
}

test("durchstich-nur-umbau: der Befehl schnitt meldet bei einem reinen Umbau-Pitch mit nur Umbauten nichts zur Regel Durchstich", (context) => {
  const lauf = schnittBefehl(context, [umbau("a1"), umbau("a2", ANDERE_DATEI)]);
  assert.equal(lauf.status, EXIT_SCHNITT_BEFUNDE, lauf.stderr + lauf.stdout);
  assert.match(lauf.stdout, /^rot: \d+ Befunde in /m, lauf.stdout);
  assert.doesNotMatch(lauf.stderr, /^Regel Form:/m, lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /^Regel Durchstich:/m, lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /erlaubt nur Umbauten/);
});

test("durchstich-nur-umbau: der Befehl schnitt meldet bei einem reinen Umbau-Pitch eine funktion über die Regel Nummern", (context) => {
  const lauf = schnittBefehl(context, [umbau("a1"), funktion("a2", "S1")]);
  assert.equal(lauf.status, EXIT_SCHNITT_BEFUNDE, lauf.stderr + lauf.stdout);
  assert.match(lauf.stderr, /^Regel Nummern: Pitch ohne Szenarien erlaubt nur Umbauten: a2$/m);
  assert.doesNotMatch(lauf.stderr, /^Regel Form:/m, lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /^Regel Durchstich:/m);
});

const EINGANG = "a1 führt durch den echten Eingang; eingang muss „erreicht“ sein";
const A1_UMBAU = ["a1 ist umbau, der Durchstich ist eine funktion", EINGANG];

test("durchstich-nur-umbau: ohne nurUmbau bleibt die Regel Durchstich, wie sie ist", (context) => {
  const faelle = [
    { name: "nur Umbauten", auftraege: [umbau("a1"), umbau("a2", ANDERE_DATEI)], erwartet: A1_UMBAU },
    { name: "a1 ist ein Umbau vor der funktion", auftraege: [umbau("a1"), funktion("a2", "S1"), funktion("a3", "S2")], erwartet: A1_UMBAU },
    { name: "kein a1", auftraege: [funktion("a2", "S1"), funktion("a3", "S2")], erwartet: ["es gibt keinen Auftrag a1 (Durchstich)"] },
    { name: "eine einzige funktion, nicht a1", auftraege: [umbau("a1"), funktion("a2", "S1", { prueft: ["S1", "S2"], erwarteteDateien: [DATEI, ANDERE_DATEI] })], erwartet: A1_UMBAU },
    { name: "a1 hängt von einer funktion ab", auftraege: [funktion("a1", "S1", { abhaengigVon: [{ id: "a2", grund: "braucht a2" }] }), funktion("a2", "S2")], erwartet: ["a1 hängt von a2 ab, das ist kein Umbau"] },
    { name: "a1 erreicht den Eingang nicht", auftraege: [funktion("a1", "S1", { eingang: "nicht erreicht, weil die Route fehlt" }), funktion("a2", "S2")], erwartet: [EINGANG] },
  ];
  for (const { name, auftraege, erwartet } of faelle) {
    for (const pitch of [{}, { nurUmbau: false }]) assert.deepEqual(durchstichBefunde(pruefeSchnitt(context, auftraege, pitch)), erwartet, name);
  }
});

test("durchstich-nur-umbau: mit nurUmbau gibt es keinen Befund zur Regel Durchstich", (context) => {
  for (const auftraege of [[umbau("a1"), umbau("a2", ANDERE_DATEI)], [umbau("a2")]]) {
    const befunde = pruefeSchnitt(context, auftraege, { nurUmbau: true });
    assert.deepEqual(durchstichBefunde(befunde), [], befunde.join("\n"));
  }
});

test("durchstich-nur-umbau: mit nurUmbau prüft die Regel Änderungen auch a1", (context) => {
  const auftraege = [funktion("a1", "S1", FREMDE_DATEI), funktion("a2", "S2")];
  const ohne = pruefeSchnitt(context, auftraege, { nurUmbau: false });
  const mit = pruefeSchnitt(context, auftraege, { nurUmbau: true });
  const fremd = `a1: Änderungsdatei ${DATEI} von S1 steht weder bei a1 noch in seiner abhaengigVon-Kette`;
  assert.ok(ohne.some((befund) => befund.startsWith(`${REGEL_DURCHSTICH}${fremd}`)), ohne.join("\n"));
  assert.ok(mit.some((befund) => befund.startsWith(`Regel ${REGEL.aenderungen}: ${fremd}`)), mit.join("\n"));
  assert.deepEqual(durchstichBefunde(mit), []);
});

test("durchstich-nur-umbau: die Prüfliste enthält durchstich:a1 genau dann nicht, wenn nurUmbau wahr ist", () => {
  const schnitt = schnittMit([umbau("a1"), umbau("a2", ANDERE_DATEI)]);
  const leer = new Map();
  assert.ok(fuerDenPitch(prueflisteSoll(schnitt, SOLL, [])).includes(DURCHSTICH_ZEILE));
  assert.ok(fuerDenPitch(prueflisteSoll(schnitt, SOLL, []), { nurUmbau: false }).includes(DURCHSTICH_ZEILE));
  assert.deepEqual(fuerDenPitch(prueflisteSoll(schnitt, leer, []), { nurUmbau: true }), prueflisteSoll(schnitt, leer, []).filter((zeile) => zeile !== DURCHSTICH_ZEILE));
  assert.ok(planweiteSchluessel(SOLL).includes(DURCHSTICH_ZEILE));
  assert.ok(!planweiteSchluessel(leer, { nurUmbau: true }).includes(DURCHSTICH_ZEILE));
});

test("durchstich-nur-umbau: die Nachprüfung nach einer Änderung am Schnitt fragt durchstich:a1 nur ohne nurUmbau", () => {
  const vorher = schnittMit([umbau("a1"), umbau("a2", ANDERE_DATEI)]);
  const nachher = schnittMit([umbau("a1"), umbau("a3", ANDERE_DATEI)]);
  const mit = nachpruefSchluessel({ vorher, nachher, befunde: [], soll: new Map(), annahmen: [], nurUmbau: true });
  const ohne = nachpruefSchluessel({ vorher, nachher, befunde: [], soll: new Map(), annahmen: [] });
  assert.ok(ohne.schluessel.includes(DURCHSTICH_ZEILE), ohne.schluessel.join("\n"));
  assert.ok(!mit.schluessel.includes(DURCHSTICH_ZEILE), mit.schluessel.join("\n"));
  assert.ok(mit.schluessel.includes("gegenfrage:alle"), mit.schluessel.join("\n"));
});
