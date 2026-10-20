import assert from "node:assert/strict";
import { test } from "node:test";

import { agentFuer } from "../../tools/auftrag/agenten.mjs";
import { sperrSchluessel } from "../../tools/auftrag/bereiche.mjs";
import { bereichSchluessel, gehoertZumBereich, istTestbereich, phasenBefunde } from "../../tools/auftrag/format.mjs";
import { AUSSERHALB, grenzBefunde } from "../../tools/auftrag/pruefungen.mjs";
import { auftragAusSchnitt } from "../../tools/auftrag/planung/zusammensetzen.mjs";
import { REGEL, schnittBefunde } from "../../tools/auftrag/planung/schnitt.mjs";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";

const ROUTE = "src/routes/voice.js";
const POLITIK = "src/route-policy.js";
const PROBE = "scripts/probe-auth.sh";
const LISTE = [ROUTE, POLITIK, PROBE];
const VIERTE = "src/routes/api-calls.js";
const KOPPELND = "test/probe-auth-table.test.js";
const EINZELN = "test/route-policy.test.js";
const NEUER_TEST = "test/routen/alte-route-antwortet-nicht.test.js";
const GRUND = `Route, Politik-Eintrag und Probe-Zeile fallen nur gemeinsam: ${KOPPELND}:92-116`;
const KOPPELND_TEXT = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  `const GEKOPPELT = ["${POLITIK}", "${PROBE}"];`,
  'test("jede Route der Politik steht in der Probe-Tabelle", () => assert.equal(GEKOPPELT.length, 2));',
  "",
].join("\n");
const EINZELN_TEXT = `const NUR = "${POLITIK}";\n`;
const CODEOWNERS = "/src/geschuetzt.js @owner\n";
const GLEICHER_NAME = ["src/a/index.js", "lib/b/index.js"];
const NUR_NAME = "test/nur-name.test.js";
const TEILNAMEN = "test/teilnamen.test.js";

function wurzel(context) {
  return probeDirectory(context, {
    ".github/CODEOWNERS": CODEOWNERS,
    [KOPPELND]: KOPPELND_TEXT,
    [EINZELN]: EINZELN_TEXT,
    [NUR_NAME]: 'import "../anderswo/index.js";\n',
    [TEILNAMEN]: 'const NAMEN = ["src/routes/invoice.js", "voice.json", "probe-auth.sh"];\n',
    "tools/bereiche.json": JSON.stringify([{ bereich: "routen" }, { bereich: "anrufe" }]),
  });
}

function phaseMit(ueberschrieben = {}, entwurf = undefined) {
  const auftrag = { id: "a1", art: "umbau", ziel: "Entferne die alte Route", bereich: LISTE, bereichsgrund: GRUND, erwarteteDateien: [...LISTE, KOPPELND], abnahme: KOPPELND, ...ueberschrieben };
  return { phase: "probe", entwurf: entwurf ?? { [bereichSchluessel(auftrag.bereich)]: "Entwurf." }, auftraege: [auftrag] };
}

function formBefunde(context, ueberschrieben, entwurf) {
  return phasenBefunde(phaseMit(ueberschrieben, entwurf), wurzel(context));
}

function enthaelt(befunde, teil) {
  assert.ok(befunde.some((befund) => befund.includes(teil)), `${teil} fehlt in\n${befunde.join("\n")}`);
}

test("Formprüfung: eine Liste genau der gekoppelten Dateien mit koppelndem Test in bereichsgrund ist grün", (context) => {
  assert.deepEqual(formBefunde(context, {}), []);
  assert.deepEqual(formBefunde(context, { bereich: [PROBE, ROUTE, POLITIK] }), []);
});

test("Formprüfung: eine vierte Produktdatei in erwarteteDateien oder ein fehlender Listeneintrag ist rot", (context) => {
  enthaelt(formBefunde(context, { erwarteteDateien: [...LISTE, VIERTE, KOPPELND] }), `erwartete Datei ${VIERTE} liegt nicht im Bereich`);
  enthaelt(formBefunde(context, { erwarteteDateien: [ROUTE, POLITIK, KOPPELND] }), `Listeneintrag ${PROBE} fehlt`);
});

