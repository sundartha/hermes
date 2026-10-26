import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "node:process";

import { omitKeys } from "../../src/utils/object.js";
import { patternFlagsFor } from "../../test/testbaenke-run.mjs";
import { EXIT_PROZESS_UEBRIG, TESTGRUPPE } from "../testgruppe.mjs";
import { entscheide, unentschieden } from "./bestaetigung.mjs";
import { gruppen } from "./gruppen.mjs";

const BANK = "regression";
const TESTPARALLEL = 4;
const ARBEITSKOPIEN = 3;
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
const ZEITABLAUF_FEHLER = "Zeitgrenze des Testlaufs erreicht";
const ABGEBROCHEN = "Löschprobe abgebrochen";

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

export function loeschbareZeilen(datei, bereiche) {
  return zeilenOhneMutant(datei, bereiche, []);
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
  return omitKeys(env, [TESTKONTEXT]);
}

function laufstatus({ status, signal, error }) {
  if (status === EXIT_GRUEN || status === EXIT_PROZESS_UEBRIG) return UEBERLEBT;
  if (status === EXIT_ROTER_TEST) return ERKANNT;
  return signal !== null || error !== undefined ? ZEITABLAUF : ABSTURZ;
}

function testlauf(verzeichnis, tests) {
  return new Promise((fertig) => {
    const kind = spawn(process.execPath, [TESTGRUPPE, "--test", `--test-concurrency=${TESTPARALLEL}`, ...patternFlagsFor(BANK), ...tests], {
      cwd: verzeichnis,
      env: ohneTestkontext(),
      stdio: "ignore",
    });
    const lage = { error: undefined };
    const uhr = setTimeout(() => {
      lage.error = new Error(ZEITABLAUF_FEHLER);
      kind.kill();
    }, ZEITGRENZE_MINUTEN * MS_JE_MINUTE);
    const ende = (lauf) => {
      clearTimeout(uhr);
      fertig(laufstatus(lauf));
    };
    kind.on("error", (error) => {
      if (kind.pid === undefined) ende({ status: null, signal: null, error });
    });
    kind.on("close", (status, signal) => ende({ status, signal, error: lage.error }));
  });
}

function eintrag(datei, zeile, status) {
  return { schluessel: `${datei}:${zeile} ${GELOESCHT}`, status, zeilen: [zeile, zeile], art: GELOESCHT };
}

function vorzug(bisher, neu) {
  return neu.status === UEBERLEBT && bisher.hinweis !== undefined ? bisher : neu;
}

async function ohneZeile(pfad, zeile, pruefen) {
  const original = readFileSync(pfad, "utf8");
  const zeilen = original.split(ZEILENENDE);
  zeilen[zeile - 1] = "";
  writeFileSync(pfad, zeilen.join(ZEILENENDE));
  try {
    return await pruefen();
  } finally {
    writeFileSync(pfad, original);
  }
}

async function verteilt(auftraege, kopie, pruefen) {
  const ergebnisse = [];
  const lage = { naechster: 0, fehler: [] };
  const abbrechbar = (stand) => ({
    ...stand,
    laufen: (tests) => {
      if (lage.fehler.length > 0) throw new Error(ABGEBROCHEN);
      return testlauf(stand.verzeichnis, tests);
    },
  });
  const arbeiter = async (platz) => {
    while (lage.fehler.length === 0 && lage.naechster < auftraege.length) {
      const index = lage.naechster++;
      try {
        ergebnisse[index] = await pruefen(pruefer(abbrechbar(kopie(platz))), auftraege[index]);
      } catch (fehler) {
        lage.fehler.push(fehler);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ARBEITSKOPIEN, auftraege.length) }, (_leer, platz) => arbeiter(platz)));
  if (lage.fehler.length > 0) throw lage.fehler[0];
  return ergebnisse;
}

function pruefer({ verzeichnis, gruen, laufen }) {
  const grundlauf = async (tests) => {
    const kennung = tests.join(ZEILENENDE);
    if (gruen.has(kennung)) return;
    if ((await laufen(tests)) !== UEBERLEBT) {
      throw new Error(`Grundlauf rot, Löschprobe nicht aussagekräftig: ${tests.join(", ")}`);
    }
    gruen.add(kennung);
  };
  const gruppenprobe = async (datei, zeile, gruppe) => {
    await grundlauf(gruppe);
    const beobachte = async () => {
      const status = await ohneZeile(join(verzeichnis, datei), zeile, () => laufen(gruppe));
      return { status, toeter: status === ERKANNT ? gruppe : [] };
    };
    const verlauf = [await beobachte()];
    while (unentschieden(verlauf)) verlauf.push(await beobachte());
    return entscheide(eintrag(datei, zeile, verlauf[0].status), verlauf);
  };
  return async (datei, auswahl, bisher) => {
    const [zeile] = bisher.zeilen;
    let ergebnis = bisher;
    for (const [nummer, gruppe] of auswahl.entries()) {
      console.error(`Löschprobe ${datei}:${zeile}: Gruppe ${nummer + 1} von ${auswahl.length} mit ${gruppe.length} Testdateien`);
      ergebnis = vorzug(ergebnis, await gruppenprobe(datei, zeile, gruppe));
      if (ergebnis.status !== UEBERLEBT) break;
    }
    return ergebnis;
  };
}

export function loeschprobe(verzeichnisAnlegen) {
  const kopien = new Map();
  const kopie = (platz) => {
    if (!kopien.has(platz)) kopien.set(platz, { verzeichnis: gepruefterStand(verzeichnisAnlegen()), gruen: new Set() });
    return kopien.get(platz);
  };
  return {
    pruefe: ({ datei, zeilen, ergebnisse, tests: { erste, alle } }) => {
      const uebrige = alle.filter((test) => !erste.includes(test));
      const auswahl = [...gruppen(erste), ...gruppen(uebrige)];
      const offen = zeilenOhneMutant(datei, zeilen, ergebnisse).map((zeile) => eintrag(datei, zeile, UEBERLEBT));
      return verteilt(offen, kopie, (probe, bisher) => probe(datei, auswahl, bisher));
    },
    abbauen: () => {
      const fehler = [];
      for (const { verzeichnis } of kopien.values()) {
        try {
          git(["worktree", "remove", "--force", verzeichnis]);
        } catch (grund) {
          fehler.push(grund);
        }
      }
      if (fehler.length > 0) throw fehler[0];
    },
  };
}
