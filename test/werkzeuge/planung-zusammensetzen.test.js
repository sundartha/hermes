import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { setzePhaseZusammen } from "../../tools/auftrag/planung/zusammensetzen.mjs";
import { REPO_ROOT, probeRepository, runIn } from "./probe-repo.js";

const SKILL = join(REPO_ROOT, ".claude/skills/pitch");
const KOPIEN = { "beispiel.md": "pitch.md", "design-beispiel.md": "design.md", "sicherheit-beispiel.md": "sicherheit.md" };
const KENNUNG = "P-001-eigene-nummer";
const ROUTE = "src/routes/api-onboard.js";
const HINWEIS = "src/callee-is-owner.js";
const BESTEHENDER_TEST = "test/anrufe/anrufreserve.test.js";
const NIE_SATZ = "Nicht Teil dieser Änderung: eine zweite eigene Nummer pro Kunde, weil heute jeder Kunde genau eine eigene Nummer hinterlegt.";
const EXIT_GRUEN = 0;
const EINRUECKUNG = 2;

const ROUTE_QUELLE = [
  "export function registriere(router) {",
  '  router.post("/api/self-service/private-number", function hinterlege(anfrage) {',
  "    return anfrage;",
  "  });",
  '  router.post("/api/self-service/private-number/confirm", function bestaetige(anfrage) {',
  "    return anfrage;",
  "  });",
  "}",
  "",
  "export function speichereStatus(status) {",
  '  const werkzeug = "place_call";',
  "  const kopie = { status, werkzeug };",
  "  return kopie;",
  "}",
  "",
].join("\n");
const HINWEIS_QUELLE = [
  "export function nimmAnruf(nummer) {",
  '  const werkzeug = "place_call";',
  "  return { werkzeug, nummer };",
  "}",
  "",
  "export function setzeHinweis(nummer) {",
  "  const text = nummer;",
  "  return text;",
  "}",
  "",
].join("\n");
const PROBE_QUELLEN = {
  ".gitignore": "node_modules\n",
  "package.json": JSON.stringify({ type: "module" }),
  "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
  ".github/CODEOWNERS": "/src/geschuetzt.js @owner\n",
  "tools/bereiche.json": JSON.stringify([
    { bereich: "anrufe", quellen: ["^src/callee-is-owner\\.js$"], eingaenge: [], fachlogik: [] },
    { bereich: "nummern", quellen: ["^src/routes/"], eingaenge: [], fachlogik: [] },
  ]),
  [ROUTE]: ROUTE_QUELLE,
  [HINWEIS]: HINWEIS_QUELLE,
  [BESTEHENDER_TEST]: `import { nimmAnruf } from "../../${HINWEIS}";\n\nnimmAnruf("x");\n`,
};
const ROUTE_NUMMERN = ["S1", "S7", "T2"];
const BESTAETIGUNG_NUMMERN = ["S2", "S3", "S6", "T1"];
const ANRUF_NUMMERN = ["S4", "S5", "B1"];

function stelle(rolle, datei, ort) {
  return { rolle, datei, ...ort };
}

function wegVon(nummer, nurRoute) {
  if (ANRUF_NUMMERN.includes(nummer) && !nurRoute) return { weg: [stelle("eingang", HINWEIS, { funktion: "nimmAnruf", von: 1, bis: 4 }), stelle("wirkung", HINWEIS, { funktion: "setzeHinweis", von: 6, bis: 9 })], aenderung: { datei: HINWEIS, funktion: "setzeHinweis", von: 6, bis: 9 } };
  const eingang = ROUTE_NUMMERN.includes(nummer) ? stelle("eingang", ROUTE, { funktion: "hinterlege", von: 2, bis: 4 }) : stelle("eingang", ROUTE, { funktion: "bestaetige", von: 5, bis: 7 });
  return { weg: [eingang, stelle("wirkung", ROUTE, { funktion: "speichereStatus", von: 10, bis: 14 })], aenderung: { datei: ROUTE, funktion: "speichereStatus", von: 10, bis: 14 } };
}

