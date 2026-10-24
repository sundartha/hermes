import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { genannteStellen } from "../../tools/auftrag/planung/altfunktionen-vorab.mjs";
import { AUFTRAG, EXIT_ABBRUCH, EXIT_BEFUNDE, EXIT_GETEILT, EXIT_GRUEN, EXIT_PASST_NICHT, abgelegt, planeAntworten, teilEintrag as teil } from "./planung-plane-probe.js";
import { GRUPPEN, HINWEIS, LAUF_FRIST_MS, LOESUNG, ORDNER, ROUTE, alsJson, aufrufe, exit, planOrdner, planeIn } from "./planung-probe.js";
import { REPO_ROOT } from "./probe-repo.js";

const EXIT_DECKEL = 5;
const TEILUNG = "## Teilung";
const BEFUNDE = "## Befunde";
const TEILE = "teile.json";
const DAZU = ["B2", "B3", "B4", "B5"];
const ERSTER = ["S1", "S2", "S3", "S6", "S7"];
const ZWEITER = ["S4", "S5", "B1", ...DAZU];
const P006 = "plaene/P-006-saetze-hilfe";
const P006_DOKUMENTE = ["pitch.md", "design.md", "sicherheit.md"];
const P006_CODE_DATEIEN = 9;
const HINWEIS_ZEILE = 7;
const ALTFUNKTIONEN_KEINE = "\n## Altfunktionen\nkeine, weil die Fixture nur den Planungsweg vor dem ersten Agenten prüft\n";

const HINTERLEGEN = teil("t1", "eigene-nummer-hinterlegen", { nummern: ERSTER, tWege: ["T1", "T2"], dateien: [ROUTE] });
const HINWEIS_TEIL = teil("t2", "hinweis-beim-anruf", { nummern: ZWEITER, dateien: [HINWEIS], abhaengigVon: ["t1"] });
const GUELTIG = alsJson({ teile: [HINWEIS_TEIL, HINTERLEGEN] });
const ALLES_IN_EINEM = alsJson({ teile: [teil("t1", "alles", { nummern: [...ERSTER, ...ZWEITER], tWege: ["T1", "T2"], dateien: [ROUTE, HINWEIS] })] });
const UEBERLAPPEND = alsJson({ teile: [HINTERLEGEN, { ...HINWEIS_TEIL, dateien: [ROUTE, HINWEIS], abhaengigVon: [] }] });

function zwoelfNummern(wurzel) {
  const szenarien = DAZU.map((nummer) => `\n### Szenario ${nummer}: Anruf an eine fremde Nummer ${nummer}\nGegeben ein Kunde ohne eigene Nummer\nWenn sein Agent mit \`place_call\` eine fremde Nummer anruft\nDann ist der erste Satz der Text aus \`LOCALES.de.disclosure\`\n`);
  appendFileSync(join(wurzel, ORDNER, "pitch.md"), szenarien.join(""));
}

function loeschDateien(wurzel, namen) {
  for (const name of namen) {
    mkdirSync(join(wurzel, "src/alt"), { recursive: true });
    writeFileSync(join(wurzel, `src/alt/${name}.js`), "export function weg() {\n  return 1;\n}\n");
  }
  appendFileSync(join(wurzel, ORDNER, "pitch.md"), `\n## Löschen\n\n${namen.map((name) => `- \`src/alt/${name}.js:weg\``).join("\n")}\n`);
  appendFileSync(join(wurzel, ORDNER, "design.md"), `\n${namen.map((name) => `Fällt weg: \`src/alt/${name}.js:1-3\``).join("\n")}\n`);
}

function codeDateienBelegen(wurzel, dateien) {
  for (const datei of dateien) {
    mkdirSync(dirname(join(wurzel, datei)), { recursive: true });
    writeFileSync(join(wurzel, datei), "export const belegt = 1;\n");
  }
  appendFileSync(join(wurzel, ORDNER, "design.md"), `\n${dateien.map((datei) => `Ändert sich: \`${datei}:1\``).join("\n")}\n`);
}

function planeGross(context, { teilung, befunde = [], argumente = [], token, beleg, loeschen = [] } = {}) {
  const wurzel = planOrdner(context);
  zwoelfNummern(wurzel);
  if (loeschen.length > 0) loeschDateien(wurzel, loeschen);
  if (beleg !== undefined) appendFileSync(join(wurzel, ORDNER, "design.md"), `\nBeleg für den Hinweis: \`${beleg}\`\n`);
  const ueberschrieben = { [`planer|${TEILUNG}`]: [teilung], [`planer|${BEFUNDE}`]: befunde };
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER, ...argumente], token });
}

