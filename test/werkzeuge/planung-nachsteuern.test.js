import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, EXIT_ABBRUCH, EXIT_BEFUNDE, EXIT_GETEILT, EXIT_GRUEN, WEGFEHLER, abgelegt, mitIssue, planeAntworten, planungsBericht, pruefeTeilungOhneErkundung, teilEintrag as eintrag, vorgaengerGemergt } from "./planung-plane-probe.js";
import { GRUEN_PRUEFLISTE, GRUPPEN, HINTERLEGEN_NUMMERN, HINWEIS, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, mitUmbauZeilen, planOrdner, planeIn } from "./planung-probe.js";
import { EXIT_AUFRUF } from "./planung-plane-probe.js";
import { hebeFreigabe, mitKopfzeile } from "./planung-freigabe-probe.js";
import { REPO_ROOT, commitAll, probeDirectory, runIn } from "./probe-repo.js";
import { RUECKSENDUNGEN } from "../../tools/auftrag/planung/fortschritt.mjs";

const EXIT_DECKEL = 5;
const ELTERN = "P-001-eigene-nummer";
const HINTERLEGEN = "plaene/P-001-t1-eigene-nummer-hinterlegen";
const HINWEIS_ORDNER = "plaene/P-001-t2-hinweis-beim-anruf";
const STELLEN = "## Weitere Stellen";
const ELF = Array.from({ length: 11 }, (_, stelle) => `src/stellen/datei-${stelle + 1}.js`);
const TEIL_DECKEL = 3_000_000;
const TEIL_ISSUE = 77;
const MIO = 1_000_000;
const OHNE_WIRKUNG = String(1000 * MIO);
const KENNZEICHNUNG = { kostenGebucht: "je Rolle" };

const P003_LAUF5_FUNDSTELLE = "betreuung/tmp-sicherung/paket-VST/konzept.md, 1.2 (a) und 2.2: P-003 Lauf 5, 16 Erkunder-Läufe, Erkunder 13,32 M, pruefer-planung (nur Wegprüfungen) 8,38 M";
const P003_LAUF5_LAEUFE = 16;
const P003_LAUF5_ERKUNDER = 13_320_000;
const P003_LAUF5_WEGPRUEFER = 8_380_000;
const P003_ERKUNDER = P003_LAUF5_ERKUNDER / P003_LAUF5_LAEUFE;
const P003_WEGPRUEFER = P003_LAUF5_WEGPRUEFER / P003_LAUF5_LAEUFE;
const PLANER = 100_000;
const PLANER_JE_AUFRUF = 1000;
const PLANER_AUFRUFE_BIS_TEILUNG = 2;
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

function anderePhase(wurzel, kosten, datei = "planung.json") {
  mkdirSync(join(wurzel, ".fortschritt", "P-009-andere"), { recursive: true });
  writeFileSync(join(wurzel, ".fortschritt", "P-009-andere", datei), JSON.stringify(kosten));
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

test("die Vorschau mit den Werten von P-003 Lauf 5 ergibt 0,83 M je Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  const token = { planer: PLANER, erkunder: P003_ERKUNDER, "pruefer-planung": P003_WEGPRUEFER, entwurf: PLANER };
  const erster = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER, "--deckel", OHNE_WIRKUNG], token });
  exit(erster, EXIT_GRUEN);
  const { kostenJeLauf } = planungsBericht(erster);
  assert.equal(Math.round(mittel(kostenJeLauf.erkunder) / 10_000) / 100, 0.83, P003_LAUF5_FUNDSTELLE);
  assert.equal(mittel(kostenJeLauf.wegpruefer), P003_WEGPRUEFER);

  rmSync(join(wurzel, ORDNER, "phase.json"));
  rmSync(join(wurzel, ORDNER, "planung"), { recursive: true });
  const schritt = P003_ERKUNDER + P003_WEGPRUEFER;
  const deckel = PLANER + ERSTE_WELLE * schritt - 1;
  const zweiter = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER, "--deckel", String(deckel)], token });

  exit(zweiter, EXIT_DECKEL);
  assert.deepEqual(aufrufe(zweiter, "erkunder"), []);
  assert.deepEqual(planungsBericht(zweiter).deckel, { deckel, gemessen: PLANER, vorschau: ERSTE_WELLE * schritt });
});

