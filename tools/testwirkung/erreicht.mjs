import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { geladeneDateien, gelaufeneAufrufzeilen } from "./abdeckung.mjs";
import { TESTDATEI, dateiAuf, testaufrufe } from "./aufrufe.mjs";
import { abschnitte, arbeitsbaumAbbauen, basisArbeitsbaum, innersterTest } from "./geaendert.mjs";
import { git, inBasis } from "./git.mjs";
import { testlaufGleichzeitig } from "./testlauf.mjs";

const ECHT = ["--import", fileURLToPath(new URL("echt.mjs", import.meta.url))];
const ABDECKUNG = "NODE_V8_COVERAGE";
const ABDECKUNGSORDNER = "testwirkung-abdeckung-";
const TESTORDNER = "test/";
const FELDER_JE_UMZUG = 3;
const SKRIPT = /\.[cm]?[jt]s$/;
const DEKLARATIONSDATEI = /\.d\.[cm]?ts$/;
const MARKIERUNG = ".testwirkung-geladen";
const STANDARDEXPORT = "default";
const OHNE_EXPORT = { namen: [], sterne: [] };

function namen(args) {
  return git(args).split("\0").filter(Boolean);
}

function nachTestUmgezogen(basis) {
  const eintraege = namen(["diff", "--name-status", "-z", "-M", "--diff-filter=R", basis]);
  const umgezogen = new Set();
  for (let stelle = 0; stelle < eintraege.length; stelle += FELDER_JE_UMZUG) {
    const [, quelle, ziel] = eintraege.slice(stelle, stelle + FELDER_JE_UMZUG);
    if (ziel.startsWith(TESTORDNER)) umgezogen.add(quelle);
  }
  return umgezogen;
}

function bleibenImBasisstand(basis, { paare }) {
  return new Set([...nachTestUmgezogen(basis), ...paare.filter(({ nurTypen }) => nurTypen).map(({ alt }) => alt)]);
}

function gebundeneNamen(bindung) {
  if (ts.isIdentifier(bindung)) return [bindung.text];
  return bindung.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : gebundeneNamen(element.name)));
}

function exportDerDeklaration(anweisung) {
  const klausel = anweisung.exportClause;
  if (anweisung.isTypeOnly) return OHNE_EXPORT;
  if (klausel === undefined) return { namen: [], sterne: [`export * from ${JSON.stringify(anweisung.moduleSpecifier.text)};`] };
  if (ts.isNamespaceExport(klausel)) return { namen: [klausel.name.text], sterne: [] };
  return { namen: klausel.elements.filter(({ isTypeOnly }) => !isTypeOnly).map(({ name }) => name.text), sterne: [] };
}

export function exportDerAnweisung(anweisung) {
  if (ts.isExportAssignment(anweisung)) return { namen: [STANDARDEXPORT], sterne: [] };
  if (ts.isExportDeclaration(anweisung)) return exportDerDeklaration(anweisung);
  const arten = new Set((ts.canHaveModifiers(anweisung) ? (ts.getModifiers(anweisung) ?? []) : []).map(({ kind }) => kind));
  if (!arten.has(ts.SyntaxKind.ExportKeyword)) return OHNE_EXPORT;
  if (arten.has(ts.SyntaxKind.DefaultKeyword)) return { namen: [STANDARDEXPORT], sterne: [] };
  if (ts.isVariableStatement(anweisung)) return { namen: anweisung.declarationList.declarations.flatMap(({ name }) => gebundeneNamen(name)), sterne: [] };
  return { namen: anweisung.name === undefined ? [] : [anweisung.name.text], sterne: [] };
}

function istExportGleich(anweisung) {
  return ts.isExportAssignment(anweisung) && anweisung.isExportEquals === true;
}