function ohneErkundung(lauf) {
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung"), []);
  assert.deepEqual(aufrufe(lauf, "planer", "## Gliederung"), []);
}

function ruecksendung(lauf) {
  const [erste] = aufrufe(lauf, "planer", BEFUNDE);
  assert.ok(erste !== undefined, lauf.stderr);
  return erste.eingabe;
}

test("plane teilt einen Pitch mit 12 Nummern vor dem ersten Erkunder, legt teile.json in Merge-Reihenfolge ab und endet mit Exit 7", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeGross(context, { teilung: GUELTIG });

  exit(lauf, EXIT_GETEILT);
  ohneErkundung(lauf);
  const [nachricht] = aufrufe(lauf, "planer", TEILUNG);
  assert.ok(nachricht.eingabe.includes("#### B5 (pitch.md)"), nachricht.eingabe);
  assert.ok(nachricht.eingabe.includes("#### T1 (sicherheit.md)"), nachricht.eingabe);
  assert.ok(nachricht.eingabe.includes(`"nummern": ${ERSTER.length + ZWEITER.length + HINTERLEGEN.tWege.length}`), nachricht.eingabe);
  const geteilt = abgelegt(lauf, TEILE);
  assert.deepEqual(geteilt.teile.map(({ kuerzel }) => kuerzel), ["t1", "t2"]);
  assert.deepEqual(geteilt.teile[1], HINWEIS_TEIL);
  assert.deepEqual(geteilt.ueber, ["12 Szenarien S/B, Grenze 8"]);
  assert.ok(lauf.stdout.indexOf("1. t1 eigene-nummer-hinterlegen") < lauf.stdout.indexOf("2. t2 hinweis-beim-anruf (nach: t1)"), lauf.stdout);
  assert.ok(lauf.stdout.includes("1. t1 eigene-nummer-hinterlegen"), lauf.stdout);
  assert.ok(lauf.stderr.includes("plane hält vor dem ersten Erkunder"), lauf.stderr);
});

test("ein Paket mit 8 Szenarien, aber 11 belegten Code-Dateien wird vor dem ersten Erkunder geteilt", { timeout: LAUF_FRIST_MS }, (context) => {
  const elf = Array.from({ length: 11 }, (_, stelle) => `src/viel/datei-${stelle + 1}.js`);
  const wurzel = planOrdner(context);
  codeDateienBelegen(wurzel, elf);
  const hinweis = { ...HINWEIS_TEIL, nummern: ["S4", "S5", "B1"], dateien: [HINWEIS, ...elf.slice(0, 6)] };
  const umbau = teil("t3", "umbau-davor", { nummern: [], dateien: elf.slice(6), nurUmbau: true });
  const ueberschrieben = { [`planer|${TEILUNG}`]: [alsJson({ teile: [HINTERLEGEN, hinweis, umbau] })] };
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER] });

  exit(lauf, EXIT_GETEILT);
  ohneErkundung(lauf);
  assert.deepEqual(abgelegt(lauf, TEILE).ueber, ["11 Code-Dateien, Grenze 10"]);
  assert.deepEqual(abgelegt(lauf, TEILE).teile.map(({ kuerzel }) => kuerzel), ["t1", "t2", "t3"]);
});

