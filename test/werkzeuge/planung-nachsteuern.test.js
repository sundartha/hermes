import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, EXIT_ABBRUCH, EXIT_BEFUNDE, EXIT_GETEILT, EXIT_GRUEN, WEGFEHLER, abgelegt, mitIssue, planeAntworten, planungsBericht, teilEintrag as eintrag, vorgaengerGemergt } from "./planung-plane-probe.js";
import { GRUEN_PRUEFLISTE, GRUPPEN, HINTERLEGEN_NUMMERN, HINWEIS, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, mitUmbauZeilen, planOrdner, planeIn } from "./planung-probe.js";
import { RUECKSENDUNGEN } from "../../tools/auftrag/planung/fortschritt.mjs";

const HINTERLEGEN = "plaene/P-001-t1-eigene-nummer-hinterlegen";
const HINWEIS_ORDNER = "plaene/P-001-t2-hinweis-beim-anruf";
const STELLEN = "## Weitere Stellen";
const ELF = Array.from({ length: 11 }, (_, stelle) => `src/stellen/datei-${stelle + 1}.js`);
const TEIL_ISSUE = 77;
const KENNZEICHNUNG = { kostenGebucht: "je Rolle" };

const PLANER_JE_AUFRUF = 1000;
const NEBENROLLE_JE_AUFRUF = 10;
const STELLE_QUELLE = "export const stelle = 1;\n";
const TOTE_DATEIEN = ["src/stellen/alt-1.js", "src/stellen/alt-2.js"];
const FEHLENDER_EINSTIEG = "src/fehlt.js:weg";
const ERSTE_WELLE = GRUPPEN.length;
const ALT_QUELLE = "export function alt() {\n  var wert = 1;\n  return wert;\n}\n";
const EIGENER_UMBAU = `${ELF[0]}:alt`;
const FREMDER_UMBAU = `${ELF[5]}:alt`;

const ELTERN_TEILE = [
  eintrag("t1", "eigene-nummer-hinterlegen", { nummern: ["S1", "S2", "S3", "S6", "S7"], tWege: ["T1", "T2"], dateien: [ROUTE, ...ELF.slice(0, 5)] }),
  eintrag("t2", "hinweis-beim-anruf", { nummern: ["S4", "S5", "B1"], dateien: [HINWEIS, ...ELF.slice(5)], abhaengigVon: ["t1"] }),
];

function elfStellen(wurzel, { quellen, einstiege, stellen, freigabe, umbau }) {
  const elf = Object.fromEntries(ELF.map((datei) => [datei, STELLE_QUELLE]));
  for (const [datei, inhalt] of Object.entries({ ...elf, ...quellen })) {
    mkdirSync(dirname(join(wurzel, datei)), { recursive: true });
    writeFileSync(join(wurzel, datei), inhalt);
  }
  const geaendert = [...ELF.map((datei) => `${datei}:1`), ...stellen];
  appendFileSync(join(wurzel, ORDNER, "design.md"), `\n${STELLEN}\n\n${geaendert.map((stelle) => `Ändert sich: \`${stelle}\``).join("\n")}\n`);
  const pitch = join(wurzel, ORDNER, "pitch.md");
  const loeschAbschnitt = einstiege.length === 0 ? "" : `\n## Löschen\n\n${einstiege.map((einstieg) => `- \`${einstieg}\``).join("\n")}\n`;
  const text = readFileSync(pitch, "utf8");
  const freigegeben = (umbau.length === 0 ? text : mitUmbauZeilen(text, umbau)).replace("Status: fertig", "Status: freigegeben");
  const mitFreigabe = freigabe === undefined ? freigegeben : freigegeben.replace(/^Planung freigegeben: \d+ Token$/mu, `Planung freigegeben: ${freigabe} Token`);
  writeFileSync(pitch, mitFreigabe + loeschAbschnitt);
}

function geteilt(context, { teilung = alsJson({ teile: ELTERN_TEILE }), befunde = [], quellen = {}, einstiege = [], stellen = [], freigabe, umbau = [] } = {}) {
  const wurzel = planOrdner(context);
  elfStellen(wurzel, { quellen, einstiege, stellen, freigabe, umbau });
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: { "planer|## Teilung": [teilung], "planer|## Befunde": befunde }, argumente: ["plane", ORDNER] });
  return { ...lauf, wurzel };
}