function berichtVon(nummer, nurRoute = false) {
  const { weg, aenderung } = wegVon(nummer, nurRoute);
  return {
    gruppe: [nummer],
    nummern: {
      [nummer]: {
        weg,
        aenderungen: [{ ...aenderung, neueZeilen: 3 }],
        tests: [BESTEHENDER_TEST],
        vorbild: aenderung.datei,
        schema: { aenderung: false, fundstelle: `${aenderung.datei} Zeile 1` },
        codeowners: [],
        ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
        eingangImTest: "erreichbar",
        widersprueche: [],
      },
    },
  };
}

function berichte(ueberschrieben = {}, nurRoute = false) {
  const alle = [...ROUTE_NUMMERN, ...BESTAETIGUNG_NUMMERN, ...ANRUF_NUMMERN];
  return alle.map((nummer) => ueberschrieben[nummer] ?? berichtVon(nummer, nurRoute));
}

function ordnerMitDokumenten(context) {
  const wurzel = probeRepository(context, PROBE_QUELLEN);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(wurzel, "node_modules"));
  const ordner = join(wurzel, "plaene", KENNUNG);
  mkdirSync(ordner, { recursive: true });
  for (const [quelle, ziel] of Object.entries(KOPIEN)) copyFileSync(join(SKILL, quelle), join(ordner, ziel));
  return ordner;
}

function wurzelVon(ordner) {
  return resolve(ordner, "..", "..");
}

function dokument(ordner, name) {
  return readFileSync(join(ordner, name), "utf8").split("\n");
}

function blockNach(zeilen, stelle) {
  const ende = zeilen.findIndex((zeile, nr) => nr > stelle && (zeile.trim() === "" || zeile.startsWith("#")));
  return zeilen.slice(stelle + 1, ende === -1 ? zeilen.length : ende);
}

function pitchSzenario(ordner, nummer) {
  const zeilen = dokument(ordner, "pitch.md");
  return blockNach(zeilen, zeilen.findIndex((zeile) => zeile.includes(`Szenario ${nummer}:`))).join("\n");
}

function angriffsweg(ordner, nummer) {
  const zeilen = dokument(ordner, "sicherheit.md");
  const start = zeilen.findIndex((zeile) => zeile.startsWith(`### ${nummer}:`));
  const szenario = zeilen.findIndex((zeile, nr) => nr > start && zeile.startsWith("Szenario"));
  const kopf = zeilen[szenario].replace(/^Szenario[^:]*:/, "");
  return [kopf, ...blockNach(zeilen, szenario)].filter((zeile) => zeile.trim() !== "").join("\n");
}

function auftrag(id, bereich, { prueft, abnahme, abhaengigVon, ...zusatz }) {
  return {
    id,
    art: "funktion",
    ziel: `Ziel ${id}`,
    bereich,
    erwarteteDateien: [bereich, abnahme],
    vorbild: bereich,
    abnahme,
    erwarteterFehler: "bestaetigt",
    wasDarfNiePassieren: [],
    prueft,
    abhaengigVon,
    eingang: "erreicht",
    ...zusatz,
  };
}

const UMBAU = {
  id: "a0",
  art: "umbau",
  ziel: "Zieh die Prüfung heraus",
  bereich: HINWEIS,
  erwarteteDateien: [HINWEIS, BESTEHENDER_TEST],
  vorbild: HINWEIS,
  abnahme: BESTEHENDER_TEST,
  prueft: UMBAU_AUSWEG,
  abhaengigVon: [],
  altfunktionen: [],
  schema: "vertraeglich",
  bereichsgrund: "Der Umbau liegt im selben Bereich wie sein Test",
};

