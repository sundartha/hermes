import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as warten } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  HermesCtlFehler,
  KENNUNG_WIRT,
  kindBeendet,
  REPO_WURZEL,
  ROLLE_WIRT,
  WIRT_PROTOKOLL,
  fehlerDatei,
  gehoertZurSitzung,
  jsonLesen,
  lebt,
  ordnerAnlegen,
  sitzungAufraeumen,
  sitzungsOrdner,
  sitzungSperren,
  zustandsDatei,
} from "./sitzung.mjs";

const WIRT = fileURLToPath(new URL("./wirt.mjs", import.meta.url));
const TAKT_MS = 100;
const START_FRIST_MS = 90000;
const STOPP_FRIST_MS = 20000;
const NACH_KILL_FRIST_MS = 3000;
const PROTOKOLL_ENDE_ZEICHEN = 2000;
const WIRT_PID_DATEI = "wirt.pid";
const DATEI_RECHTE = 0o600;

function gruppeAbschiessen(kind) {
  try {
    process.kill(-kind.pid, "SIGKILL");
  } catch {
    return;
  }
}

function protokollEnde(sitzung) {
  const datei = join(sitzungsOrdner(sitzung), WIRT_PROTOKOLL);
  return existsSync(datei) ? readFileSync(datei, "utf8").slice(-PROTOKOLL_ENDE_ZEICHEN) : "";
}

function startAbbrechen(sitzung, kind, grund) {
  gruppeAbschiessen(kind);
  const ende = protokollEnde(sitzung);
  sitzungAufraeumen(sitzung);
  return new HermesCtlFehler(
    `Start der Sitzung „${sitzung}“ gescheitert: ${grund}${ende ? `\n${ende}` : ""}`,
    "Lies die Meldung oben, behebe die Ursache und starte erneut.",
  );
}

async function aufBereitschaftWarten(sitzung, kind) {
  const frist = Date.now() + START_FRIST_MS;
  while (Date.now() < frist) {
    const zustand = jsonLesen(zustandsDatei(sitzung));
    if (zustand !== null) return zustand;
    const fehler = jsonLesen(fehlerDatei(sitzung));
    if (fehler !== null) throw startAbbrechen(sitzung, kind, fehler.fehler);
    if (kindBeendet(kind))
      throw startAbbrechen(sitzung, kind, `Wirt endete mit Code ${kind.exitCode}`);
    await warten(TAKT_MS);
  }
  throw startAbbrechen(sitzung, kind, `nach ${START_FRIST_MS} ms nicht bereit`);
}

const lebendeProzesse = (zustand) => zustand.prozesse.filter(gehoertZurSitzung);

function wirtVermerken(ordner, kind) {
  writeFileSync(join(ordner, WIRT_PID_DATEI), String(kind.pid), { mode: DATEI_RECHTE });
}

function vermerkterWirt(sitzung) {
  const ordner = sitzungsOrdner(sitzung);
  const datei = join(ordner, WIRT_PID_DATEI);
  if (!existsSync(datei)) return [];
  const pid = Number(readFileSync(datei, "utf8"));
  const wirt = { rolle: ROLLE_WIRT, pid, kennung: `${KENNUNG_WIRT} ${ordner}` };
  return Number.isInteger(pid) && pid > 0 && gehoertZurSitzung(wirt) ? [wirt] : [];
}

async function gesperrt(sitzung, schritt) {
  const freigeben = sitzungSperren(sitzung);
  try {
    return await schritt(sitzung);
  } finally {
    freigeben();
  }
}

export const starten = ({ sitzung }) => gesperrt(sitzung, alleinStarten);

export const stoppen = ({ sitzung }) => gesperrt(sitzung, alleinStoppen);

async function alleinStarten(sitzung) {
  const datei = zustandsDatei(sitzung);
  const bisher = jsonLesen(datei);
  if (bisher !== null && lebendeProzesse(bisher).length > 0) {
    throw new HermesCtlFehler(
      `Sitzung „${sitzung}“ läuft schon unter ${bisher.url}`,
      `Beende sie mit „npm run hermes-ctl -- stopp --sitzung ${sitzung}“ oder wähle einen anderen Namen.`,
    );
  }
  await alleinStoppen(sitzung);
  const ordner = ordnerAnlegen(sitzung);
  const protokoll = openSync(join(ordner, WIRT_PROTOKOLL), "a");
  const kind = spawn(process.execPath, [WIRT, ordner], {
    cwd: REPO_WURZEL,
    env: { NODE_ENV: "test" },
    detached: true,
    stdio: ["ignore", protokoll, protokoll],
  });
  closeSync(protokoll);
  wirtVermerken(ordner, kind);
  kind.unref();
  const zustand = await aufBereitschaftWarten(sitzung, kind);
  return { url: zustand.url, sitzung, zustandsdatei: datei };
}

async function bisAlleBeendet(prozesse, fristMs) {
  const frist = Date.now() + fristMs;
  while (Date.now() < frist && prozesse.some(({ pid }) => lebt(pid))) await warten(TAKT_MS);
  return prozesse.filter(gehoertZurSitzung);
}

function signalSenden(prozesse, signal) {
  for (const { pid } of prozesse) {
    try {
      process.kill(pid, signal);
    } catch {
      continue;
    }
  }
}

async function alleinStoppen(sitzung) {
  const zustand = jsonLesen(zustandsDatei(sitzung));
  const eigene = zustand === null ? vermerkterWirt(sitzung) : lebendeProzesse(zustand);
  const wirt = eigene.filter(({ rolle }) => rolle === ROLLE_WIRT);
  signalSenden(wirt.length > 0 ? wirt : eigene, "SIGTERM");
  const uebrig = await bisAlleBeendet(eigene, STOPP_FRIST_MS);
  signalSenden(uebrig, "SIGKILL");
  const haengend = await bisAlleBeendet(uebrig, NACH_KILL_FRIST_MS);
  if (haengend.length > 0) {
    const haengendeProzesse = haengend.map(({ rolle, pid }) => [rolle, pid].join(" ")).join(", ");
    throw new HermesCtlFehler(
      `Prozesse leben noch: ${haengendeProzesse}`,
      "Prüfe die genannten PIDs mit ps und beende sie von Hand.",
    );
  }
  sitzungAufraeumen(sitzung);
  return { beendet: eigene.map(({ rolle, pid }) => ({ rolle, pid })) };
}