test("ein Schritt mit Erkunder und Wegprüfer bucht jede Rolle mit ihren eigenen Sitzungen", { timeout: LAUF_FRIST_MS }, (context) => {
  const [erkunder, pruefer] = [1000, 300];
  const ueberschrieben = { "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, GRUEN_PRUEFLISTE], "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)] };
  const lauf = planeIn(context, planOrdner(context), { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER, "--deckel", OHNE_WIRKUNG], token: { planer: NEBENROLLE_JE_AUFRUF, erkunder, "pruefer-planung": pruefer, entwurf: NEBENROLLE_JE_AUFRUF } });

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

function zweiterWorktree(context, wurzel) {
  commitAll(wurzel, "Teil-Ordner");
  const zweiter = join(probeDirectory(context, {}), "zweiter");
  assert.equal(runIn(wurzel, "git", ["worktree", "add", "--detach", "-q", zweiter]).status, 0);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(zweiter, "node_modules"));
  return zweiter;
}

const ZWEI_GRUPPEN = { "planer|## Gliederung": [alsJson({ gruppen: [{ ...GRUPPEN[0], nummern: HINTERLEGEN_NUMMERN }, { ...GRUPPEN[0], nummern: GRUPPEN[0].nummern.filter((nummer) => !HINTERLEGEN_NUMMERN.includes(nummer)) }] })] };
const ERKUNDER_SO_TEUER_WIE_DER_TEIL_DECKEL = { erkunder: { laeufe: 1, token: TEIL_DECKEL } };
const PLANER_TEURER_ALS_DER_TEIL_DECKEL = { planer: { laeufe: 1, token: TEIL_DECKEL + 1 } };
const FREIGABE_UNTER_ZWEI_TEIL_DECKELN = TEIL_DECKEL + 2 * MIO;
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
  anderePhase(wurzel, { ...KENNZEICHNUNG, kostenJeLauf: ERKUNDER_SO_TEUER_WIE_DER_TEIL_DECKEL });
  mitIssue(wurzel, HINTERLEGEN, TEIL_ISSUE);
  return wurzel;
}

test("die Unter-Teilung eines Teils ordnet nur die Umbauten aus dessen Eintrag in der Eltern-teile.json zu", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = teilMitEigenemUndFremdemUmbau(context);
  const nurEigener = alsJson({ teile: [{ ...UNTER_TEILE[0], umbau: [EIGENER_UMBAU] }, UNTER_TEILE[1]] });

  const lauf = planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: { ...ZWEI_GRUPPEN, "planer|## Teilung": [nurEigener] } });

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

  const lauf = planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: { ...ZWEI_GRUPPEN, "planer|## Teilung": [unterTeilung], "planer|## Befunde": immerGleich } });

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

test("liegt die Vorschau der Erkundung mit dem Startwert aus einem anderen Worktree über dem Teil-Deckel, teilt sich ein Teil mit 2 Gruppen, statt mit Exit 5 zu enden, und reicht seinen Deckel an die Unter-Teile weiter", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  anderePhase(zweiterWorktree(context, wurzel), { ...KENNZEICHNUNG, kostenJeLauf: ERKUNDER_SO_TEUER_WIE_DER_TEIL_DECKEL });
  mitIssue(wurzel, HINTERLEGEN, TEIL_ISSUE);

  const lauf = planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: { ...ZWEI_GRUPPEN, "planer|## Teilung": [UNTER_TEILE_VON_T1] } });

  assert.ok(pruefeTeilungOhneErkundung(lauf).includes(`über dem Teil-Deckel ${TEIL_DECKEL}`), lauf.stderr);
  const verbraucht = PLANER_AUFRUFE_BIS_TEILUNG * PLANER_JE_AUFRUF;
  const pitch = readFileSync(join(wurzel, "plaene/P-001-t1-t1-hinterlegen/pitch.md"), "utf8");
  assert.ok(pitch.split("\n").includes(`Planung freigegeben: ${TEIL_DECKEL - verbraucht} Token`), pitch);
  assert.ok(pitch.split("\n").includes("Teil von: P-001-t1-eigene-nummer-hinterlegen; nach: –"), pitch);
  assert.equal(existsSync(join(wurzel, "plaene/P-001-t1-t2-bestaetigen/pitch.md")), true);
  const buch = join(runIn(wurzel, "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim(), "hermes-topf", ELTERN);
  const [reserviert] = readdirSync(buch).map((name) => JSON.parse(readFileSync(join(buch, name), "utf8")));
  assert.deepEqual({ token: reserviert.token, weitergegeben: reserviert.weitergegeben }, { token: verbraucht, weitergegeben: TEIL_DECKEL });
});

