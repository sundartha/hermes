import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  closeSync,
  constants,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process, { env, execPath } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { gewaehlterBefehl } from "./aufruf.mjs";
import { paketDes, schreibeErgebnis } from "./befehle.mjs";
import { pruefsummenZeile } from "./festgehalten.mjs";
import { git } from "./pfade.mjs";
import { leseStufe, stufenInhalt, stufenName } from "./totcode-urteil.mjs";

export const BENUTZER = "totcode-untraut";
export const PROTOKOLL_VORSATZ = "untraut | ";
const MESSUNG = fileURLToPath(new URL("totcode.mjs", import.meta.url));
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const KEIN_TREFFER = 1;
const LESBAR_FUER_ALLE = 0o755;
const FREMD_SCHREIBBAR = 0o022;
const KANAL_RECHTE = "620";
const ZEILENENDE = "\n";
const ZEILENGRENZE = /\r\n?|\n/;
const ERSTES_DRUCKZEICHEN = 0x20;
const LOESCHEN = 0x7f;
const LETZTES_STEUERZEICHEN = 0x9f;
const DURCHGEREICHT = ["PATH", "LANG", "PLAN_PRUEFSUMME", "BASIS_PRUEFSUMME"];
const UNTRAUTE_SCHRITTE = new Set(["kopf", "rotprobe"]);
const AUFRUF =
  "Aufruf: node tools/tests-ausmisten/totcode-untraut.mjs kopf|rotprobe --daten <ordner> --aus <ordner> [--paket <nr>]";
const PFLICHT = { kopf: ["daten", "aus"], rotprobe: ["daten", "aus"] };

function schreibeStufe(aus, art, inhalt) {
  const summe = schreibeErgebnis(aus, stufenName(art, inhalt.paket), inhalt);
  if (inhalt.paket !== undefined) console.log(pruefsummenZeile(inhalt.paket, summe, art));
}

export function liefereStufe({ aus, kanal }, stufe, werte) {
  const inhalt = stufenInhalt(stufe, werte);
  if (kanal === undefined) schreibeStufe(aus, stufe.art, inhalt);
  else writeFileSync(kanal, `${JSON.stringify(inhalt)}${ZEILENENDE}`);
}

function sudo(args) {
  return spawnSync("sudo", ["-n", ...args], { stdio: "inherit", env: { PATH: env.PATH } }).status;
}

function mitSudo(args) {
  const status = sudo(args);
  if (status !== EXIT_GRUEN) throw new Error(`sudo ${args.join(" ")} endete mit Exit ${status}.`);
}

export const RUNNER_SYSTEM = {
  legeBenutzerAn() {
    if (spawnSync("id", ["-u", BENUTZER], { stdio: "ignore" }).status === EXIT_GRUEN) return;
    mitSudo(["useradd", "--system", "--user-group", "--no-create-home", BENUTZER]);
  },
  uebergib(pfad) {
    mitSudo(["chown", "-R", "--no-dereference", `${BENUTZER}:`, pfad]);
  },
  teileKanal(pfad) {
    mitSudo(["chown", "--no-dereference", `:${BENUTZER}`, pfad]);
  },
  starte(befehl, { cwd, umgebung, stdio }) {
    const zuweisungen = Object.entries(umgebung).map(([name, wert]) => `${name}=${wert}`);
    const args = ["-n", "-u", BENUTZER, "--", "env", "-i", ...zuweisungen, ...befehl];
    return spawn("sudo", args, { cwd, stdio, env: { PATH: env.PATH } });
  },
  beendeAlle() {
    let status = EXIT_GRUEN;
    while (status === EXIT_GRUEN) status = sudo(["pkill", "-KILL", "-u", BENUTZER]);
    if (status !== KEIN_TREFFER) throw new Error(`pkill -u ${BENUTZER} endete mit Exit ${status}.`);
  },
  raeumeAuf(ordner) {
    mitSudo(["rm", "-rf", "--", ordner]);
  },
};

function eigenerOrdner(ordner) {
  mkdirSync(ordner, { recursive: true });
  const { uid, mode } = statSync(ordner);
  if (uid !== process.getuid() || (mode & FREMD_SCHREIBBAR) !== 0)
    throw new Error(`${ordner} gehört nicht allein dem Runner-Benutzer.`);
}

function geprueftePlan(daten) {
  const { inhalt, fehler } = leseStufe(daten, { art: "plan" });
  if (fehler) throw new Error(fehler);
  return inhalt;
}

function bereiteVor(system) {
  const ablage = realpathSync(mkdtempSync(join(tmpdir(), "totcode-untraut-")));
  chmodSync(ablage, LESBAR_FUER_ALLE);
  const wurzel = git(["rev-parse", "--show-toplevel"]).trim();
  const arbeit = join(ablage, "arbeit");
  git(["clone", "--quiet", "--shared", "--no-checkout", wurzel, arbeit]);
  const module = join(wurzel, "node_modules");
  if (existsSync(module)) symlinkSync(module, join(arbeit, "node_modules"));
  const heim = join(ablage, "heim");
  mkdirSync(heim);
  for (const ordner of [arbeit, heim]) system.uebergib(ordner);
  const kanal = join(ablage, "kanal");
  const mkfifo = spawnSync("mkfifo", ["-m", KANAL_RECHTE, kanal], { stdio: "inherit" });
  if (mkfifo.status !== EXIT_GRUEN) throw new Error(`mkfifo endete mit Exit ${mkfifo.status}.`);
  system.teileKanal(kanal);
  return { ablage, arbeit, heim, kanal, protokoll: join(ablage, "protokoll.txt") };
}