const ZWILLING = "src/routes/voice.ts";
const ZWILLINGSFAELLE = [
  [[...LISTE, ZWILLING], true],
  [[ZWILLING, POLITIK, PROBE], true],
  [[...LISTE, "src/routes/voice.mts"], false],
  [[...LISTE, "src/routes/andere.ts"], false],
  [[ZWILLING, POLITIK], false],
];

test("Zwilling: der ts-Zwilling eines Listeneintrags zählt in Formprüfung und Schnittprüfung als dieser Eintrag, andere Dateien nicht", (context) => {
  for (const [dateien, gruen] of ZWILLINGSFAELLE) {
    const form = formBefunde(context, { erwarteteDateien: [...dateien, KOPPELND] });
    const schnitt = bereichsBefunde(schnittMit(context, { erwarteteDateien: [...dateien, NEUER_TEST] }));
    assert.equal(form.length === 0, gruen, `Form ${dateien.join(", ")}: ${form.join("\n")}`);
    assert.equal(schnitt.length === 0, gruen, `Schnitt ${dateien.join(", ")}: ${schnitt.join("\n")}`);
  }
});

test("Formprüfung: eine Liste ohne bereichsgrund oder ohne bestehenden Test, der zwei ihrer Dateien nennt, ist rot", (context) => {
  const faelle = [
    [{ bereichsgrund: undefined }, "braucht bereichsgrund"],
    [{ bereichsgrund: "Die drei Dateien gehören zusammen" }, "nennt keinen bestehenden Test"],
    [{ bereichsgrund: "Gekoppelt in test/gibt-es-nicht.test.js" }, "nennt keinen bestehenden Test"],
    [{ bereichsgrund: `Gekoppelt in ${EINZELN}` }, "nennt keinen bestehenden Test"],
  ];
  for (const [ueberschrieben, teil] of faelle) enthaelt(formBefunde(context, ueberschrieben), teil);
});

test("Formprüfung: haben zwei Listeneinträge denselben Dateinamen, koppelt ein Test, der nur diesen Namen nennt, die Liste nicht", (context) => {
  const liste = { bereich: GLEICHER_NAME, erwarteteDateien: [...GLEICHER_NAME, KOPPELND], bereichsgrund: `Gekoppelt in ${NUR_NAME}` };
  enthaelt(formBefunde(context, liste), "nennt keinen bestehenden Test");
});

test("Formprüfung: ein Test, der Pfad oder Dateinamen eines Eintrags nur als Teil eines anderen Namens enthält, nennt diesen Eintrag nicht", (context) => {
  const bereich = [ROUTE, PROBE];
  enthaelt(formBefunde(context, { bereich, erwarteteDateien: [...bereich, KOPPELND], bereichsgrund: `Gekoppelt in ${TEILNAMEN}` }), "nennt keinen bestehenden Test");
});

test("Formprüfung: eine Liste, deren Dateien einen engeren gemeinsamen Ordner als die Wurzel haben, ist rot", (context) => {
  const bereich = [ROUTE, POLITIK];
  enthaelt(formBefunde(context, { bereich, erwarteteDateien: [...bereich, KOPPELND] }), "liegen gemeinsam in src/; nimm diesen Ordner als bereich");
});

test("Formprüfung: eine Liste mit einem Eintrag, einem Ordner, der Wurzel oder einem doppelten Eintrag ist rot", (context) => {
  const faelle = [
    [[ROUTE], "mindestens 2 Dateien"],
    [["src/routes/", PROBE], 'Listeneintrag "src/routes/" ist kein Dateipfad'],
    [["/", PROBE], 'Listeneintrag "/" ist kein Dateipfad'],
    [[".", PROBE], 'Listeneintrag "." ist kein Dateipfad'],
    [["", PROBE], 'Listeneintrag "" ist kein Dateipfad'],
    [[PROBE, PROBE], `bereich nennt ${PROBE} doppelt`],
  ];
  for (const [bereich, teil] of faelle) enthaelt(formBefunde(context, { bereich, erwarteteDateien: [ROUTE, PROBE, KOPPELND] }), teil);
});

