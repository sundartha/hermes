import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";

import { geladeneDateien, gelaufeneAufrufzeilen } from "./abdeckung.mjs";
import { TESTDATEI, dateiAuf, testaufrufe } from "./aufrufe.mjs";
import { abschnitte, arbeitsbaumAbbauen, basisArbeitsbaum, innersterTest } from "./geaendert.mjs";
import { git } from "./git.mjs";
import { testlaufNebenher } from "./testlauf.mjs";

const ECHT = ["--import", fileURLToPath(new URL("echt.mjs", import.meta.url))];
const ABDECKUNG = "NODE_V8_COVERAGE";
const ABDECKUNGSORDNER = "testwirkung-abdeckung-";
const TESTORDNER = "test/";
const FELDER_JE_UMZUG = 3;
const SKRIPT = /\.[cm]?[jt]s$/;
const MARKIERUNG = ".testwirkung-geladen";

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

function ersatz(datei, markierung) {
  return `process.getBuiltinModule("node:fs").appendFileSync(${JSON.stringify(markierung)}, ${JSON.stringify(`${datei}\n`)});\n`;
}

function neuerCodeIn(verzeichnis, basis, umbenannt) {
  const abweichend = [
    ...namen(["diff", "--name-only", "-z", "--no-renames", basis]),
    ...namen(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  const bleibt = bleibenImBasisstand(basis, umbenannt);
  const entfernt = [];
  for (const datei of abweichend.filter((pfad) => !pfad.startsWith(TESTORDNER) && !bleibt.has(pfad))) {
    const ziel = join(verzeichnis, datei);
    if (!existsSync(datei) && SKRIPT.test(datei)) {
      entfernt.push(datei);
      writeFileSync(ziel, ersatz(datei, join(verzeichnis, MARKIERUNG)));
      continue;
    }
    rmSync(ziel, { force: true });
    if (!existsSync(datei)) continue;
    mkdirSync(dirname(ziel), { recursive: true });
    cpSync(datei, ziel);
  }
  return entfernt;
}

async function erreicht({ tests, vergleich }, seite, { verzeichnis, entfernt = [] }) {
  const ordner = realpathSync(mkdtempSync(join(tmpdir(), ABDECKUNGSORDNER)));
  try {
    const dateien = [...new Set(tests.map((test) => dateiAuf(test, seite)))];
    const muster = [...new Set(tests.flatMap((test) => test[seite]))];
    await testlaufNebenher({ dateien, muster, vorspann: ECHT, verzeichnis, umgebung: { [ABDECKUNG]: ordner } });
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
    const entfernt = neuerCodeIn(verzeichnis, basis, auftrag.umbenannt);
    const lauf = await erreicht(auftrag, "alt", { verzeichnis, entfernt });
    const markierung = join(verzeichnis, MARKIERUNG);
    const markiert = existsSync(markierung) ? readFileSync(markierung, "utf8").split("\n") : [];
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
  const [basislauf, { zeilen: nachher }] = await Promise.all([imBasisstand(basis, auftrag), erreicht(auftrag, "neu", { verzeichnis: cwd() })]);
  if (basislauf.geladen.length > 0) return { ...ergebnis, verstoesse: basislauf.geladen.map(nichtVergleichbar) };
  const vorher = basislauf.zeilen;
  const erster = fehlende(basis, auftrag.vergleich, { vorher, nachher });
  if ([...erster.values()].every((zeilen) => zeilen.length === 0)) return ergebnis;
  const wiederholt = vereint(nachher, (await erreicht(auftrag, "neu", { verzeichnis: cwd() })).zeilen);
  const bleibend = fehlende(basis, auftrag.vergleich, { vorher, nachher: wiederholt });
  return { ...ergebnis, verstoesse: [...bleibend].flatMap(([datei, zeilen]) => (zeilen.length === 0 ? [] : meldungen(datei, zeilen))) };
}
