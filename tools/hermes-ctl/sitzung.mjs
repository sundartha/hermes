import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_WURZEL = fileURLToPath(new URL("../..", import.meta.url));
export const ERSTES_ARGUMENT = 2;
export const EXIT_FEHLER = 1;
export const STANDARD_SITZUNG = "standard";
export const KENNUNG_WIRT = "hermes-ctl/wirt.mjs";
export const KENNUNG_PG_WIRT = "hermes-ctl/pg-wirt.mjs";
export const KENNUNG_SERVER = "server-mit-elternwaechter.mjs";
export const ROLLE_WIRT = "wirt";
export const SERVER_PROTOKOLL = "hermes.log";
export const WIRT_PROTOKOLL = "wirt.log";
const WURZEL_ORDNER = "hermes-ctl";
export const ZUSTAND_DATEI = "zustand.json";
export const FEHLER_DATEI = "fehler.json";
const ORDNER_RECHTE = 0o700;
const DATEI_RECHTE = 0o600;
const SITZUNGSNAME = /^[A-Za-z0-9_-]{1,64}$/;
const KEIN_SIGNAL = 0;
const JSON_EINRUECKUNG = 2;
const SPERRE_ENDUNG = ".sperre";
const UEBERNAHME_ENDUNG = ".uebernahme";

export class HermesCtlFehler extends Error {
  constructor(fehler, tun) {
    super(fehler);
    this.tun = tun;
  }
}

export function sitzungsOrdner(sitzung) {
  if (!SITZUNGSNAME.test(sitzung)) {
    throw new HermesCtlFehler(
      `Ungültiger Sitzungsname: ${sitzung}`,
      "Nimm für --sitzung nur Buchstaben, Ziffern, - und _ (höchstens 64 Zeichen).",
    );
  }
  return join(tmpdir(), WURZEL_ORDNER, sitzung);
}

export const zustandsDatei = (sitzung) => join(sitzungsOrdner(sitzung), ZUSTAND_DATEI);
export const fehlerDatei = (sitzung) => join(sitzungsOrdner(sitzung), FEHLER_DATEI);

export function ordnerAnlegen(sitzung) {
  const ordner = sitzungsOrdner(sitzung);
  mkdirSync(ordner, { recursive: true, mode: ORDNER_RECHTE });
  return ordner;
}

export function jsonSchreiben(datei, inhalt) {
  const zwischen = `${datei}.${process.pid}.neu`;
  writeFileSync(zwischen, JSON.stringify(inhalt, null, JSON_EINRUECKUNG), { mode: DATEI_RECHTE });
  renameSync(zwischen, datei);
}

export function jsonLesen(datei) {
  return existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null;
}

export function laufendeSitzung(sitzung) {
  const zustand = jsonLesen(zustandsDatei(sitzung));
  if (zustand === null) {
    throw new HermesCtlFehler(
      `Keine laufende Sitzung „${sitzung}“`,
      `Starte sie mit „npm run hermes-ctl -- start --sitzung ${sitzung}“.`,
    );
  }
  return zustand;
}

export function sitzungAufraeumen(sitzung) {
  rmSync(sitzungsOrdner(sitzung), { recursive: true, force: true });
}

export const kindBeendet = (kind) => kind.exitCode !== null || kind.signalCode !== null;

export function lebt(pid) {
  try {
    process.kill(pid, KEIN_SIGNAL);
    return true;
  } catch (fehler) {
    return fehler.code === "EPERM";
  }
}

function befehlszeile(pid) {
  try {
    return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export function gehoertZurSitzung({ pid, kennung }) {
  return lebt(pid) && befehlszeile(pid).includes(kennung);
}

function sperreAnlegen(datei) {
  try {
    writeFileSync(datei, String(process.pid), { flag: "wx", mode: DATEI_RECHTE });
    return true;
  } catch (fehler) {
    if (fehler.code === "EEXIST") return false;
    throw fehler;
  }
}

function halterVon(datei) {
  try {
    return Number(readFileSync(datei, "utf8"));
  } catch {
    return 0;
  }
}

const verwaist = (datei) => {
  const halter = halterVon(datei);
  return halter > 0 && !lebt(halter);
};

function verwaisteSperreUebernehmen(datei) {
  const uebernahme = `${datei}${UEBERNAHME_ENDUNG}`;
  if (!verwaist(datei) || !sperreAnlegen(uebernahme)) return false;
  try {
    if (!verwaist(datei)) return false;
    rmSync(datei, { force: true });
    return sperreAnlegen(datei);
  } finally {
    rmSync(uebernahme, { force: true });
  }
}

export function sitzungSperren(sitzung) {
  const datei = `${sitzungsOrdner(sitzung)}${SPERRE_ENDUNG}`;
  mkdirSync(join(tmpdir(), WURZEL_ORDNER), { recursive: true, mode: ORDNER_RECHTE });
  if (!sperreAnlegen(datei) && !verwaisteSperreUebernehmen(datei)) {
    throw new HermesCtlFehler(
      `Sitzung „${sitzung}“ wird gerade gestartet oder gestoppt (PID ${halterVon(datei)})`,
      `Warte, bis dieser Aufruf fertig ist, oder wähle einen anderen Namen; läuft keiner mehr, lösche ${datei}.`,
    );
  }
  return () => {
    if (halterVon(datei) === process.pid) rmSync(datei, { force: true });
  };
}