test("Formprüfung: die Repo-Wurzel als bereich bleibt rot", (context) => {
  for (const bereich of ["/", ".", ""]) enthaelt(formBefunde(context, { bereich }, { [bereich]: "Entwurf." }), "bereich muss ein relativer Pfad im Repo sein");
});

test("Formprüfung: eine Liste mit einer Datei aus CODEOWNERS ist rot", (context) => {
  const bereich = ["src/geschuetzt.js", PROBE];
  enthaelt(formBefunde(context, { bereich, erwarteteDateien: [...bereich, KOPPELND] }), "bereich src/geschuetzt.js ist geschützt");
});

test("Formprüfung: ein testumbau mit Liste ist rot", (context) => {
  enthaelt(formBefunde(context, { art: "testumbau", erwarteteDateien: [KOPPELND] }), "ein testumbau braucht einen bereich, der nur Tests umfasst");
});

test("Formprüfung: der Entwurf einer Liste steht unter ihrem Schlüssel, nicht unter einer anderen Schreibweise", (context) => {
  enthaelt(formBefunde(context, {}, { [LISTE.join(",")]: "Entwurf." }), "der Phase fehlt der Entwurfsabschnitt");
  assert.notEqual(bereichSchluessel(LISTE), LISTE.join(","));
});

test("eine Liste gilt Eintrag für Eintrag wie ein Dateibereich und ist kein Testbereich", () => {
  const faelle = [
    [ROUTE, true],
    [PROBE, true],
    ["src/routes/voice.ts", true],
    ["src/routes/voice.d.ts", true],
    ["src/routes/FUNKTIONSKARTE.md", true],
    [VIERTE, false],
    ["src/routes/", false],
    ["scripts/andere.sh", false],
  ];
  for (const [pfad, erwartet] of faelle) assert.equal(gehoertZumBereich(LISTE, pfad), erwartet, pfad);
  assert.equal(gehoertZumBereich(["src/routes/", PROBE], VIERTE), false);
  assert.equal(istTestbereich([KOPPELND, "test/andere.test.js"]), false);
});

test("eine Liste ist kritisch, sobald ein Eintrag kritisch ist, und sperrt jeden Eintrag", async (context) => {
  assert.equal(agentFuer("bau", LISTE), "bau-kritisch");
  assert.equal(agentFuer("bau", ["lib/a.js", "tools/b.mjs"]), "bau");
  const schluessel = await sperrSchluessel(wurzel(context), phaseMit());
  for (const eintrag of LISTE) assert.ok(schluessel.includes(eintrag), `${eintrag} fehlt in ${schluessel.join(", ")}`);
});

test("die Phase übernimmt bereichsgrund nur für einen Listenbereich aus der Schnittliste", () => {
  const eintrag = { id: "a1", art: "umbau", ziel: "Entferne", erwarteteDateien: LISTE, abnahme: KOPPELND, bereichsgrund: GRUND, abhaengigVon: [] };
  assert.equal(auftragAusSchnitt({ ...eintrag, bereich: LISTE }, new Map(), []).bereichsgrund, GRUND);
  assert.equal("bereichsgrund" in auftragAusSchnitt({ ...eintrag, bereich: "src/" }, new Map(), []), false);
});

function angaben(dateien) {
  return {
    aenderungen: dateien.map((datei) => ({ datei, funktion: "route", von: 1, bis: 3, neueZeilen: 10 })),
    codeowners: [],
    ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
    schema: { aenderung: false, fundstelle: `${dateien[0]} Zeile 1` },
  };
}

function schnittMit(context, ueberschrieben = {}, zusatz = {}) {
  const a1 = {
    id: "a1",
    art: "funktion",
    ziel: "Die alte Route antwortet nicht mehr",
    bereich: LISTE,
    bereichsgrund: GRUND,
    erwarteteDateien: [...LISTE, NEUER_TEST],
    abnahme: NEUER_TEST,
    erwarteterFehler: "404",
    wasDarfNiePassieren: [],
    prueft: ["S1"],
    abhaengigVon: [],
    eingang: "erreicht",
    ...ueberschrieben,
  };
  const { weitere = [], ...oben } = zusatz;
  const schnitt = { annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege: [a1, ...weitere], ...oben };
  const soll = new Map([["S1", { text: "Gegeben die alte Route\nWenn sie jemand ruft\nDann gibt es sie nicht mehr" }]]);
  const berichte = [{ gruppe: ["S1"], nummern: { S1: angaben(a1.erwarteteDateien.filter((datei) => !datei.startsWith("test/"))) } }];
  return schnittBefunde(schnitt, { soll, berichte, funktionsliste: [], dateikarte: [], dokumente: { "pitch.md": "# Pitch\n" }, root: wurzel(context) });
}

