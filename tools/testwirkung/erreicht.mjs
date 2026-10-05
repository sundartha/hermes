import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";

import { gelaufeneAufrufzeilen } from "./abdeckung.mjs";
import { TESTDATEI, testaufrufe } from "./aufrufe.mjs";
import { abschnitte, arbeitsbaumAbbauen, basisArbeitsbaum, innersterTest } from "./geaendert.mjs";
import { git } from "./git.mjs";
import { testlauf } from "./testlauf.mjs";

const ECHT = ["--import", fileURLToPath(new URL("echt.mjs", import.meta.url))];
const ABDECKUNG = "NODE_V8_COVERAGE";
const ABDECKUNGSORDNER = "testwirkung-abdeckung-";
const TESTORDNER = "test/";

function namen(args) {
  return git(args).split("\0").filter(Boolean);
}

function neuerCodeIn(verzeichnis, basis) {
  const abweichend = [
    ...namen(["diff", "--name-only", "-z", "--no-renames", basis]),
    ...namen(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  for (const datei of abweichend.filter((pfad) => !pfad.startsWith(TESTORDNER))) {
    const ziel = join(verzeichnis, datei);
    rmSync(ziel, { force: true });
    if (!existsSync(datei)) continue;
    mkdirSync(dirname(ziel), { recursive: true });
    cpSync(datei, ziel);
  }
}

function erreicht({ tests, vergleich }, seite, verzeichnis) {
  const ordner = realpathSync(mkdtempSync(join(tmpdir(), ABDECKUNGSORDNER)));
  try {
    const dateien = [...new Set(tests.map(({ datei }) => datei))];
    const muster = [...new Set(tests.flatMap((test) => test[seite]))];
    testlauf({ dateien, muster, vorspann: ECHT, verzeichnis, umgebung: { [ABDECKUNG]: ordner } });
    return gelaufeneAufrufzeilen(ordner, { verzeichnis, dateien: vergleich });
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function imBasisstand(basis, auftrag) {
  const verzeichnis = basisArbeitsbaum(basis);
  try {
    neuerCodeIn(verzeichnis, basis);
    return erreicht(auftrag, "alt", verzeichnis);
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

export function vergleicheErreichtes(basis, auftrag) {
  const ergebnis = { verglichen: auftrag.vergleich.length, verstoesse: [] };
  if (auftrag.tests.length === 0 || auftrag.vergleich.length === 0) return ergebnis;
  const vorher = imBasisstand(basis, auftrag);
  const nachher = erreicht(auftrag, "neu", cwd());
  const erster = fehlende(basis, auftrag.vergleich, { vorher, nachher });
  if ([...erster.values()].every((zeilen) => zeilen.length === 0)) return ergebnis;
  const wiederholt = vereint(nachher, erreicht(auftrag, "neu", cwd()));
  const bleibend = fehlende(basis, auftrag.vergleich, { vorher, nachher: wiederholt });
  return { ...ergebnis, verstoesse: [...bleibend].flatMap(([datei, zeilen]) => (zeilen.length === 0 ? [] : meldungen(datei, zeilen))) };
}
