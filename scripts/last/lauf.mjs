import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { MCP_DENIAL_TEXTS } from "../../src/i18n/mcp-denial-texts.ts";
import { fasseFehlerZusammen } from "./ergebnis.js";
import { bewerteLauf, nurFehlerquoteUeberGrenze } from "./schwellen.mjs";
import { fuehreAusWennErlaubt } from "./ziel.mjs";
import { starteLokaleUmgebung } from "./umgebung.mjs";

const ABLAEUFE = new URL("./ablaeufe.js", import.meta.url).pathname;
const UMGEBUNG_CI = "ci";
const EXIT_ROT = 1;
const ARGUMENTE_AB = 2;
const ROTPROBE_ARGUMENT = "--rotprobe=";
const BEGRENZER_SCHLUESSEL = Object.freeze(["ausgelastet", "gleichzeitig_limit"]);
const ROTPROBEN = Object.freeze(["fehler", "verwerfen"]);

function fuehreK6Aus(k6Befehl, dateien) {
  const [programm, ...argumente] = k6Befehl;
  const werte = Object.entries(dateien).flatMap(([name, pfad]) => ["-e", `${name}=${pfad}`]);
  return new Promise((fertig, fehler) => {
    const kind = spawn(programm, [...argumente, "run", "--quiet", ...werte, ABLAEUFE], { stdio: ["inherit", "inherit", "pipe"] });
    let ausgabe = "";
    kind.stderr.setEncoding("utf8");
    kind.stderr.on("data", (teil) => {
      process.stderr.write(teil);
      ausgabe += teil;
    });
    kind.on("error", fehler);
    kind.on("close", (code) => {
      for (const zeile of fasseFehlerZusammen(ausgabe.split("\n"))) process.stderr.write(`${zeile}\n`);
      if (code === 0) fertig();
      else fehler(new Error(`k6 endete mit ${code}`));
    });
  });
}

function ablehnungstexte() {
  return Object.values(MCP_DENIAL_TEXTS).flatMap((sprache) => BEGRENZER_SCHLUESSEL.map((schluessel) => sprache[schluessel]));
}

export async function laufeMitDateien(k6Befehl, konfiguration) {
  const ordner = await mkdtemp(join(tmpdir(), "hermes-last-"));
  try {
    const konfigDatei = join(ordner, "konfiguration.json");
    const ergebnisDatei = join(ordner, "ergebnis.json");
    await writeFile(konfigDatei, JSON.stringify({ ...konfiguration, ablehnungstexte: ablehnungstexte() }));
    await fuehreK6Aus(k6Befehl, { LAST_KONFIG: konfigDatei, LAST_ERGEBNIS: ergebnisDatei });
    return JSON.parse(await readFile(ergebnisDatei, "utf8"));
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

function messeEinmal(umgebung, k6Befehl) {
  const geprueft = [];
  const messung = [...umgebung.ziele, ...(umgebung.konfiguration.ziele ?? umgebung.ziele)].reduceRight(
    (innen, ziel) => () =>
      fuehreAusWennErlaubt(ziel, UMGEBUNG_CI, (origin) => {
        geprueft.push(origin);
        return innen();
      }),
    () => laufeMitDateien(k6Befehl, { ...umgebung.konfiguration, ziele: geprueft.slice(umgebung.ziele.length) }),
  );
  return messung().then((ergebnis) => ({ ergebnis, urteil: bewerteLauf(ergebnis) }));
}

function beschreibeErstenLauf({ ergebnis }) {
  const aufteilung =
    ergebnis.httpFehlgeschlagen === undefined
      ? ""
      : ` (${ergebnis.anfragen} Anfragen, http_req_failed ${ergebnis.httpFehlgeschlagen}, ablauf_fehler ${ergebnis.ablaufFehler}, abgelehnt ${ergebnis.abgelehnt})`;
  return `Lastlauf: erster Lauf Fehlerquote ${ergebnis.fehlerquoteProzent} %${aufteilung}, einmalige Wiederholung`;
}

export async function fuehreLastlaufAus({ k6Befehl = ["k6"], starte = starteLokaleUmgebung, rotprobe } = {}) {
  if (rotprobe !== undefined && !ROTPROBEN.includes(rotprobe)) throw new Error(`Lastlauf abgebrochen: rotprobe ${rotprobe} unbekannt`);
  const umgebung = await starte({ rotprobe });
  try {
    const erster = await messeEinmal(umgebung, k6Befehl);
    if (!nurFehlerquoteUeberGrenze(erster.urteil)) return erster;
    console.error(beschreibeErstenLauf(erster));
    return { ...(await messeEinmal(umgebung, k6Befehl)), ersterLauf: erster };
  } finally {
    await umgebung.schliessen();
  }
}

async function main(argumente) {
  const rotprobe = argumente[0]?.startsWith(ROTPROBE_ARGUMENT) ? argumente[0].slice(ROTPROBE_ARGUMENT.length) : undefined;
  const k6Rest = rotprobe === undefined ? argumente : argumente.slice(1);
  const k6Befehl = k6Rest.length > 0 ? k6Rest : ["k6"];
  const { ergebnis, urteil, ersterLauf } = await fuehreLastlaufAus({ k6Befehl, rotprobe });
  console.log(JSON.stringify({ ergebnis, urteil, ersterLauf }));
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