function regelBefunde({ befunde }, regel) {
  return befunde.filter((befund) => befund.startsWith(`Regel ${regel}: `));
}

function bereichsBefunde(ergebnis) {
  return regelBefunde(ergebnis, REGEL.bereich);
}

test("Schnittprüfung: der P-003-Fall mit Route, Politik und Probe-Zeile als Liste ist ohne Befund", (context) => {
  const ergebnis = schnittMit(context);
  assert.deepEqual(ergebnis.befunde, []);
  assert.ok(ergebnis.annahmen.some(({ auftrag, text }) => auftrag === "a1" && text.includes(KOPPELND)));
});

test("Schnittprüfung: bei Dateien nur unter der Wurzel verlangt sie die Liste, bereich / oder ein Ordner bleiben rot", (context) => {
  for (const bereich of ["/", ".", "", "src/"]) {
    const [befund] = bereichsBefunde(schnittMit(context, { bereich }));
    assert.ok(befund?.includes(`sie verlangen die Liste ${JSON.stringify(LISTE.toSorted())}`), `${bereich}: ${befund}`);
  }
  assert.ok(bereichsBefunde(schnittMit(context, { bereich: bereichSchluessel(LISTE) })).length > 0, "der Schlüssel als Zeichenkette ist keine Liste");
  assert.ok(bereichsBefunde(schnittMit(context, { bereich: [bereichSchluessel(LISTE)] })).length > 0, "der Schlüssel als einziger Listeneintrag ist nicht die Liste");
});

test("Schnittprüfung: eine vierte Produktdatei in erwarteteDateien macht die Liste rot", (context) => {
  const befunde = bereichsBefunde(schnittMit(context, { erwarteteDateien: [...LISTE, VIERTE, NEUER_TEST] }));
  assert.equal(befunde.length, 1, befunde.join("\n"));
  assert.ok(befunde[0].includes(VIERTE), befunde[0]);
});

test("Schnittprüfung: eine Liste ohne bereichsgrund oder mit einem Test, der höchstens eine Datei nennt, ist rot", (context) => {
  for (const bereichsgrund of [undefined, "Die drei gehören zusammen", `Gekoppelt in ${EINZELN}`, "Gekoppelt in test/gibt-es-nicht.test.js"]) {
    const befunde = bereichsBefunde(schnittMit(context, { bereichsgrund }));
    assert.equal(befunde.length, 1, `${bereichsgrund}: ${befunde.join("\n")}`);
  }
});

test("Schnittprüfung: eine Liste, wo ein engerer gemeinsamer Ordner existiert, ist rot und verlangt den Ordner", (context) => {
  const bereich = [ROUTE, POLITIK];
  const befunde = bereichsBefunde(schnittMit(context, { bereich, erwarteteDateien: [...bereich, NEUER_TEST] }));
  assert.ok(befunde.some((befund) => befund.includes(`bereich ist ${bereichSchluessel(bereich)}, die Produktdateien verlangen src/`)), befunde.join("\n"));
});

test("Schnittprüfung: ein gemeinsamer Name nennt die Liste als Liste, nicht ihren Schlüssel als Zeichenkette", (context) => {
  const a2 = {
    id: "a2",
    art: "umbau",
    ziel: "Nutze die neue Prüfung",
    bereich: "src/anrufe/start.js",
    erwarteteDateien: ["src/anrufe/start.js"],
    abnahme: EINZELN,
    prueft: "keiner, weil Umbau: bestehende Tests bleiben unverändert grün",
    abhaengigVon: [{ id: "a1", grund: "Die Prüfung entsteht in a1" }],
  };
  const namen = (anbieter) => regelBefunde(schnittMit(context, {}, { weitere: [a2], gemeinsameNamen: [{ name: "pruefeRoute", anbieter, nutzer: a2.bereich }] }), REGEL.namen);
  assert.deepEqual(namen(LISTE), []);
  assert.equal(namen(bereichSchluessel(LISTE)).length, 1);
});

