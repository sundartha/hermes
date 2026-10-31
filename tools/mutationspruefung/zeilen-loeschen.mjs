import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "node:process";
import { createInterface } from "node:readline";

import { omitKeys } from "../objekt.mjs";
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
const ROTER_TEST_ZEILE = /^not ok /;
const ROTE_ZEILE_MIT_EINRUECKUNG = /^\s*not ok /;
const ORT_ZEILE = /^\s*location: /;
const LETZTE_ZEILEN = 20;
const OFFENER_TEST = / # TODO\b/;
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

function roterTestOben(zeile) {
  return ROTER_TEST_ZEILE.test(zeile) && !OFFENER_TEST.test(zeile);
}

function ausgang({ status, signal, error }) {
  return [`Exit ${status}`, `Signal ${signal}`, error?.message].filter(Boolean).join(", ");
}

function roteZeileBeliebigerTiefe(zeile) {
  return ROTE_ZEILE_MIT_EINRUECKUNG.test(zeile) && !OFFENER_TEST.test(zeile);
}

function merke(zeilen, zeile) {
  return [...zeilen, zeile].slice(-LETZTE_ZEILEN);
}

function laufstatus({ status, signal, error, rotGesehen }) {
  if (status === EXIT_GRUEN || status === EXIT_PROZESS_UEBRIG) return UEBERLEBT;
  if (status === EXIT_ROTER_TEST || rotGesehen) return ERKANNT;
  return signal !== null || error !== undefined ? ZEITABLAUF : ABSTURZ;
}

function lies(strom, beiZeile) {
  createInterface({ input: strom }).on("line", beiZeile);
}

function sammle(kind, bisZumEnde) {
  const lage = { error: undefined, rotGesehen: false, ortOffen: false, rote: [], stderr: [] };
  lies(kind.stdout, (zeile) => {
    if (roteZeileBeliebigerTiefe(zeile) || (lage.ortOffen && ORT_ZEILE.test(zeile))) {
      lage.ortOffen = !lage.ortOffen;
      lage.rote = merke(lage.rote, zeile.trim());
    }
    if (!roterTestOben(zeile) || lage.rotGesehen) return;
    lage.rotGesehen = true;
    if (!bisZumEnde) kind.kill();
  });
  lies(kind.stderr, (zeile) => {
    lage.stderr = merke(lage.stderr, zeile);
  });
  return lage;
}

