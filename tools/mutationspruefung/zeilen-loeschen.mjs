import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "node:process";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";
import { EXIT_PROZESS_UEBRIG, TESTGRUPPE } from "../testgruppe.mjs";
import { entscheide, unentschieden } from "./bestaetigung.mjs";
import { gruppen } from "./gruppen.mjs";

const BANK = "regression";
const TESTPARALLEL = 4;
const ZEILENENDE = "\n";
const ANWEISUNGSENDE = ";";
const DEKLARATION = /^(?:import|export|const|let|var|function|class|async function)\b/;
const BLOCK_MUTATOR = "BlockStatement";
const GELOESCHT = "Zeile gelöscht";
const UEBERLEBT = "Survived";
const ERKANNT = "Killed";
const ZEITABLAUF = "Timeout";
const ABSTURZ = "RuntimeError";
const EXIT_GRUEN = 0;
const EXIT_ROTER_TEST = 1;
const TESTKONTEXT = "NODE_TEST_CONTEXT";
const MS_JE_MINUTE = 60_000;
const ZEITGRENZE_MINUTEN = 10;
const MAX_AUSGABE = 268_435_456;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: MAX_AUSGABE, stdio: ["ignore", "pipe", "pipe"] });
}

function bereichsZeilen(bereiche) {
  return bereiche.flatMap(([von, bis]) => Array.from({ length: bis - von + 1 }, (_leer, index) => von + index));
}

function eigenerMutant(zeile, ergebnisse) {
  return ergebnisse.some(({ zeilen: [von, bis], art }) => von === zeile && bis === zeile && art !== BLOCK_MUTATOR);
}

function loeschbar(text) {
  const zeile = text.trim();
  return zeile.endsWith(ANWEISUNGSENDE) && !DEKLARATION.test(zeile);
}

function zeilenOhneMutant(datei, bereiche, ergebnisse) {
  const zeilen = readFileSync(datei, "utf8").split(ZEILENENDE);
  return bereichsZeilen(bereiche).filter(
    (zeile) => !eigenerMutant(zeile, ergebnisse) && loeschbar(zeilen[zeile - 1] ?? ""),
  );
}

function abweichendeDateien() {
  const namen = (args) => git(args).split("\0").filter(Boolean);
  return [
    ...namen(["diff", "--name-only", "-z", "--no-renames", "HEAD"]),
    ...namen(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
}

function gepruefterStand(verzeichnis) {
  git(["worktree", "add", "--detach", "-q", verzeichnis, "HEAD"]);
  for (const datei of abweichendeDateien()) {
    if (existsSync(datei)) cpSync(datei, join(verzeichnis, datei));
    else rmSync(join(verzeichnis, datei), { force: true });
  }
  symlinkSync(resolve("node_modules"), join(verzeichnis, "node_modules"));
  return verzeichnis;
}

function ohneTestkontext() {
  const { [TESTKONTEXT]: _geerbt, ...umgebung } = env;
  return umgebung;
}

function laufstatus({ status, signal, error }) {
  if (status === EXIT_GRUEN || status === EXIT_PROZESS_UEBRIG) return UEBERLEBT;
  if (status === EXIT_ROTER_TEST) return ERKANNT;
  return signal !== null || error !== undefined ? ZEITABLAUF : ABSTURZ;
}

function testlauf(verzeichnis, tests) {
  const lauf = spawnSync(process.execPath, [TESTGRUPPE, "--test", `--test-concurrency=${TESTPARALLEL}`, ...patternFlagsFor(BANK), ...tests], {
    cwd: verzeichnis,
    env: ohneTestkontext(),
    stdio: "ignore",
    timeout: ZEITGRENZE_MINUTEN * MS_JE_MINUTE,
  });
  return laufstatus(lauf);
}

function eintrag(datei, zeile, status) {
  return { schluessel: `${datei}:${zeile} ${GELOESCHT}`, status, zeilen: [zeile, zeile], art: GELOESCHT };
}

function vorzug(bisher, neu) {
  return neu.status === UEBERLEBT && bisher.hinweis !== undefined ? bisher : neu;
}

function ohneZeile(pfad, zeile, pruefen) {
  const original = readFileSync(pfad, "utf8");
  const zeilen = original.split(ZEILENENDE);
  zeilen[zeile - 1] = "";
  writeFileSync(pfad, zeilen.join(ZEILENENDE));
  try {
    return pruefen();
  } finally {
    writeFileSync(pfad, original);
  }
}

export function loeschprobe(verzeichnisAnlegen) {
  let verzeichnis = null;
  const gruen = new Set();
  const grundlauf = (tests) => {
    const kennung = tests.join(ZEILENENDE);
    if (gruen.has(kennung)) return;
    if (testlauf(verzeichnis, tests) !== UEBERLEBT) {
      throw new Error(`Grundlauf rot, Löschprobe nicht aussagekräftig: ${tests.join(", ")}`);
    }
    gruen.add(kennung);
  };
  const gruppenprobe = (datei, zeile, gruppe) => {
    grundlauf(gruppe);
    const beobachte = () => {
      const status = ohneZeile(join(verzeichnis, datei), zeile, () => testlauf(verzeichnis, gruppe));
      return { status, toeter: status === ERKANNT ? gruppe : [] };
    };
    const verlauf = [beobachte()];
    while (unentschieden(verlauf)) verlauf.push(beobachte());
    return entscheide(eintrag(datei, zeile, verlauf[0].status), verlauf);
  };
  const probe = (datei, zeile, auswahl) => {
    verzeichnis ??= gepruefterStand(verzeichnisAnlegen());
    let ergebnis = eintrag(datei, zeile, UEBERLEBT);
    for (const gruppe of auswahl) {
      ergebnis = vorzug(ergebnis, gruppenprobe(datei, zeile, gruppe));
      if (ergebnis.status !== UEBERLEBT) break;
    }
    return ergebnis;
  };
  return {
    pruefe: ({ datei, zeilen, ergebnisse, tests: { erste, alle } }) => {
      const uebrige = alle.filter((test) => !erste.includes(test));
      const auswahl = [...gruppen(erste), ...gruppen(uebrige)];
      return zeilenOhneMutant(datei, zeilen, ergebnisse).map((zeile) => probe(datei, zeile, auswahl));
    },
    abbauen: () => {
      if (verzeichnis !== null) git(["worktree", "remove", "--force", verzeichnis]);
    },
  };
}