const LAUF_DATEIEN = {
  [ROUTE]: "export const route = (a, b) => `n=${a - b}`;\n",
  [POLITIK]: "export const POLITIK = 1;\n",
  [PROBE]: "echo alt\n",
  [VIERTE]: "export const API = 1;\n",
  [KOPPELND]: KOPPELND_TEXT,
};
const LAUF_UMBAU = { id: "A1", art: "umbau", ziel: "Entferne die alte Route", bereich: LISTE, bereichsgrund: GRUND, erwarteteDateien: [...LISTE], abnahme: KOPPELND };
const DREI_GEAENDERT = { [ROUTE]: "export const route = (a, b) => `n=${String(a - b)}`;\n", [POLITIK]: "export const POLITIK = 2;\n", [PROBE]: "echo neu\n" };

function laufMit(context, bau) {
  return starte(context, { auftrag: LAUF_UMBAU, drehbuch: { bau }, dateien: LAUF_DATEIEN, phase: { entwurf: { [bereichSchluessel(LISTE)]: "Entwurf." } } });
}

test("Lauf: ändert der Bau-Agent genau die drei Dateien der Liste, endet der Lauf ohne Verstoß", (context) => {
  const { lauf, beleg } = laufMit(context, DREI_GEAENDERT);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const grenze = beleg.pruefungen.find(({ name }) => name === "grenzen bau");
  assert.equal(grenze.exitCode, 0, grenze.zeilen.join("\n"));
});

test("Lauf: ändert der Bau-Agent eine vierte Produktdatei, ist das ein Verstoß außerhalb des Bereichs", (context) => {
  const { lauf, beleg } = laufMit(context, { ...DREI_GEAENDERT, [VIERTE]: "export const API = 2;\n" });
  assert.equal(lauf.status, EXIT_ROT);
  assert.ok(JSON.stringify(beleg).includes(`${AUSSERHALB} ${bereichSchluessel(LISTE)}: ${VIERTE}`), JSON.stringify(beleg));
});

const TS_LISTE = ["src/routes/voice.ts", "scripts/probe.ts"];
const TS_PAARE = [{ alt: "src/routes/voice.js", neu: TS_LISTE[0] }, { alt: "scripts/probe.js", neu: TS_LISTE[1] }];

function umbenennungsVerstoesse(paare, pfade) {
  const auftrag = { id: "A1", art: "umbau", bereich: TS_LISTE, erwarteteDateien: [...TS_LISTE], abnahme: KOPPELND };
  const kontext = { auftrag, rolle: "bau", muster: [], bestand: () => true, paare, bereichDer: () => "gemeinsam" };
  return grenzBefunde(kontext, pfade.map((pfad) => ({ pfad, zeilen: 1 }))).verstoesse;
}

test("Grenzen: bei einer Liste entscheidet bei einer Umbenennung nur die Liste, auch wenn tools/bereiche.json alte und neue Datei in denselben Bereich legt", () => {
  const faelle = [
    [TS_PAARE, TS_LISTE, []],
    [TS_PAARE, [TS_PAARE[0].alt, ...TS_LISTE], [`${AUSSERHALB} ${bereichSchluessel(TS_LISTE)}: ${TS_PAARE[0].alt}`]],
    [[...TS_PAARE, { alt: TS_LISTE[0], neu: "src/routes/neu.ts" }], [...TS_LISTE, "src/routes/neu.ts"], [`${AUSSERHALB} ${bereichSchluessel(TS_LISTE)}: src/routes/neu.ts`]],
  ];
  for (const [paare, pfade, erwartet] of faelle) {
    const verstoesse = umbenennungsVerstoesse(paare, pfade);
    assert.equal(verstoesse.length, erwartet.length, verstoesse.join("\n"));
    for (const teil of erwartet) enthaelt(verstoesse, teil);
  }
});