test("ein Teil mit mehr als 8 Nummern geht mit Befund an den Planer zurück, und erst der gültige Schnitt endet mit Exit 7", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeGross(context, { teilung: ALLES_IN_EINEM, befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  ohneErkundung(lauf);
  assert.ok(ruecksendung(lauf).includes("Regel Teilung: t1 hat 12 Szenarien S/B unter nummern, die Grenze ist 8"), ruecksendung(lauf));
  assert.equal(abgelegt(lauf, TEILE).ruecksendungen, 1);
});

test("ein Teil mit mehr als 10 Code-Dateien geht mit Befund an den Planer zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const viele = Array.from({ length: 11 }, (_, stelle) => `src/teil/datei-${stelle + 1}.js`);
  const zuGross = alsJson({ teile: [HINTERLEGEN, { ...HINWEIS_TEIL, dateien: [HINWEIS, ...viele, "test/teil/hinweis.test.js"] }] });
  const lauf = planeGross(context, { teilung: zuGross, befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  assert.ok(ruecksendung(lauf).includes("Regel Teilung: t2 hat 12 Code-Dateien, die Grenze ist 10"), ruecksendung(lauf));
});

test("zwei Teile ohne Abhängigkeit mit derselben Datei ergeben einen Befund, der eine Abhängigkeit oder getrennte Dateien verlangt", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeGross(context, { teilung: UEBERLAPPEND, befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  ohneErkundung(lauf);
  assert.ok(ruecksendung(lauf).includes(`Regel Teilung: t1 und t2 hängen nicht voneinander ab und teilen ${ROUTE}; nenn eine Abhängigkeit oder trenn die Dateien`), ruecksendung(lauf));
});

test("ein Ordner unter dateien überschneidet sich mit jeder Datei darin und zählt nicht als eine Datei", { timeout: LAUF_FRIST_MS }, (context) => {
  const ordner = alsJson({ teile: [HINTERLEGEN, { ...HINWEIS_TEIL, dateien: ["src/"], abhaengigVon: [] }] });
  const lauf = planeGross(context, { teilung: ordner, befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  const text = ruecksendung(lauf);
  assert.ok(text.includes("Regel Teilung: t2 nennt unter dateien den Ordner src/; nenn die Dateien einzeln"), text);
  assert.ok(text.includes(`Regel Teilung: t1 und t2 hängen nicht voneinander ab und teilen ${ROUTE}`), text);
});

test("jede Datei der Löschmenge steht genau einmal unter dateien und zählt nicht gegen die Grenze der Code-Dateien", { timeout: LAUF_FRIST_MS }, (context) => {
  const weg = "src/alt/weg.js";
  const rest = "src/alt/rest.js";
  const doppelt = alsJson({ teile: [{ ...HINTERLEGEN, dateien: [ROUTE, weg] }, { ...HINWEIS_TEIL, dateien: [HINWEIS, weg] }] });
  const neun = Array.from({ length: 9 }, (_, stelle) => `src/teil/datei-${stelle + 1}.js`);
  const gueltig = alsJson({ teile: [HINTERLEGEN, { ...HINWEIS_TEIL, dateien: [HINWEIS, ...neun, weg, rest] }] });
  const lauf = planeGross(context, { teilung: doppelt, befunde: [gueltig], loeschen: ["weg", "rest"] });

  exit(lauf, EXIT_GETEILT);
  const text = ruecksendung(lauf);
  assert.ok(text.includes(`Regel Teilung: ${weg} aus der Löschmenge steht 2-mal unter dateien statt genau einmal`), text);
  assert.ok(text.includes(`Regel Teilung: ${rest} aus der Löschmenge steht 0-mal unter dateien statt genau einmal`), text);
  assert.equal(abgelegt(lauf, TEILE).ruecksendungen, 1);
  assert.deepEqual(abgelegt(lauf, TEILE).umfang.loeschmenge.dateien, [rest, weg]);
});

test("ein Paket unter der Grenze, dessen Code-Dateien erst mit der Löschmenge über 10 liegen, plant ohne Teilung", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  loeschDateien(wurzel, Array.from({ length: 11 }, (_, stelle) => `weg-${stelle + 1}`));
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER] });

  assert.deepEqual(aufrufe(lauf, "planer", TEILUNG), []);
  assert.equal(aufrufe(lauf, "planer", "## Gliederung").length, 1, lauf.stderr);
  assert.equal(existsSync(join(wurzel, ORDNER, "planung", TEILE)), false);
});

test("eine Datei mit ./ vor dem Pfad geht mit Befund zurück, statt als andere Datei als die desselben unabhängigen Teils zu gelten", { timeout: LAUF_FRIST_MS }, (context) => {
  const versteckt = alsJson({ teile: [HINTERLEGEN, { ...HINWEIS_TEIL, dateien: [HINWEIS, `./${ROUTE}`], abhaengigVon: [] }] });
  const lauf = planeGross(context, { teilung: versteckt, befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  assert.ok(ruecksendung(lauf).includes(`Teil 2: ./${ROUTE} unter dateien ist kein relativer Pfad im Repo ohne ., .. und \\`), ruecksendung(lauf));
  assert.deepEqual(abgelegt(lauf, TEILE).teile.map(({ kuerzel }) => kuerzel), ["t1", "t2"]);
});

test("eine Antwort in falscher Form geht mit Befunden zur Form an den Planer zurück, bevor das Skript Nummern zählt", { timeout: LAUF_FRIST_MS }, (context) => {
  const falsch = alsJson({ teile: [{ ...HINTERLEGEN, kuerzel: "eins", name: "eigene nummer" }, { ...HINWEIS_TEIL, name: "eigene nummer", nurUmbau: "nein", dateien: "src/" }] });
  const lauf = planeGross(context, { teilung: falsch, befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  const text = ruecksendung(lauf);
  for (const befund of ["Teil 1: kuerzel braucht die Form t<n>", "Teil 1: name ist keine Kennung aus Buchstaben, Ziffern und Bindestrichen", "Teil 2: nurUmbau ist kein Wahrheitswert", "Teil 2: dateien ist keine Liste von Texten", "name eigene nummer steht in mehreren Teilen"]) assert.ok(text.includes(befund), `${befund}\n\n${text}`);
  assert.equal(text.includes("Regel Teilung:"), false, text);
});

test("ein formal richtiger Schnitt mit fehlenden, doppelten und fremden Nummern und einem Kreis ergibt je einen Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const falsch = alsJson({ teile: [
    { ...HINTERLEGEN, nummern: ["S1", "S2", "S6", "S7", "S9"], tWege: ["T1", "T1", "S3"], abhaengigVon: ["t2"] },
    { ...HINWEIS_TEIL, abhaengigVon: ["t1", "t9"] },
  ] });
  const lauf = planeGross(context, { teilung: falsch, befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  const text = ruecksendung(lauf);
  for (const befund of [
    "Regel Teilung: S3 steht 0-mal unter nummern statt genau einmal",
    "Regel Teilung: T1 steht 2-mal unter tWege statt genau einmal",
    "Regel Teilung: T2 steht 0-mal unter tWege statt genau einmal",
    "Regel Teilung: S9 unter nummern ist kein Szenario S oder B des Pitches",
    "Regel Teilung: S3 unter tWege ist keine Bedrohung T mit Ausgang verhindern",
    "Regel Teilung: abhaengigVon bildet einen Kreis: t1 → t2 → t1",
    "Regel Teilung: t2 hängt von t9 ab, den es nicht gibt",
  ]) assert.ok(text.includes(befund), `${befund}\n\n${text}`);
});

test("eine im Pitch belegte Code-Datei in keinem Teil und ein Teil, dessen nurUmbau nicht zu seinen Nummern passt, ergeben je einen Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneHinweis = alsJson({ teile: [{ ...HINTERLEGEN, nurUmbau: true }, { ...HINWEIS_TEIL, dateien: ["src/anrufe/neu.js"] }, teil("t3", "aufraeumen", { nummern: [], dateien: ["src/aufraeumen.js"] })] });
  const lauf = planeGross(context, { teilung: ohneHinweis, befunde: [GUELTIG], beleg: `${HINWEIS}:${HINWEIS_ZEILE}` });

  exit(lauf, EXIT_GETEILT);
  const text = ruecksendung(lauf);
  for (const befund of [
    `Regel Teilung: ${HINWEIS} ist im Pitch belegt und steht in keinem Teil unter dateien`,
    "Regel Teilung: t1 ist nurUmbau und nennt Nummern",
    "Regel Teilung: t3 hat keine Nummer und ist nicht nurUmbau",
  ]) assert.ok(text.includes(befund), `${befund}\n\n${text}`);
  assert.deepEqual(abgelegt(lauf, TEILE).umfang.codeDateien, [HINWEIS]);
});

test("„Zerlegung passt nicht“ mit gültigen Fundstellen beendet die Teilung mit Exit 3, ohne Erkunder und ohne teile.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const zeile = `Zerlegung passt nicht: Dann widerspricht der Lösung (Fundstellen: pitch.md, ## Problem; design.md, ${LOESUNG})`;
  const lauf = planeGross(context, { teilung: zeile });

  exit(lauf, EXIT_PASST_NICHT);
  ohneErkundung(lauf);
  assert.deepEqual(aufrufe(lauf, "planer", BEFUNDE), []);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung", TEILE)), false);
  assert.ok(lauf.stderr.includes(zeile), lauf.stderr);
});

test("„Zerlegung passt nicht“ mit falschen Fundstellen geht mit Befund an den Planer zurück, und erst die gültige Teilung endet mit Exit 7", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeGross(context, { teilung: "Zerlegung passt nicht: passt nicht (Fundstellen: pitch.md, ## Gibt es nicht; src/fehlt.js:3)", befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  ohneErkundung(lauf);
  assert.ok(ruecksendung(lauf).includes("src/fehlt.js ist keine Datei im Repo"), ruecksendung(lauf));
});

test("„Pitch ändern“ als Antwort auf die Teilung geht mit dem Hinweis zurück, dass es das hier nicht gibt, und erst die gültige Teilung endet mit Exit 7", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeGross(context, { teilung: "Pitch ändern: Soll S3 entfallen? (pitch.md, ## Problem)\nEmpfehlung: nein", befunde: [GUELTIG] });

  exit(lauf, EXIT_GETEILT);
  ohneErkundung(lauf);
  assert.ok(ruecksendung(lauf).includes("„Pitch ändern“ gibt es bei der Teilung nicht"), ruecksendung(lauf));
});

test("ein Stillstand des Planers bei der Teilung endet mit Exit 1, ohne Rücksendung, ohne Erkunder und ohne teile.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeGross(context, { teilung: { stillstand: true, text: GUELTIG } });

  exit(lauf, EXIT_ABBRUCH);
  ohneErkundung(lauf);
  assert.deepEqual(aufrufe(lauf, "planer", BEFUNDE), []);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung", TEILE)), false);
  assert.ok(lauf.stderr.includes("planer: Stillstand:"), lauf.stderr);
});