function schnittliste(ueberschrieben = {}) {
  return {
    annahmen: [],
    fehlendeSzenarien: [],
    ownerAufgaben: [],
    gemeinsameNamen: [{ name: "bestaetigt", anbieter: ROUTE, nutzer: HINWEIS }],
    auftraege: [
      UMBAU,
      erster(),
      auftrag("a2", ROUTE, { prueft: ["S2", "S3", "S6", "T1"], abnahme: "test/nummern/eigene-nummer-bestaetigen.test.js", abhaengigVon: [{ id: "a1", grund: "braucht den gespeicherten Code" }] }),
      auftrag("a3", HINWEIS, { prueft: ["S4", "S5", "B1"], abnahme: "test/anrufe/hinweis-eigene-nummer.test.js", abhaengigVon: [{ id: "a2", grund: "liest den Status bestaetigt" }, { id: "a0", grund: "nutzt die herausgezogene Prüfung" }] }),
    ],
    ...ueberschrieben,
  };
}

function erster() {
  return auftrag("a1", ROUTE, { prueft: ["S1", "S7", "T2"], abnahme: "test/nummern/eigene-nummer-hinterlegen.test.js", abhaengigVon: [] });
}

function entwuerfe(ueberschrieben = {}) {
  return {
    [ROUTE]: "Grundlage: design.md, Lösung\nStatus `bestaetigt` setzen.\nFehlerfälle: SMS-Fehler: Status bleibt",
    [HINWEIS]: "Grundlage: design.md, Lösung, Schritt 3\nliest bestaetigt\nFehlerfälle: keine",
    ...ueberschrieben,
  };
}

function zusammen(ordner, { schnitt = schnittliste(), entwurf = entwuerfe(), bericht = berichte() } = {}) {
  return setzePhaseZusammen(ordner, { schnitt, berichte: bericht, entwuerfe: entwurf, root: wurzelVon(ordner) });
}

function phaseDatei(ordner) {
  return join(ordner, "phase.json");
}

function dateienIn(ordner) {
  return readdirSync(ordner).sort();
}

function werkzeug(ordner, skript, ...argumente) {
  return runIn(wurzelVon(ordner), process.execPath, [join(REPO_ROOT, skript), ...argumente]);
}

function hatPhase(ordner) {
  return dateienIn(ordner).includes("phase.json");
}

function rot(ordner, ergebnis, teil) {
  assert.ok(ergebnis.befunde.length > 0, "erwartet Befunde");
  assert.ok(ergebnis.befunde.some((befund) => befund.includes(teil)), `kein Befund mit „${teil}“: ${ergebnis.befunde.join(" | ")}`);
  assert.equal(hatPhase(ordner), false);
}

test("zusammensetzen: ein vollständiger Schnitt ergibt eine Phase, die tools/auftrag.mjs und die Abdeckungsprüfung bestehen", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const ergebnis = await zusammen(ordner);
  assert.deepEqual(ergebnis.befunde, []);
  assert.equal(werkzeug(ordner, "tools/auftrag.mjs", "pruefe", phaseDatei(ordner)).status, EXIT_GRUEN);
  assert.equal(werkzeug(ordner, "tools/abdeckung-pruefen.mjs", ordner).status, EXIT_GRUEN);
  assert.deepEqual(JSON.parse(readFileSync(phaseDatei(ordner), "utf8")), JSON.parse(JSON.stringify(ergebnis.phase)));
});

test("zusammensetzen: die Szenariotexte stehen wörtlich aus Pitch und Sicherheitsdokument in der Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const { phase } = await zusammen(ordner);
  const szenarien = Object.assign({}, ...phase.auftraege.map((eintrag) => eintrag.szenarien));
  assert.equal(szenarien.S1, pitchSzenario(ordner, "S1"));
  assert.equal(szenarien.B1, pitchSzenario(ordner, "B1"));
  assert.equal(szenarien.T2, angriffsweg(ordner, "T2"));
  assert.equal(szenarien.T1, angriffsweg(ordner, "T1"));
  assert.ok(!("T3" in szenarien));
  assert.ok(szenarien.T2.startsWith("Gegeben"));
});