test("liegt die Vorschau der Erkundung eines Teils mit 1 Gruppe über dem Teil-Deckel, endet plane wie bisher mit Exit 5 ohne Teilung", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  anderePhase(wurzel, { ...KENNZEICHNUNG, kostenJeLauf: ERKUNDER_SO_TEUER_WIE_DER_TEIL_DECKEL });
  mitIssue(wurzel, HINWEIS_ORDNER, TEIL_ISSUE);
  vorgaengerGemergt(wurzel, HINTERLEGEN);

  const lauf = planeTeil(context, wurzel, { ordner: HINWEIS_ORDNER, antworten: { "planer|## Gliederung": [alsJson({ gruppen: [GRUPPEN[1]] })] } });

  exit(lauf, EXIT_DECKEL);
  assert.deepEqual(aufrufe(lauf, "planer", "## Teilung"), []);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
});

test("reicht der Deckel nach der Gliederung nicht mehr für den Planer der Teilung, endet plane mit Exit 5, ohne die Teilung zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  anderePhase(wurzel, { ...KENNZEICHNUNG, kostenJeLauf: ERKUNDER_SO_TEUER_WIE_DER_TEIL_DECKEL });
  mitIssue(wurzel, HINTERLEGEN, TEIL_ISSUE);
  const nurGliederung = PLANER_AUFRUFE_BIS_TEILUNG * PLANER_JE_AUFRUF - 1;

  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: {}, ueberschrieben: ZWEI_GRUPPEN, argumente: ["plane", HINTERLEGEN, "--deckel", String(nurGliederung)], token: { planer: PLANER_JE_AUFRUF } });

  exit(lauf, EXIT_DECKEL);
  assert.deepEqual(aufrufe(lauf, "planer", "## Teilung"), []);
  assert.equal(aufrufe(lauf, "planer").length, 1, lauf.stderr);
  assert.equal(planungsBericht({ wurzel }, HINTERLEGEN).deckelSchritt, "Teilung nach der Gliederung");
});

test("eine planung.json ohne Kennzeichnung je Rolle zählt als Startwert für den Erkunder nicht", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  anderePhase(wurzel, { kostenJeLauf: ERKUNDER_SO_TEUER_WIE_DER_TEIL_DECKEL });
  mitIssue(wurzel, HINTERLEGEN, TEIL_ISSUE);

  const lauf = planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: ZWEI_GRUPPEN });

  assert.deepEqual(aufrufe(lauf, "planer", "## Teilung"), []);
  assert.equal(aufrufe(lauf, "erkunder").length, 2, lauf.stderr);
});

function mitPlanerStartwert(context, datei) {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  anderePhase(wurzel, { kostenJeLauf: PLANER_TEURER_ALS_DER_TEIL_DECKEL }, datei);
  mitIssue(wurzel, HINTERLEGEN, TEIL_ISSUE);
  return planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: ZWEI_GRUPPEN });
}

test("eine planung.json ohne Kennzeichnung je Rolle zählt als Startwert für den Planer", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = mitPlanerStartwert(context, "planung.json");

  exit(lauf, EXIT_DECKEL);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
});

test("eine planung-*.json einer anderen Phase zählt als Startwert wie eine planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = mitPlanerStartwert(context, "planung-0955.json");

  exit(lauf, EXIT_DECKEL);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
});

test("ein weitergeteilter Teil zieht seinen weitergegebenen Deckel vom Rest-Topf seiner Geschwister ab, wenn der Deckel größer ist als sein Verbrauch", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context, { freigabe: FREIGABE_UNTER_ZWEI_TEIL_DECKELN });
  exit(teilung, EXIT_GETEILT);
  const { topf } = abgelegt({ wurzel }, "teile.json");
  assert.equal(topf.freigabe, FREIGABE_UNTER_ZWEI_TEIL_DECKELN);
  anderePhase(wurzel, { ...KENNZEICHNUNG, kostenJeLauf: ERKUNDER_SO_TEUER_WIE_DER_TEIL_DECKEL });
  mitIssue(wurzel, HINTERLEGEN, TEIL_ISSUE);
  exit(planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: { ...ZWEI_GRUPPEN, "planer|## Teilung": [UNTER_TEILE_VON_T1] } }), EXIT_GETEILT);
  mitIssue(wurzel, HINWEIS_ORDNER, TEIL_ISSUE);
  vorgaengerGemergt(wurzel, HINTERLEGEN);

  planeTeil(context, wurzel, { ordner: HINWEIS_ORDNER });

  assert.equal(planungsBericht({ wurzel }, HINWEIS_ORDNER).deckel.deckel, topf.freigabe - topf.vorschnitt - TEIL_DECKEL);
});