test("bleiben nach 3 Rücksendungen Befunde offen, endet plane mit Exit 4, ohne Erkunder und ohne teile.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeGross(context, { teilung: ALLES_IN_EINEM, befunde: [ALLES_IN_EINEM, ALLES_IN_EINEM, ALLES_IN_EINEM] });

  exit(lauf, EXIT_BEFUNDE);
  ohneErkundung(lauf);
  assert.equal(aufrufe(lauf, "planer", BEFUNDE).length, 3);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung", TEILE)), false);
  assert.ok(lauf.stderr.includes("Regel Teilung: t1 hat 12 Szenarien S/B unter nummern, die Grenze ist 8"), lauf.stderr);
});

test("übersteigt die Teilung den Deckel, endet plane mit Exit 5 ohne Rücksendung und ohne Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeGross(context, { teilung: ALLES_IN_EINEM, befunde: [GUELTIG], argumente: ["--deckel", "100"], token: { planer: 500 } });

  exit(lauf, EXIT_DECKEL);
  ohneErkundung(lauf);
  assert.deepEqual(aufrufe(lauf, "planer", BEFUNDE), []);
  assert.ok(lauf.stderr.includes("Deckel 100 Token"), lauf.stderr);
});

test("ein Paket unter der Grenze plant ohne Teilung wie bisher: Gliederung, Erkunder, Schnitt und phase.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER] });

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual([...new Set(aufrufe(lauf, "planer").map(({ ueberschrift }) => ueberschrift))], ["## Gliederung", "## Zuschnitt"]);
  assert.equal(aufrufe(lauf, "erkunder").length, GRUPPEN.length);
  assert.equal(existsSync(join(wurzel, ORDNER, "planung", TEILE)), false);
});