function planeTeil(context, wurzel, { ordner, antworten = {}, token = { planer: PLANER_JE_AUFRUF } }) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: {}, ueberschrieben: antworten, argumente: ["plane", ordner], token });
}

function umfangDesHinweisTeils(context, { wurzel, ...teilung }) {
  exit(teilung, EXIT_GETEILT);
  mitIssue(wurzel, HINWEIS_ORDNER, TEIL_ISSUE);
  vorgaengerGemergt(wurzel, HINTERLEGEN);
  const lauf = planeTeil(context, wurzel, { ordner: HINWEIS_ORDNER });
  exit(lauf, EXIT_ABBRUCH);
  return planungsBericht({ wurzel }, HINWEIS_ORDNER).umfang;
}

function mittel({ laeufe, token }) {
  return token / laeufe;
}

test("ein Schritt mit Erkunder und Wegprüfer bucht jede Rolle mit ihren eigenen Sitzungen", { timeout: LAUF_FRIST_MS }, (context) => {
  const [erkunder, pruefer] = [1000, 300];
  const ueberschrieben = { "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, GRUEN_PRUEFLISTE], "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)] };
  const lauf = planeIn(context, planOrdner(context), { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER], token: { planer: NEBENROLLE_JE_AUFRUF, erkunder, "pruefer-planung": pruefer, entwurf: NEBENROLLE_JE_AUFRUF } });

  exit(lauf, EXIT_GRUEN);
  const plan = planungsBericht(lauf);
  const korrigiert = ERSTE_WELLE + 1;
  assert.deepEqual(plan.kostenJeLauf.erkunder, { laeufe: ERSTE_WELLE, token: korrigiert * erkunder });
  assert.deepEqual(plan.kostenJeLauf.wegpruefer, { laeufe: ERSTE_WELLE, token: korrigiert * pruefer });
  assert.equal(mittel(plan.kostenJeLauf["pruefer-planung"]), pruefer);
  assert.equal(plan.kostenGebucht, KENNZEICHNUNG.kostenGebucht);
});

