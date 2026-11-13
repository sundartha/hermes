import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { bewerteLauf } from "./schwellen.mjs";
import { fuehreAusWennErlaubt } from "./ziel.mjs";
import { starteLokaleUmgebung } from "./umgebung.mjs";

const ABLAEUFE = new URL("./ablaeufe.js", import.meta.url).pathname;
const UMGEBUNG_CI = "ci";
const EXIT_ROT = 1;
const ARGUMENTE_AB = 2;
const ROTPROBE_ARGUMENT = "--rotprobe=";
const ROTPROBEN = Object.freeze(["fehler", "verwerfen"]);

function fuehreK6Aus(k6Befehl, dateien) {
  const [programm, ...argumente] = k6Befehl;
  const werte = Object.entries(dateien).flatMap(([name, pfad]) => ["-e", `${name}=${pfad}`]);
  return new Promise((fertig, fehler) => {
    const kind = spawn(programm, [...argumente, "run", "--quiet", ...werte, ABLAEUFE], { stdio: "inherit" });
    kind.on("error", fehler);
    kind.on("exit", (code) => (code === 0 ? fertig() : fehler(new Error(`k6 endete mit ${code}`))));
  });
}

async function laufeMitDateien(k6Befehl, konfiguration) {
  const ordner = await mkdtemp(join(tmpdir(), "hermes-last-"));
  try {
    const konfigDatei = join(ordner, "konfiguration.json");
    const ergebnisDatei = join(ordner, "ergebnis.json");
    await writeFile(konfigDatei, JSON.stringify(konfiguration));
    await fuehreK6Aus(k6Befehl, { LAST_KONFIG: konfigDatei, LAST_ERGEBNIS: ergebnisDatei });
    return JSON.parse(await readFile(ergebnisDatei, "utf8"));
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

export async function fuehreLastlaufAus({ k6Befehl = ["k6"], starte = starteLokaleUmgebung, rotprobe } = {}) {
  if (rotprobe !== undefined && !ROTPROBEN.includes(rotprobe)) throw new Error(`Lastlauf abgebrochen: rotprobe ${rotprobe} unbekannt`);
  const umgebung = await starte({ rotprobe });
  try {
    const messung = umgebung.ziele.reduceRight(
      (innen, ziel) => () => fuehreAusWennErlaubt(ziel, UMGEBUNG_CI, innen),
      () => laufeMitDateien(k6Befehl, umgebung.konfiguration),
    );
    const ergebnis = await messung();
    return { ergebnis, urteil: bewerteLauf(ergebnis) };
  } finally {
    await umgebung.schliessen();
  }
}

async function main(argumente) {
  const rotprobe = argumente[0]?.startsWith(ROTPROBE_ARGUMENT) ? argumente[0].slice(ROTPROBE_ARGUMENT.length) : undefined;
  const k6Rest = rotprobe === undefined ? argumente : argumente.slice(1);
  const k6Befehl = k6Rest.length > 0 ? k6Rest : ["k6"];
  const { ergebnis, urteil } = await fuehreLastlaufAus({ k6Befehl, rotprobe });
  console.log(JSON.stringify({ ergebnis, urteil }));
  return urteil.gruen ? 0 : EXIT_ROT;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(ARGUMENTE_AB)).then(
    (code) => process.exit(code),
    (fehler) => {
      console.error(fehler.message);
      process.exit(EXIT_ROT);
    },
  );
}
