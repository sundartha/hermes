import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "node:process";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";

const BANK = "regression";
const TESTPARALLEL = 4;
const ZEILENENDE = "\n";
const ANWEISUNGSENDE = ";";
const DEKLARATION = /^(?:import|export|const|let|var|function|class|async function)\b/;
const BLOCK_MUTATOR = "BlockStatement";
const GELOESCHT = "Zeile gelöscht";
const UEBERLEBT = "Survived";
const ERKANNT = "Killed";
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

function testsBestehen(verzeichnis, tests) {
  const lauf = spawnSync(process.execPath, ["--test", `--test-concurrency=${TESTPARALLEL}`, ...patternFlagsFor(BANK), ...tests], {
    cwd: verzeichnis,
    env: ohneTestkontext(),
    stdio: "ignore",
    timeout: ZEITGRENZE_MINUTEN * MS_JE_MINUTE,
  });
  return lauf.status === 0;
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
  const bestehen = (tests) => testsBestehen(verzeichnis, tests);
  const grundlauf = (tests) => {
    const kennung = tests.join(ZEILENENDE);
    if (gruen.has(kennung)) return;
    if (!bestehen(tests)) throw new Error(`Grundlauf rot, Löschprobe nicht aussagekräftig: ${tests.join(", ")}`);
    gruen.add(kennung);
  };
  const probe = (datei, zeile, tests) => {
    verzeichnis ??= gepruefterStand(verzeichnisAnlegen());
    grundlauf(tests);
    const status = ohneZeile(join(verzeichnis, datei), zeile, () => bestehen(tests)) ? UEBERLEBT : ERKANNT;
    return { schluessel: `${datei}:${zeile} ${GELOESCHT}`, status, zeilen: [zeile, zeile], art: GELOESCHT };
  };
  return {
    pruefe: ({ datei, zeilen, ergebnisse, tests: { erste, alle } }) =>
      zeilenOhneMutant(datei, zeilen, ergebnisse).map((zeile) => {
        const ergebnis = probe(datei, zeile, erste);
        return ergebnis.status === UEBERLEBT && erste.length < alle.length ? probe(datei, zeile, alle) : ergebnis;
      }),
    abbauen: () => {
      if (verzeichnis !== null) git(["worktree", "remove", "--force", verzeichnis]);
    },
  };
}