test("zusammensetzen: Aufträge steht direkt vor Fehlerfälle und Reihenfolge ist die letzte Zeile", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const { phase } = await zusammen(ordner);
  assert.deepEqual(phase.entwurf[ROUTE].split("\n"), [
    "Grundlage: design.md, Lösung",
    "Status `bestaetigt` setzen.",
    "Aufträge: a1: Ziel a1; a2: Ziel a2",
    "Fehlerfälle: SMS-Fehler: Status bleibt",
    "Reihenfolge: a2 nach a1: braucht den gespeicherten Code",
  ]);
  const hinweisZeilen = phase.entwurf[HINWEIS].split("\n");
  assert.deepEqual(hinweisZeilen.slice(-3), [
    "Aufträge: a0: Zieh die Prüfung heraus; a3: Ziel a3",
    "Fehlerfälle: keine",
    "Reihenfolge: a3 nach a2: liest den Status bestaetigt; a3 nach a0: nutzt die herausgezogene Prüfung",
  ]);
});

test("zusammensetzen: ein Bereich ohne Vorgänger endet mit „Reihenfolge: keine Vorgänger“", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const alleNummern = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "B1", "T1", "T2"];
  const schnitt = schnittliste({ auftraege: [auftrag("a1", ROUTE, { prueft: alleNummern, abnahme: "test/nummern/eigene-nummer-hinterlegen.test.js", abhaengigVon: [] })], gemeinsameNamen: [] });
  const { phase } = await zusammen(ordner, { schnitt, entwurf: { [ROUTE]: entwuerfe()[ROUTE] }, bericht: berichte({}, true) });
  const zeilen = phase.entwurf[ROUTE].split("\n");
  assert.equal(zeilen.at(-1), "Reihenfolge: keine Vorgänger");
});

test("zusammensetzen: ein Entwurf ohne Fehlerfälle bekommt Aufträge als vorletzte Zeile", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const { phase } = await zusammen(ordner, { entwurf: entwuerfe({ [HINWEIS]: "Grundlage: design.md, Lösung, Schritt 3\nliest bestaetigt" }) });
  const zeilen = phase.entwurf[HINWEIS].split("\n");
  assert.equal(zeilen.at(-2), "Aufträge: a0: Zieh die Prüfung heraus; a3: Ziel a3");
  assert.ok(zeilen.at(-1).startsWith("Reihenfolge: a3 nach a2"));
});

test("zusammensetzen: Felder nur der Schnittliste fehlen in der Phase, Sätze und Vorgänger werden zu Listen, der Umbau hat den Ausweg", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const schnitt = schnittliste();
  schnitt.auftraege[1] = auftrag("a1", ROUTE, {
    prueft: ["S1", "S7", "T2"],
    abnahme: "test/nummern/eigene-nummer-hinterlegen.test.js",
    abhaengigVon: [],
    schema: "vertraeglich",
    eingang: "erreicht",
    falscheAngaben: [],
    wasDarfNiePassieren: [],
  });
  schnitt.auftraege[2].wasDarfNiePassieren = [];
  const { phase } = await zusammen(ordner, { schnitt });
  const [umbau, a1, a2, a3] = phase.auftraege;
  for (const eintrag of phase.auftraege) {
    for (const feld of ["altfunktionen", "schema", "eingang", "bereichsgrund", "falscheAngaben"]) assert.ok(!(feld in eintrag), `${eintrag.id} hat ${feld}`);
  }
  assert.deepEqual(a1.wasDarfNiePassieren, []);
  assert.deepEqual(a2.abhaengigVon, ["a1"]);
  assert.deepEqual(a3.abhaengigVon, ["a2", "a0"]);
  assert.equal(umbau.prueft, UMBAU_AUSWEG);
  assert.ok(!("szenarien" in umbau));
});

test("zusammensetzen: nur die Sätze aus wasDarfNiePassieren landen als Liste in der Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const schnitt = schnittliste();
  const eintraege = [{ satz: NIE_SATZ, quelle: "pitch.md", abschnitt: "## Nicht-Ziele" }];
  schnitt.auftraege[1].wasDarfNiePassieren = eintraege;
  const ergebnis = await zusammen(ordner, { schnitt });
  const { auftraege } = ergebnis.phase;
  assert.deepEqual(auftraege[1].wasDarfNiePassieren, [NIE_SATZ]);
});