const KLEINE_FREIGABE = 2 * MIO;
const NEUE_MENGE = MIO;
const UEBERZUG = MIO / 2;
const UNTER_HINTERLEGEN = "plaene/P-001-t1-t1-hinterlegen";
const UNTER_BESTAETIGEN = "plaene/P-001-t1-t2-bestaetigen";
const UNTER_VORSCHNITT = PLANER_AUFRUFE_BIS_TEILUNG * PLANER_JE_AUFRUF;
const OHNE_JSON = "Ich antworte ohne JSON.";
const OHNE_ANTWORT = { "planer|## Gliederung": [OHNE_JSON], "planer|## Zuschnitt": [OHNE_JSON] };

function weitergeteilt(context, { teilFreigabe } = {}) {
  const { wurzel, ...teilung } = geteilt(context, { freigabe: KLEINE_FREIGABE });
  exit(teilung, EXIT_GETEILT);
  const { topf } = abgelegt({ wurzel }, "teile.json");
  if (teilFreigabe !== undefined) hebeFreigabe(wurzel, HINTERLEGEN, { von: topf.teilDeckel, auf: teilFreigabe });
  anderePhase(wurzel, { ...KENNZEICHNUNG, kostenJeLauf: ERKUNDER_SO_TEUER_WIE_DER_TEIL_DECKEL });
  mitIssue(wurzel, HINTERLEGEN, TEIL_ISSUE);
  exit(planeTeil(context, wurzel, { ordner: HINTERLEGEN, antworten: { ...ZWEI_GRUPPEN, "planer|## Teilung": [UNTER_TEILE_VON_T1] } }), EXIT_GETEILT);
  mitIssue(wurzel, UNTER_HINTERLEGEN, TEIL_ISSUE);
  return { wurzel, weitergegeben: teilFreigabe ?? topf.teilDeckel, vorschnitt: topf.vorschnitt };
}

function deckelDesUnterTeils(context, wurzel) {
  planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: {}, ueberschrieben: {}, argumente: ["plane", UNTER_HINTERLEGEN, "--deckel", OHNE_WIRKUNG], token: { planer: PLANER_JE_AUFRUF } });
  return planungsBericht({ wurzel }, UNTER_HINTERLEGEN).deckel.deckel;
}

test("teilordner: eine höhere Freigabe am Teil-Pitch hebt den Rest-Topf nicht", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, weitergegeben } = weitergeteilt(context);
  hebeFreigabe(wurzel, HINTERLEGEN, { von: weitergegeben, auf: OHNE_WIRKUNG });

  assert.equal(deckelDesUnterTeils(context, wurzel), weitergegeben - UNTER_VORSCHNITT);
});

test("teilordner: ein Teil zweiter Stufe bekommt nach einer höheren Freigabe im obersten Pitch mehr als den einst weitergegebenen Betrag", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, weitergegeben } = weitergeteilt(context);
  hebeFreigabe(wurzel, ORDNER, { von: KLEINE_FREIGABE, auf: KLEINE_FREIGABE + NEUE_MENGE });

  const deckel = deckelDesUnterTeils(context, wurzel);

  assert.ok(deckel > weitergegeben, `${deckel} ≤ ${weitergegeben}`);
  assert.equal(deckel, weitergegeben - UNTER_VORSCHNITT + NEUE_MENGE);
});

test("teilordner: die Summe aller Teile bleibt unter der Freigabe des obersten Pitches", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, weitergegeben, vorschnitt } = weitergeteilt(context);
  const freigabe = KLEINE_FREIGABE + NEUE_MENGE;
  hebeFreigabe(wurzel, ORDNER, { von: KLEINE_FREIGABE, auf: freigabe });
  const unterTeil = weitergegeben - UNTER_VORSCHNITT + UEBERZUG;
  planeTeil(context, wurzel, { ordner: UNTER_HINTERLEGEN, antworten: OHNE_ANTWORT, token: { planer: unterTeil } });
  mitIssue(wurzel, HINWEIS_ORDNER, TEIL_ISSUE);
  vorgaengerGemergt(wurzel, HINTERLEGEN);

  planeTeil(context, wurzel, { ordner: HINWEIS_ORDNER });

  assert.equal(planungsBericht({ wurzel }, HINWEIS_ORDNER).deckel.deckel, freigabe - vorschnitt - UNTER_VORSCHNITT - unterTeil);
});

