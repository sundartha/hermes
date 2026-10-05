import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { cwd, env } from "node:process";
import { fileURLToPath } from "node:url";

const TESTPARALLEL = 4;
const MS_JE_MINUTE = 60_000;
const ZEITGRENZE_MINUTEN = 10;
const MAX_AUSGABE = 268_435_456;
const MELDER = fileURLToPath(new URL("melder.mjs", import.meta.url));
const OHNE_PRUEFUNG = fileURLToPath(new URL("ohne-pruefung.mjs", import.meta.url));
export const UNTER_ATTRAPPE = ["--import", OHNE_PRUEFUNG];
const TESTKONTEXT = "NODE_TEST_CONTEXT";

function eintragIn(verzeichnis) {
  return (zeile) => {
    const { name, datei, bestanden, zeile: aufrufzeile, spalte } = JSON.parse(zeile);
    const pfad = datei?.startsWith("file:") ? fileURLToPath(datei) : (datei ?? "");
    return { datei: relative(verzeichnis, pfad), name, bestanden, zeile: aufrufzeile, spalte };
  };
}

function eigenstaendig() {
  const { [TESTKONTEXT]: _geerbt, ...umgebung } = env;
  return umgebung;
}

export function testlauf({ dateien, muster, vorspann, verzeichnis = cwd() }) {
  const argumente = [...vorspann, "--test", `--test-concurrency=${TESTPARALLEL}`, `--test-reporter=${MELDER}`];
  const filter = muster.map((quelle) => `--test-name-pattern=${quelle}`);
  const ergebnis = spawnSync(process.execPath, [...argumente, ...filter, ...dateien], {
    cwd: verzeichnis,
    encoding: "utf8",
    env: eigenstaendig(),
    timeout: ZEITGRENZE_MINUTEN * MS_JE_MINUTE,
    maxBuffer: MAX_AUSGABE,
  });
  if (ergebnis.error !== undefined || ergebnis.signal !== null) {
    throw new Error(`Testlauf abgebrochen: ${ergebnis.error?.message ?? ergebnis.signal}`);
  }
  const zeilen = ergebnis.stdout.split("\n");
  return zeilen.filter(Boolean).map(eintragIn(verzeichnis));
}