function testlauf(verzeichnis, tests, bisZumEnde) {
  return new Promise((fertig) => {
    const kind = spawn(process.execPath, [TESTGRUPPE, "--test", "--test-reporter=tap", `--test-concurrency=${TESTPARALLEL}`, ...patternFlagsFor(BANK), ...tests], {
      cwd: verzeichnis,
      env: ohneTestkontext(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lage = sammle(kind, bisZumEnde);
    const uhr = setTimeout(() => {
      lage.error = new Error(ZEITABLAUF_FEHLER);
      kind.kill();
    }, ZEITGRENZE_MINUTEN * MS_JE_MINUTE);
    const ende = (lauf) => {
      clearTimeout(uhr);
      fertig({ status: laufstatus(lauf), rote: lage.rote, stderr: lage.stderr, ausgang: ausgang(lauf) });
    };
    kind.on("error", (error) => {
      if (kind.pid === undefined) ende({ status: null, signal: null, error });
    });
    kind.on("close", (status, signal) => ende({ status, signal, error: lage.error, rotGesehen: lage.rotGesehen }));
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

function urteil(bisher, fertig, anzahl) {
  let ergebnis = bisher;
  for (let nummer = 0; nummer < anzahl; nummer += 1) {
    if (fertig[nummer] === undefined) return {};
    if (fertig[nummer].fehler !== undefined) return { fehler: fertig[nummer].fehler };
    ergebnis = vorzug(ergebnis, fertig[nummer].ergebnis);
    if (ergebnis.status !== UEBERLEBT) break;
  }
  return { ergebnis };
}

function zeilenlage(bisher, { erste, alle }) {
  const fertig = [];
  const lage = { naechste: 0, laufend: 0, ersteFertig: 0, zu: false };
  const freigegeben = () => lage.naechste < erste || lage.ersteFertig === erste;
  return {
    bisher,
    gruppen: alle,
    offen: () => !lage.zu && lage.naechste < alle && freigegeben(),
    ruhend: () => lage.laufend === 0,
    pruefeNaechsteGruppe: async (pruefen) => {
      lage.laufend += 1;
      const nummer = lage.naechste++;
      const ausgang = await pruefen(nummer).then((ergebnis) => ({ ergebnis }), (fehler) => ({ fehler }));
      lage.laufend -= 1;
      if (nummer < erste) lage.ersteFertig += 1;
      fertig[nummer] = ausgang;
      lage.zu ||= ausgang.ergebnis?.status !== UEBERLEBT;
      return urteil(bisher, fertig, alle);
    },
    urteil: () => urteil(bisher, fertig, alle),
  };
}

function naechsteZeile(zeilen) {
  const offen = zeilen.filter((zeile) => zeile.offen());
  return offen.find((zeile) => zeile.ruhend()) ?? offen[0];
}

async function verteilt(zeilen, kopie, pruefen) {
  const lage = { fehler: [] };
  const abbrechbar = (stand) => ({
    ...stand,
    laufen: (tests, bisZumEnde = false) => {
      if (lage.fehler.length > 0) throw new Error(ABGEBROCHEN);
      return testlauf(stand.verzeichnis, tests, bisZumEnde);
    },
  });
  const laufende = new Set();
  const gruppenlauf = (platz, zeile) => {
    const probe = pruefer(abbrechbar(kopie(platz)));
    const lauf = zeile.pruefeNaechsteGruppe((nummer) => pruefen(probe, zeile.bisher, nummer)).then(({ fehler }) => {
      laufende.delete(lauf);
      if (fehler !== undefined) lage.fehler.push(fehler);
    });
    laufende.add(lauf);
    return lauf;
  };
  const arbeiter = async (platz) => {
    while (lage.fehler.length === 0) {
      const zeile = naechsteZeile(zeilen);
      if (zeile === undefined && laufende.size === 0) return;
      await (zeile === undefined ? Promise.race(laufende) : gruppenlauf(platz, zeile));
    }
  };
  const auftraege = zeilen.reduce((summe, { gruppen: anzahl }) => summe + anzahl, 0);
  const plaetze = Array.from({ length: Math.min(ARBEITSKOPIEN, auftraege) }, (_leer, platz) => platz);
  await Promise.all(plaetze.map((platz) => arbeiter(platz).catch((fehler) => lage.fehler.push(fehler))));
  if (lage.fehler.length > 0) throw lage.fehler[0];
  return zeilen.map((zeile) => zeile.urteil().ergebnis);
}

async function grundlaufAusfuehren(laufen, tests) {
  const lauf = await laufen(tests, true);
  if (lauf.status === UEBERLEBT) return;
  for (const zeile of lauf.rote) console.error(`Grundlauf rot, roter Test: ${zeile}`);
  for (const zeile of lauf.stderr) console.error(`Grundlauf rot, stderr: ${zeile}`);
  console.error(`Grundlauf rot, Ausgang: ${lauf.ausgang}`);
  throw new Error(`Grundlauf rot, Löschprobe nicht aussagekräftig: ${tests.join(", ")}`);
}

function pruefer({ verzeichnis, grundlaeufe, laufen }) {
  const grundlauf = (tests) => {
    const kennung = tests.join(ZEILENENDE);
    if (!grundlaeufe.has(kennung)) grundlaeufe.set(kennung, grundlaufAusfuehren(laufen, tests));
    return grundlaeufe.get(kennung);
  };
  return async (datei, zeile, gruppe) => {
    await grundlauf(gruppe);
    const beobachte = async () => {
      const { status } = await ohneZeile(join(verzeichnis, datei), zeile, () => laufen(gruppe));
      return { status, toeter: status === ERKANNT ? gruppe : [] };
    };
    const verlauf = [await beobachte()];
    while (unentschieden(verlauf)) verlauf.push(await beobachte());
    return entscheide(eintrag(datei, zeile, verlauf[0].status), verlauf);
  };
}

export function loeschprobe(verzeichnisAnlegen) {
  const kopien = new Map();
  const grundlaeufe = new Map();
  const kopie = (platz) => {
    if (!kopien.has(platz)) kopien.set(platz, { verzeichnis: gepruefterStand(verzeichnisAnlegen()), grundlaeufe });
    return kopien.get(platz);
  };
  return {
    pruefe: ({ datei, zeilen, ergebnisse, tests: { erste, alle } }) => {
      const uebrige = alle.filter((test) => !erste.includes(test));
      const vorne = gruppen(erste);
      const auswahl = [...vorne, ...gruppen(uebrige)];
      const stufen = { erste: vorne.length, alle: auswahl.length };
      const offen = zeilenOhneMutant(datei, zeilen, ergebnisse).map((zeile) => zeilenlage(eintrag(datei, zeile, UEBERLEBT), stufen));
      const gruppenprobe = async (probe, { zeilen: [zeile] }, nummer) => {
        console.error(`Löschprobe ${datei}:${zeile}: Gruppe ${nummer + 1} von ${auswahl.length} mit ${auswahl[nummer].length} Testdateien`);
        return probe(datei, zeile, auswahl[nummer]);
      };
      return verteilt(offen, kopie, gruppenprobe);
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