function p006Ordner(context) {
  const wurzel = planOrdner(context);
  mkdirSync(join(wurzel, P006), { recursive: true });
  for (const name of P006_DOKUMENTE) copyFileSync(join(REPO_ROOT, P006, name), join(wurzel, P006, name));
  appendFileSync(join(wurzel, P006, "pitch.md"), ALTFUNKTIONEN_KEINE);
  const dokumente = Object.fromEntries(P006_DOKUMENTE.map((name) => [name, readFileSync(join(wurzel, P006, name), "utf8")]));
  for (const { datei } of genannteStellen(dokumente)) {
    if (existsSync(join(wurzel, datei))) continue;
    mkdirSync(dirname(join(wurzel, datei)), { recursive: true });
    writeFileSync(join(wurzel, datei), "export const leer = 1;\n");
  }
  return wurzel;
}

test("die Fixture von P-006 mit 9 belegten Code-Dateien plant ohne Teilung und geht wie bisher ohne Gliederung direkt in den Zuschnitt", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = p006Ordner(context);
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: {}, ueberschrieben: {}, argumente: ["plane", P006] });

  exit(lauf, EXIT_ABBRUCH);
  assert.deepEqual(aufrufe(lauf, "planer").map(({ ueberschrift }) => ueberschrift), ["## Zuschnitt"]);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.equal(existsSync(join(wurzel, P006, "planung", TEILE)), false);
  const { umfang } = JSON.parse(readFileSync(join(wurzel, ".fortschritt", "P-006-saetze-hilfe", "planung.json"), "utf8"));
  assert.equal(umfang.codeDateien.length, P006_CODE_DATEIEN);
  assert.equal(umfang.nummern, 0);
});