test("ein Teil nur mit B-Szenarien wird in der Teilung zurückgeschickt", { timeout: LAUF_FRIST_MS }, (context) => {
  const nurB = alsJson({ teile: [{ ...ELTERN_TEILE[0], nummern: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"] }, { ...ELTERN_TEILE[1], nummern: ["B1"] }] });
  const lauf = geteilt(context, { teilung: nurB, befunde: [alsJson({ teile: ELTERN_TEILE })] });

  exit(lauf, EXIT_GETEILT);
  const [ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung !== undefined, lauf.stderr);
  assert.ok(ruecksendung.eingabe.includes("Regel Teilung: t2: Abdeckung nicht bestimmbar: pitch.md hat kein Szenario „Szenario S<n>:“"), ruecksendung.eingabe);
  assert.equal(abgelegt(lauf, "teile.json").ruecksendungen, 1);
  assert.equal(existsSync(join(lauf.wurzel, HINWEIS_ORDNER)), true);
});

test("umfang eines Teils zählt nur seine Dateien", { timeout: LAUF_FRIST_MS }, (context) => {
  const umfang = umfangDesHinweisTeils(context, geteilt(context));

  assert.deepEqual(umfang.codeDateien, [HINWEIS, ...ELF.slice(5)].toSorted());
});

test("die Löschmenge eines Teils zählt nur die Dateien dieses Teils", { timeout: LAUF_FRIST_MS }, (context) => {
  const mitToten = ELTERN_TEILE.map((teil, stelle) => ({ ...teil, dateien: [...teil.dateien, TOTE_DATEIEN[stelle]] }));
  const tote = Object.fromEntries(TOTE_DATEIEN.map((datei) => [datei, STELLE_QUELLE]));
  const umfang = umfangDesHinweisTeils(context, geteilt(context, { teilung: alsJson({ teile: mitToten }), quellen: tote, einstiege: TOTE_DATEIEN.map((datei) => `${datei}:stelle`) }));

  assert.deepEqual(umfang.loeschmenge.dateien, [TOTE_DATEIEN[1]]);
});

function kette(nummer) {
  const ordner = `src/kette-${nummer}`;
  return {
    [`${ordner}/a.js`]: `import { b1 } from "./b.js";\n\nexport function a() {\n  return b1();\n}\n`,
    [`${ordner}/b.js`]: `import { c } from "./c.js";\n\nexport function b1() {\n  return c();\n}\n\nexport function b2() {\n  return 2;\n}\n`,
    [`${ordner}/c.js`]: `export function c() {\n  return 3;\n}\n`,
    [`${ordner}/d.js`]: `import { b2 } from "./b.js";\n\nconsole.log(b2());\n`,
    [`test/kette-${nummer}.test.js`]: `import { a } from "../${ordner}/a.js";\n\na();\n`,
  };
}

const GENANNTE_FUNKTIONEN_JE_KETTE = 1;

function ketteImTeil(nummer) {
  return ["a.js", "b.js", "c.js"].map((datei) => `src/kette-${nummer}/${datei}`);
}

test("die Löschmenge eines Teils zählt Exporte, Reste und Funktionen nur aus seinen Dateien und behält betroffene Tests und fehlende Einstiege vollständig", { timeout: LAUF_FRIST_MS }, (context) => {
  const mitKetten = ELTERN_TEILE.map((teil, stelle) => ({ ...teil, dateien: [...teil.dateien, ...ketteImTeil(stelle + 1)] }));
  const einstiege = ["src/kette-1/a.js:a", "src/kette-2/a.js:a", FEHLENDER_EINSTIEG];
  const teilung = geteilt(context, { teilung: alsJson({ teile: mitKetten }), quellen: { ...kette(1), ...kette(2) }, einstiege, stellen: ["src/kette-1/b.js:3", "src/kette-2/b.js:3"] });

  const umfang = umfangDesHinweisTeils(context, teilung);
  mitIssue(teilung.wurzel, HINTERLEGEN, TEIL_ISSUE);
  exit(planeTeil(context, teilung.wurzel, { ordner: HINTERLEGEN }), EXIT_ABBRUCH);

  const geschwister = planungsBericht(teilung, HINTERLEGEN).umfang;
  assert.deepEqual([geschwister.loeschmenge.exporte, geschwister.loeschmenge.reste], [["src/kette-1/b.js:b1"], ["src/kette-1/b.js:c"]]);
  assert.deepEqual(umfang.loeschmenge, {
    dateien: ["src/kette-2/a.js", "src/kette-2/c.js"],
    exporte: ["src/kette-2/b.js:b1"],
    reste: ["src/kette-2/b.js:c"],
    tests: [{ datei: "test/kette-1.test.js", art: "löschen" }, { datei: "test/kette-2.test.js", art: "löschen" }],
    fehlend: [FEHLENDER_EINSTIEG],
  });
  assert.deepEqual([umfang.funktionen, geschwister.funktionen], [GENANNTE_FUNKTIONEN_JE_KETTE, GENANNTE_FUNKTIONEN_JE_KETTE]);
});

const DREI_GRUPPEN = { "planer|## Gliederung": [alsJson({ gruppen: [HINTERLEGEN_NUMMERN, ["S2", "S3"], ["S6", "T1"]].map((nummern) => ({ ...GRUPPEN[0], nummern })) })] };
const UNTER_TEILE = [
  eintrag("t1", "hinterlegen", { nummern: ["S1", "S7"], tWege: ["T2"], dateien: [ROUTE, ...ELF.slice(0, 2)] }),
  eintrag("t2", "bestaetigen", { nummern: ["S2", "S3", "S6"], tWege: ["T1"], dateien: ELF.slice(2, 5) }),
];
const UNTER_TEILE_VON_T1 = alsJson({ teile: UNTER_TEILE });
const ELTERN_TEILE_MIT_UMBAU = [{ ...ELTERN_TEILE[0], umbau: [EIGENER_UMBAU] }, { ...ELTERN_TEILE[1], umbau: [FREMDER_UMBAU] }];

function teilMitEigenemUndFremdemUmbau(context) {
  const quellen = { [ELF[0]]: ALT_QUELLE, [ELF[5]]: ALT_QUELLE };
  const { wurzel, ...teilung } = geteilt(context, { teilung: alsJson({ teile: ELTERN_TEILE_MIT_UMBAU }), quellen, umbau: [EIGENER_UMBAU, FREMDER_UMBAU] });
  exit(teilung, EXIT_GETEILT);
  mitIssue(wurzel, HINTERLEGEN, TEIL_ISSUE);
  return wurzel;
}

test("die Unter-Teilung eines Teils ordnet nur die Umbauten aus dessen Eintrag in der Eltern-teile.json zu", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = teilMitEigenemUndFremdemUmbau(context);
  const nurEigener = alsJson({ teile: [{ ...UNTER_TEILE[0], umbau: [EIGENER_UMBAU] }, UNTER_TEILE[1]] });

  const lauf = planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: { ...DREI_GRUPPEN, "planer|## Teilung": [nurEigener] } });

  exit(lauf, EXIT_GETEILT);
  const [frage] = aufrufe(lauf, "planer", "## Teilung");
  const [, abUmbau = ""] = frage.eingabe.split("### Umbau dieses Teils\n");
  const [umbauAbschnitt] = abUmbau.split("\n### ");
  assert.ok(umbauAbschnitt.includes(EIGENER_UMBAU) && !umbauAbschnitt.includes(FREMDER_UMBAU), umbauAbschnitt);
  assert.deepEqual(aufrufe(lauf, "planer", "## Befunde"), []);
  const unterTeile = JSON.parse(readFileSync(join(wurzel, HINTERLEGEN, "planung", "teile.json"), "utf8")).teile;
  assert.deepEqual(unterTeile.map(({ kuerzel, umbau }) => ({ kuerzel, umbau })), [{ kuerzel: "t1", umbau: [EIGENER_UMBAU] }, { kuerzel: "t2", umbau: undefined }]);
  assert.equal(existsSync(join(wurzel, "plaene/P-001-t1-t1-hinterlegen/pitch.md")), true);
});

function unterTeilungMitBefund(context, unterTeilung, wurzel = teilMitEigenemUndFremdemUmbau(context)) {
  const immerGleich = Array.from({ length: RUECKSENDUNGEN }, () => unterTeilung);

  const lauf = planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: { ...DREI_GRUPPEN, "planer|## Teilung": [unterTeilung], "planer|## Befunde": immerGleich } });

  exit(lauf, EXIT_BEFUNDE);
  assert.equal(existsSync(join(wurzel, "plaene/P-001-t1-t1-hinterlegen")), false);
  return planungsBericht({ wurzel }, HINTERLEGEN).grund;
}