test("zusammensetzen: fehlt der Entwurf eines Bereichs, gibt es einen Befund und keine Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const ergebnis = await zusammen(ordner, { entwurf: { [ROUTE]: entwuerfe()[ROUTE] } });
  rot(ordner, ergebnis, `Entwurf für den Bereich ${HINWEIS} fehlt`);
});

test("zusammensetzen: ein Entwurf, der Zahl oder Objekt ist, ergibt den Befund „fehlt“, keinen Absturz und keine Phase", async (context) => {
  for (const kaputt of [42, { text: "liest bestaetigt" }]) {
    const ordner = ordnerMitDokumenten(context);
    const ergebnis = await zusammen(ordner, { entwurf: entwuerfe({ [HINWEIS]: kaputt }) });
    rot(ordner, ergebnis, `Entwurf für den Bereich ${HINWEIS} fehlt`);
    rot(ordner, ergebnis, `gemeinsamer Name bestaetigt steht nicht wörtlich im Entwurf von ${HINWEIS}`);
  }
});

test("zusammensetzen: ein Entwurf mit eigener Aufträge- oder Reihenfolge-Zeile wird abgelehnt", async (context) => {
  for (const zeile of ["Aufträge: a1: selbst geschrieben", "Reihenfolge: keine Vorgänger"]) {
    const ordner = ordnerMitDokumenten(context);
    const ergebnis = await zusammen(ordner, { entwurf: entwuerfe({ [ROUTE]: `Grundlage: design.md\n${zeile}\nFehlerfälle: keine` }) });
    rot(ordner, ergebnis, `Entwurf für ${ROUTE} enthält schon eine Zeile`);
  }
});

test("zusammensetzen: ein Entwurf für einen Bereich ohne Auftrag wird abgelehnt", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const ergebnis = await zusammen(ordner, { entwurf: entwuerfe({ "src/fremd.js": "Grundlage: design.md" }) });
  rot(ordner, ergebnis, "Entwurf für src/fremd.js gehört zu keinem Auftrag");
});

test("zusammensetzen: ein gemeinsamer Name, der in einem Entwurf wörtlich fehlt, nennt Name und Bereich", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const ergebnis = await zusammen(ordner, { entwurf: entwuerfe({ [HINWEIS]: "Grundlage: design.md, Lösung, Schritt 3\nliest den Status\nFehlerfälle: keine" }) });
  rot(ordner, ergebnis, `gemeinsamer Name bestaetigt steht nicht wörtlich im Entwurf von ${HINWEIS}`);
  assert.ok(!ergebnis.befunde.some((befund) => befund.includes(`Entwurf von ${ROUTE}`)));
});

test("zusammensetzen: Befunde der Phasenprüfung verhindern die Phase, und eine vorhandene bleibt Byte für Byte erhalten", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const alt = Buffer.from('{"alt":true}\n');
  writeFileSync(phaseDatei(ordner), alt);
  const schnitt = schnittliste();
  schnitt.auftraege[1].ziel = "Bestätige den Anruf\nund speichere den Status";
  const ergebnis = await zusammen(ordner, { schnitt });
  assert.ok(ergebnis.befunde.some((befund) => befund.startsWith("a1:") && befund.includes("ziel muss eine Zeile")), ergebnis.befunde.join(" | "));
  assert.deepEqual(readFileSync(phaseDatei(ordner)), alt);
  assert.deepEqual(dateienIn(ordner), ["design.md", "phase.json", "pitch.md", "sicherheit.md"]);
});

test("zusammensetzen: eine Nummer, die in der Schnittliste fehlt, ergibt den Befund „steht bei keiner Funktion“ und keine Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const schnitt = schnittliste();
  schnitt.auftraege[1].prueft = ["S1", "S7"];
  const ergebnis = await zusammen(ordner, { schnitt });
  rot(ordner, ergebnis, "T2 steht bei keiner Funktion und keiner Fehlerbehebung");
});