function exportGleichNichtVertretbar(datei) {
  return `Die entfernte Quelle ${datei} hat export =. Die Testwirkung kann dafür kein Ersatzmodul bauen, weil sie nicht kennt, welche Namen ein alter Test daraus importiert, und würde grün melden, ohne zu belegen, dass er die Quelle geladen hat. Stelle die Quelle in einem eigenen PR auf export default oder benannte Exporte um, bevor du sie entfernst oder umbenennst.`;
}

function exporteImBasisstand(basis, datei) {
  const quelle = ts.createSourceFile(datei, inBasis(basis, datei) ?? "", ts.ScriptTarget.Latest);
  if (!DEKLARATIONSDATEI.test(datei) && quelle.statements.some(istExportGleich)) throw new Error(exportGleichNichtVertretbar(datei));
  const anweisungen = quelle.statements.map(exportDerAnweisung);
  return { namen: [...new Set(anweisungen.flatMap(({ namen }) => namen))], sterne: [...new Set(anweisungen.flatMap(({ sterne }) => sterne))] };
}

function ersatz(datei, markierung, { namen, sterne }) {
  const zeilen = [`process.getBuiltinModule("node:fs").appendFileSync(${JSON.stringify(markierung)}, ${JSON.stringify(`${datei}\n`)});`];
  if (namen.length > 0) zeilen.push("const ersatz = undefined;", `export { ${namen.map((name) => `ersatz as ${JSON.stringify(name)}`).join(", ")} };`);
  return `${[...zeilen, ...sterne].join("\n")}\n`;
}