test("die Unter-Teilung eines Teils, die eine eigene Umbau-Zeile keinem Unter-Teil zuordnet, endet mit Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const grund = unterTeilungMitBefund(context, UNTER_TEILE_VON_T1);

  assert.ok(grund.includes(`Regel Teilung: ${EIGENER_UMBAU} aus umbau dieses Teils in der Eltern-teile.json steht 0-mal unter umbau statt genau einmal`), grund);
});

test("die Unter-Teilung eines Teils, die eine fremde Umbau-Zeile zuordnet oder eine eigene ohne ihre Datei, endet mit Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const vertauscht = alsJson({ teile: [{ ...UNTER_TEILE[0], umbau: [FREMDER_UMBAU] }, { ...UNTER_TEILE[1], umbau: [EIGENER_UMBAU] }] });

  const grund = unterTeilungMitBefund(context, vertauscht);

  assert.ok(grund.includes(`Regel Teilung: ${FREMDER_UMBAU} unter umbau ist keine Umbau-Altfunktion unter umbau dieses Teils in der Eltern-teile.json`), grund);
  assert.ok(grund.includes(`Regel Teilung: t2 nennt ${EIGENER_UMBAU} unter umbau, hat ${ELF[0]} aber nicht unter dateien`), grund);
});

test("die Unter-Teilung eines Teils aus einer Eltern-teile.json ohne umbau-Felder verlangt wie bisher alle Umbau-Zeilen des Pitches", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = teilMitEigenemUndFremdemUmbau(context);
  const elternTeile = join(wurzel, ORDNER, "planung", "teile.json");
  writeFileSync(elternTeile, JSON.stringify({ ...JSON.parse(readFileSync(elternTeile, "utf8")), teile: ELTERN_TEILE }));
  const nurEigener = alsJson({ teile: [{ ...UNTER_TEILE[0], umbau: [EIGENER_UMBAU] }, UNTER_TEILE[1]] });

  const grund = unterTeilungMitBefund(context, nurEigener, wurzel);

  assert.ok(grund.includes(`Regel Teilung: ${FREMDER_UMBAU} aus „## Altfunktionen“ steht 0-mal unter umbau statt genau einmal`), grund);
});
