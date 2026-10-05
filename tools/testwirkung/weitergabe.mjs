import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";

import { abschnitte, arbeitsbaumAbbauen, basisArbeitsbaum, ergebnisseJeTest, ohneWirkung } from "./geaendert.mjs";
import { git } from "./git.mjs";
import { ZIELE } from "./gezielt.mjs";

const SCHEITERN = ["--import", fileURLToPath(new URL("scheitern.mjs", import.meta.url))];
const ZIELORDNER = "testwirkung-ziele-";
const ZIELDATEI = "ziele.json";
const TESTORDNER = "test/";

function namen(args) {
  return git(args).split("\0").filter(Boolean);
}

function dateienMit(basis, art) {
  return namen(["diff", "--name-only", "-z", "--no-renames", `--diff-filter=${art}`, basis, "--", TESTORDNER]);
}

function ganzNeu(basis) {
  return [...dateienMit(basis, "A"), ...namen(["ls-files", "--others", "--exclude-standard", "-z", "--", TESTORDNER])];
}

function zielplan(basis, seite, wurzel) {
  const bereiche = dateienMit(basis, "M").map((datei) => [datei, abschnitte(basis, datei).map((teil) => [teil[seite].start, teil[seite].laenge])]);
  const ganz = seite === "neu" ? ganzNeu(basis) : dateienMit(basis, "D");
  return { wurzel, bereiche: Object.fromEntries(bereiche), ganz };
}

function gezieltGelaufen(tests, seite, { basis, verzeichnis }) {
  const ordner = realpathSync(mkdtempSync(join(tmpdir(), ZIELORDNER)));
  try {
    const datei = join(ordner, ZIELDATEI);
    writeFileSync(datei, JSON.stringify(zielplan(basis, seite, verzeichnis)));
    return ergebnisseJeTest(tests, seite, { vorspann: SCHEITERN, verzeichnis, umgebung: { [ZIELE]: datei } });
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function befund(kennung, { vorher, nachher }) {
  const basis = vorher.get(kennung);
  if (basis.length > 0 && !basis.includes(true)) return [`Test gibt das Scheitern unveränderter Prüfungen nicht mehr weiter: ${kennung}`];
  if (basis.length === 0 && nachher.get(kennung).length > 0) {
    return [`Test auf der Basis nicht messbar und gibt das Scheitern unveränderter Prüfungen nicht weiter: ${kennung}`];
  }
  return [];
}

export function pruefeWeitergabe(basis, tests) {
  const ergebnis = { geprueft: tests.length, verstoesse: [] };
  if (tests.length === 0) return ergebnis;
  const nachher = gezieltGelaufen(tests, "neu", { basis, verzeichnis: realpathSync(cwd()) });
  const verdaechtig = tests.filter(({ kennung }) => ohneWirkung(nachher.get(kennung)));
  if (verdaechtig.length === 0) return ergebnis;
  const verzeichnis = basisArbeitsbaum(basis);
  try {
    const vorher = gezieltGelaufen(verdaechtig, "alt", { basis, verzeichnis });
    return { ...ergebnis, verstoesse: verdaechtig.flatMap(({ kennung }) => befund(kennung, { vorher, nachher })) };
  } finally {
    arbeitsbaumAbbauen(verzeichnis);
  }
}