function oeffneKanal(kanal) {
  const vorlaeufig = openSync(kanal, constants.O_RDONLY | constants.O_NONBLOCK);
  const halten = openSync(kanal, constants.O_WRONLY);
  const lesen = openSync(kanal, constants.O_RDONLY);
  closeSync(vorlaeufig);
  const strom = createReadStream(null, { fd: lesen });
  const teile = [];
  strom.on("data", (teil) => teile.push(teil));
  const ende = Promise.race([
    once(strom, "end"),
    once(strom, "error").then(([fehler]) => Promise.reject(fehler)),
  ]);
  let offen = true;
  const schliesse = () => {
    if (offen) closeSync(halten);
    offen = false;
  };
  const empfange = async () => {
    schliesse();
    await ende;
    return Buffer.concat(teile).toString("utf8");
  };
  return { empfange, schliesse };
}

function umgebungFuer({ heim }) {
  const durch = DURCHGEREICHT.filter((name) => env[name] !== undefined).map((name) => [
    name,
    env[name],
  ]);
  return { ...Object.fromEntries(durch), HOME: heim, TMPDIR: heim, NODE_ENV: "test" };
}

function befehlFuer({ schritt, daten, paket }, kanal) {
  const auswahl = paket === undefined ? [] : ["--paket", paket];
  return [execPath, MESSUNG, schritt, "--daten", resolve(daten), ...auswahl, "--kanal", kanal];
}

function druckbar(zeile) {
  return Array.from(zeile, (zeichen) => {
    const code = zeichen.codePointAt(0);
    const steuer =
      code < ERSTES_DRUCKZEICHEN || (code >= LOESCHEN && code <= LETZTES_STEUERZEICHEN);
    return steuer ? " " : zeichen;
  }).join("");
}

function zeigeProtokoll(datei) {
  if (!existsSync(datei)) return;
  for (const zeile of readFileSync(datei, "utf8").split(ZEILENGRENZE))
    if (zeile !== "") console.log(`${PROTOKOLL_VORSATZ}${druckbar(zeile)}`);
}

async function messeAlsBenutzer(auftrag, { system, ordner }) {
  const kanal = oeffneKanal(ordner.kanal);
  const protokoll = openSync(ordner.protokoll, "a");
  try {
    const kind = system.starte(befehlFuer(auftrag, ordner.kanal), {
      cwd: ordner.arbeit,
      umgebung: umgebungFuer(ordner),
      stdio: ["ignore", protokoll, protokoll],
    });
    const [exit, signal] = await once(kind, "exit");
    system.beendeAlle();
    const text = await kanal.empfange();
    if (exit !== EXIT_GRUEN)
      throw new Error(`Die Messung als ${BENUTZER} endete mit ${signal ?? `Exit ${exit}`}.`);
    return text;
  } finally {
    kanal.schliesse();
    closeSync(protokoll);
    zeigeProtokoll(ordner.protokoll);
  }
}

function einzigeZeile(text) {
  const zeile = text.slice(0, -ZEILENENDE.length);
  const anzahl = text.split(ZEILENENDE).filter(Boolean).length;
  if (!text.endsWith(ZEILENENDE) || zeile === "" || zeile.includes(ZEILENENDE))
    throw new Error(`Der Ergebniskanal enthält ${anzahl} Zeilen, erwartet ist genau eine.`);
  try {
    return JSON.parse(zeile);
  } catch {
    throw new Error("Die Ergebniszeile im Ergebniskanal ist unlesbar.");
  }
}

function gepruefteErgebnis(text, { schritt, plan, auswahl }) {
  const inhalt = einzigeZeile(text);
  const erwartet = stufenInhalt({ art: schritt, plan, auswahl }, {});
  const passt = Object.entries(erwartet).every(([schluessel, wert]) =>
    isDeepStrictEqual(inhalt?.[schluessel], wert),
  );
  if (!passt) throw new Error("Die Ergebniszeile gehört nicht zu dieser Messung.");
  return inhalt;
}

export async function untraut(auftrag, system = RUNNER_SYSTEM) {
  const { schritt, daten, paket, aus } = auftrag;
  if (!UNTRAUTE_SCHRITTE.has(schritt)) throw new Error(`${schritt} ist kein untrauter Schritt.`);
  const plan = geprueftePlan(daten);
  const auswahl = paket === undefined ? {} : paketDes(plan, paket);
  eigenerOrdner(dirname(resolve(aus)));
  system.legeBenutzerAn();
  const ordner = bereiteVor(system);
  try {
    const text = await messeAlsBenutzer(auftrag, { system, ordner });
    schreibeStufe(aus, schritt, gepruefteErgebnis(text, { schritt, plan, auswahl }));
    return EXIT_GRUEN;
  } finally {
    system.raeumeAuf(ordner.ablage);
  }
}

async function main() {
  const argumente = parseArgs({
    allowPositionals: true,
    options: {
      daten: { type: "string" },
      paket: { type: "string" },
      aus: { type: "string" },
    },
  });
  const schritt = gewaehlterBefehl(argumente, { pflicht: PFLICHT, aufruf: AUFRUF });
  if (schritt === undefined) return EXIT_ROT;
  return untraut({ schritt, ...argumente.values });
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  try {
    process.exitCode = await main();
  } catch (fehler) {
    console.error(`Totcode-Messung als ${BENUTZER}: Abbruch: ${fehler.message}`);
    process.exitCode = EXIT_ROT;
  }
}