function mitGebuchtemUnterTeil(context) {
  const { wurzel } = weitergeteilt(context);
  planeTeil(context, wurzel, { ordner: UNTER_HINTERLEGEN, antworten: OHNE_ANTWORT, token: { planer: PLANER_JE_AUFRUF } });
  mitIssue(wurzel, HINWEIS_ORDNER, TEIL_ISSUE);
  return wurzel;
}

function aendereTeileVonT1(wurzel, aendere) {
  const datei = join(wurzel, HINTERLEGEN, "planung", "teile.json");
  writeFileSync(datei, JSON.stringify(aendere(JSON.parse(readFileSync(datei, "utf8")))));
}

function haeltVorDemAgenten(lauf, { code, meldung }) {
  exit(lauf, code);
  assert.deepEqual(aufrufe(lauf, "planer"), [], lauf.stderr);
  assert.ok(lauf.stderr.includes(meldung), lauf.stderr);
}

test("teilordner: hat ein weitergeteilter Teil gebuchte Läufe, aber keine weitergegebene Menge in teile.json, hält plane vor dem ersten Agenten an", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = mitGebuchtemUnterTeil(context);
  aendereTeileVonT1(wurzel, (teilung) => ({ ...teilung, topf: undefined }));

  const lauf = planeTeil(context, wurzel, { ordner: HINWEIS_ORDNER });

  haeltVorDemAgenten(lauf, { code: EXIT_DECKEL, meldung: "nennt keine weitergegebene Menge" });
});

test("teilordner: führt eine teile.json einen Teil als eigenen Unter-Teil, hält plane vor dem ersten Agenten an", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = mitGebuchtemUnterTeil(context);
  aendereTeileVonT1(wurzel, (teilung) => ({ ...teilung, teile: [...teilung.teile, { ...teilung.teile[0], kuerzel: "eigene", name: "nummer-hinterlegen" }] }));

  const lauf = planeTeil(context, wurzel, { ordner: HINWEIS_ORDNER });

  haeltVorDemAgenten(lauf, { code: EXIT_AUFRUF, meldung: "führt sich selbst als Teil" });
});

test("teilordner: fehlt in der Kette bis zum obersten Pitch eine teile.json, hält plane vor dem ersten Agenten an", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel } = weitergeteilt(context);
  rmSync(join(wurzel, ORDNER, "planung", "teile.json"));

  const lauf = planeTeil(context, wurzel, { ordner: UNTER_HINTERLEGEN });

  haeltVorDemAgenten(lauf, { code: EXIT_AUFRUF, meldung: "der Rest-Topf rechnet bis zum obersten Pitch" });
});

test("teilordner: führen die Zeilen „Teil von“ im Kreis, hält plane vor dem ersten Agenten an", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel } = weitergeteilt(context);
  mitKopfzeile(wurzel, ORDNER, "Teil von: P-001-t1-eigene-nummer-hinterlegen; nach: –");

  const lauf = planeTeil(context, wurzel, { ordner: UNTER_HINTERLEGEN });

  haeltVorDemAgenten(lauf, { code: EXIT_AUFRUF, meldung: "führen im Kreis" });
});

test("teilordner: hat ein Unter-Teil die neue Menge schon zum Teil verbraucht, bekommt der nächste Unter-Teil nur noch den Rest davon", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, weitergegeben } = weitergeteilt(context, { teilFreigabe: KLEINE_FREIGABE / 2 });
  hebeFreigabe(wurzel, ORDNER, { von: KLEINE_FREIGABE, auf: KLEINE_FREIGABE + NEUE_MENGE });
  planeTeil(context, wurzel, { ordner: UNTER_HINTERLEGEN, antworten: OHNE_ANTWORT, token: { planer: weitergegeben - UNTER_VORSCHNITT + UEBERZUG } });
  mitIssue(wurzel, UNTER_BESTAETIGEN, TEIL_ISSUE);

  planeTeil(context, wurzel, { ordner: UNTER_BESTAETIGEN });

  assert.equal(planungsBericht({ wurzel }, UNTER_BESTAETIGEN).deckel.deckel, NEUE_MENGE - UEBERZUG);
});