test("zusammensetzen: eine ungültige Schnittliste ergibt einen Befund mit „Regel Form“ und keine Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const schnitt = schnittliste();
  schnitt.auftraege[2].abhaengigVon = [{ id: "a1" }];
  const ergebnis = await zusammen(ordner, { schnitt });
  rot(ordner, ergebnis, "Regel Form");
});

test("zusammensetzen: nach Erfolg liegt neben den Dokumenten nur phase.json im Ordner", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  assert.deepEqual((await zusammen(ordner)).befunde, []);
  assert.deepEqual(dateienIn(ordner), ["design.md", "phase.json", "pitch.md", "sicherheit.md"]);
  assert.equal(readFileSync(phaseDatei(ordner), "utf8").endsWith("\n"), true);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(phaseDatei(ordner), "utf8")), null, EINRUECKUNG) + "\n", readFileSync(phaseDatei(ordner), "utf8"));
});

test("zusammensetzen: eine Schnittliste ohne Auftrag a1 ergibt einen Befund mit „Regel Durchstich“ und keine Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const schnitt = schnittliste();
  const [umbau, , zweiter, dritter] = schnitt.auftraege;
  zweiter.prueft = ["S1", "S7", "T2", ...zweiter.prueft];
  zweiter.abhaengigVon = [];
  schnitt.auftraege = [umbau, zweiter, dritter];
  const ergebnis = await zusammen(ordner, { schnitt });
  rot(ordner, ergebnis, "Regel Durchstich");
});

test("zusammensetzen: null in gemeinsameNamen und in wasDarfNiePassieren ergibt je einen Befund, keinen Absturz und keine Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const schnitt = schnittliste({ gemeinsameNamen: [null] });
  schnitt.auftraege[1].wasDarfNiePassieren = [null];
  const ergebnis = await zusammen(ordner, { schnitt });
  rot(ordner, ergebnis, "Regel Gemeinsame Namen");
  rot(ordner, ergebnis, "Regel Nie-Sätze");
  assert.equal(ergebnis.befunde.length, 2, ergebnis.befunde.join(" | "));
});

test("zusammensetzen: ein Erkundungsbericht mit Befund ergibt einen Befund mit „Regel Erkundung“ und keine Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const bericht = berichtVon("S1");
  bericht.nummern.S1.tests = ["test/gibt-es-nicht.test.js"];
  const ergebnis = await zusammen(ordner, { bericht: berichte({ S1: bericht }) });
  rot(ordner, ergebnis, "Regel Erkundung");
});

function absichtImPitch(ordner) {
  const zeilen = dokument(ordner, "pitch.md");
  const start = zeilen.indexOf("## Absicht");
  const ende = zeilen.findIndex((zeile, nr) => nr > start && zeile.startsWith("## "));
  return zeilen.slice(start + 1, ende).join("\n").trim();
}

test("zusammensetzen: die Absicht aus pitch.md steht wörtlich und einmal für alle Aufträge in phase.json", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  assert.deepEqual((await zusammen(ordner)).befunde, []);
  const phase = JSON.parse(readFileSync(phaseDatei(ordner), "utf8"));
  assert.ok(absichtImPitch(ordner).length > 0);
  assert.equal(phase.absicht, absichtImPitch(ordner));
  assert.deepEqual(Object.keys(phase), ["phase", "absicht", "entwurf", "auftraege"]);
});

test("zusammensetzen: ein Pitch ohne Abschnitt „Absicht“ ergibt einen Befund und keine Phase", async (context) => {
  const ordner = ordnerMitDokumenten(context);
  const ohne = readFileSync(join(ordner, "pitch.md"), "utf8").replace(/^## Absicht\n[^#]*/m, "");
  writeFileSync(join(ordner, "pitch.md"), ohne);
  rot(ordner, await zusammen(ordner), "pitch.md hat keinen Abschnitt „## Absicht“");
});