function abweichendVomBasisstand(basis, umbenannt) {
  const abweichend = [
    ...namen(["diff", "--name-only", "-z", "--no-renames", basis]),
    ...namen(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  const bleibt = bleibenImBasisstand(basis, umbenannt);
  return abweichend.filter((pfad) => !pfad.startsWith(TESTORDNER) && !bleibt.has(pfad));
}

function neuerCodeIn(verzeichnis, dateien) {
  for (const datei of dateien) {
    const ziel = join(verzeichnis, datei);
    rmSync(ziel, { force: true });
    if (!existsSync(datei)) continue;
    mkdirSync(dirname(ziel), { recursive: true });
    cpSync(datei, ziel);
  }
}

function entfernteSkripteVertreten(verzeichnis, basis, dateien) {
  const entfernt = dateien.filter((datei) => !existsSync(datei) && SKRIPT.test(datei));
  for (const datei of entfernt) writeFileSync(join(verzeichnis, datei), ersatz(datei, join(verzeichnis, MARKIERUNG), exporteImBasisstand(basis, datei)));
  return entfernt;
}

function neuerCodeMitErsatzIn(verzeichnis, basis, umbenannt) {
  const dateien = abweichendVomBasisstand(basis, umbenannt);
  neuerCodeIn(verzeichnis, dateien);
  return entfernteSkripteVertreten(verzeichnis, basis, dateien);
}

function markierteDateien(verzeichnis) {
  const markierung = join(verzeichnis, MARKIERUNG);
  return existsSync(markierung) ? readFileSync(markierung, "utf8").split("\n") : [];
}

async function erreicht({ tests, vergleich }, seite, { name, verzeichnis, entfernt = [] }) {
  const ordner = realpathSync(mkdtempSync(join(tmpdir(), ABDECKUNGSORDNER)));
  try {
    const dateien = [...new Set(tests.map((test) => dateiAuf(test, seite)))];
    const muster = [...new Set(tests.flatMap((test) => test[seite]))];
    await testlaufGleichzeitig({ name, dateien, muster, vorspann: ECHT, verzeichnis, umgebung: { [ABDECKUNG]: ordner } });
    return {
      zeilen: gelaufeneAufrufzeilen(ordner, { verzeichnis, dateien: vergleich }),
      geladen: geladeneDateien(ordner, { verzeichnis, dateien: entfernt }),
    };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

async function imBasisstand(basis, auftrag) {
  const verzeichnis = basisArbeitsbaum(basis);
  try {
    const entfernt = neuerCodeMitErsatzIn(verzeichnis, basis, auftrag.umbenannt);
    const lauf = await erreicht(auftrag, "alt", { name: "erreicht-basis", verzeichnis, entfernt });
    const markiert = markierteDateien(verzeichnis);
    return { ...lauf, geladen: entfernt.filter((datei) => lauf.geladen.includes(datei) || markiert.includes(datei)) };
  } finally {
    arbeitsbaumAbbauen(verzeichnis);
  }
}

function aufNeu(teile) {
  return (zeile) => {
    let versatz = 0;
    for (const { alt, neu } of teile) {
      if (alt.laenge > 0 && alt.start <= zeile && zeile < alt.start + alt.laenge) return undefined;
      const davor = alt.laenge > 0 ? alt.start + alt.laenge <= zeile : alt.start < zeile;
      if (davor) versatz += neu.laenge - alt.laenge;
    }
    return zeile + versatz;
  };
}

function fehlende(basis, vergleich, { vorher, nachher }) {
  return new Map(
    vergleich.map((datei) => {
      const neueZeile = aufNeu(abschnitte(basis, datei));
      const gesucht = [...vorher.get(datei)].map(neueZeile).filter((zeile) => zeile !== undefined);
      return [datei, gesucht.filter((zeile) => !nachher.get(datei).has(zeile))];
    }),
  );
}

function vereint(erstes, zweites) {
  return new Map([...erstes].map(([datei, zeilen]) => [datei, new Set([...zeilen, ...zweites.get(datei)])]));
}

function meldungen(datei, zeilen) {
  const aufrufe = TESTDATEI.test(datei) ? testaufrufe(datei, readFileSync(datei, "utf8")) : [];
  const jeTest = new Map();
  for (const zeile of zeilen.sort((links, rechts) => links - rechts)) {
    const test = innersterTest(aufrufe, zeile);
    const kennung = test === undefined ? datei : `${datei} › ${test.bezeichnung}`;
    jeTest.set(kennung, [...(jeTest.get(kennung) ?? []), zeile]);
  }
  return [...jeTest].map(
    ([kennung, liste]) => `Zeilen laufen nach der Änderung nicht mehr, die auf der Basis liefen: ${kennung} (Zeile ${liste.join(", ")})`,
  );
}

function nichtVergleichbar(datei) {
  return `Erreichte Zeilen nicht vergleichbar: Die alten Tests laden auf der Basis ${datei}, die die Änderung entfernt oder umbenennt. Ändere Pfad und Laufzeitcode nicht im selben PR: zuerst nur mit Typen umbenennen oder die Tests umstellen, danach den Laufzeitcode ändern oder die Datei löschen.`;
}

export async function vergleicheErreichtes(basis, auftrag) {
  const ergebnis = { verglichen: auftrag.vergleich.length, verstoesse: [] };
  if (auftrag.tests.length === 0 || auftrag.vergleich.length === 0) return ergebnis;
  const [basislauf, { zeilen: nachher }] = await Promise.all([
    imBasisstand(basis, auftrag),
    erreicht(auftrag, "neu", { name: "erreicht", verzeichnis: cwd() }),
  ]);
  if (basislauf.geladen.length > 0) return { ...ergebnis, verstoesse: basislauf.geladen.map(nichtVergleichbar) };
  const vorher = basislauf.zeilen;
  const erster = fehlende(basis, auftrag.vergleich, { vorher, nachher });
  if ([...erster.values()].every((zeilen) => zeilen.length === 0)) return ergebnis;
  const wiederholt = vereint(nachher, (await erreicht(auftrag, "neu", { name: "erreicht-wiederholt", verzeichnis: cwd() })).zeilen);
  const bleibend = fehlende(basis, auftrag.vergleich, { vorher, nachher: wiederholt });
  return { ...ergebnis, verstoesse: [...bleibend].flatMap(([datei, zeilen]) => (zeilen.length === 0 ? [] : meldungen(datei, zeilen))) };
}
