import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { env } from "node:process";
import { pathToFileURL } from "node:url";

import { zielErlaubt } from "../last/ziel.mjs";
import { probeLaufen } from "./wiederholung.mjs";

const MAX_ERSTVERSUCHE = 5;
const MAX_ANRUFE = 10;
const ANRUFE_JE_PROBE = 2;
const ALARMWEGE = ["SLACK_ALERT_URL", "BETTER_STACK_ALERT_URL"];
const PFLICHT = ["STAGING_PROBE_ZIEL", "STAGING_TEST_TOKEN", "STAGING_PROBE_AUFTRAGGEBER", "STAGING_PROBE_VORNAME"];
const COMMIT = /^[0-9a-f]{40}$/;
const EXIT_ROT = 1;
const ECHTE_UHR = Object.freeze({
  jetzt: () => Date.now(),
  warte: (ms) => new Promise((fertig) => setTimeout(fertig, ms)),
});

class Ende extends Error {}

function ende(text) {
  zeile(text);
  throw new Ende(text);
}

function zeile(text) {
  process.stdout.write(`${text}\n`);
}

function uebersprungen(name) {
  const text = `probe_uebersprungen_${name.toLowerCase()}_fehlt`;
  if (env.GITHUB_EVENT_NAME === "schedule") ende(text);
  zeile(text);
}

function fehlenderName() {
  if (!ALARMWEGE.some((name) => env[name])) return "BETTER_STACK_ALERT_URL";
  return PFLICHT.find((name) => !env[name]);
}

function kindUmgebung() {
  const eigene = Object.entries(env).filter(
    ([name]) => name === "PATH" || ALARMWEGE.includes(name) || name.startsWith("GITHUB_"),
  );
  return Object.fromEntries(eigene);
}

function alarmSenden(seit) {
  const argumente = [
    "tools/deploy-weg.mjs",
    "hoertest",
    "--anlass",
    "probe",
    "--commit",
    env.GITHUB_SHA,
    "--teile",
    "",
    "--seit",
    seit,
  ];
  const kind = spawn("node", argumente, { env: kindUmgebung(), stdio: "inherit" });
  return new Promise((fertig) => kind.on("close", fertig));
}

async function modulLaden() {
  if (!env.PROBE_ANRUFER_MODUL) return null;
  return import(pathToFileURL(env.PROBE_ANRUFER_MODUL).href);
}

async function tagesStandOk(anrufer) {
  let stand;
  try {
    stand = await anrufer.tagesstand();
  } catch {
    stand = null;
  }
  if (!Number.isInteger(stand?.erstversuche) || !Number.isInteger(stand?.anrufe)) {
    ende("probe_tageszaehl_unklar");
  }
  return stand.erstversuche < MAX_ERSTVERSUCHE && stand.anrufe <= MAX_ANRUFE - ANRUFE_JE_PROBE;
}

async function zielGeprueft(anrufer) {
  const ziel = zielErlaubt(env.STAGING_URL, "staging");
  const eigene = ziel.erlaubt ? await anrufer.eigeneNummer().catch(() => null) : null;
  if (eigene !== env.STAGING_PROBE_ZIEL) {
    ende("probe_ziel_unerlaubt");
  }
}

function messenAufruf(anrufer) {
  if (env.ABSICHTLICH_ROT === "true") return () => Promise.resolve(null);
  return async () => {
    const messung = await anrufer.anrufen({ ziel: env.STAGING_PROBE_ZIEL });
    const ergebnis =
      typeof anrufer.ergebnisVorgetragen === "function"
        ? { ergebnisVorgetragen: await anrufer.ergebnisVorgetragen().catch(() => false) }
        : {};
    if (typeof anrufer.stimmenAnzahl !== "function") return { ...messung, ...ergebnis };
    return { ...messung, ...ergebnis, stimmenAnzahl: await anrufer.stimmenAnzahl().catch(() => undefined) };
  };
}

function gewaehltMerken() {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, "gewaehlt=true\n");
}

async function ausgangMelden(ergebnis) {
  if (ergebnis.ausgang === "gruen") {
    gewaehltMerken();
    return zeile("Probe grün");
  }
  if (ergebnis.ausgang === "wiederholung_gruen") {
    gewaehltMerken();
    return zeile("Erstversuch rot, Wiederholung grün");
  }
  zeile(`Probe rot: ${ergebnis.zweit.gerissen.join(",")}`);
  await alarmSenden(ergebnis.seit);
  throw new Ende("probe_rot");
}

async function auflegen() {
  const fehlt = PFLICHT.find((name) => !env[name]);
  if (fehlt !== undefined) return uebersprungen(fehlt);
  const modul = await modulLaden();
  if (modul === null) {
    ende("probe_anrufer_fehlt");
  }
  await zielGeprueft(modul.anrufer);
  zeile(`probe_aufgelegt_${await modul.anrufer.offeneBeenden()}`);
}

async function hauptprogramm() {
  if (process.argv[2] === "auflegen") return auflegen();
  const fehlt = fehlenderName();
  if (fehlt !== undefined) return uebersprungen(fehlt);
  for (const name of PFLICHT) zeile(`::add-mask::${env[name]}`);
  if (!COMMIT.test(env.GITHUB_SHA ?? "")) {
    ende("probe_commit_unklar");
  }
  const modul = await modulLaden();
  if (modul === null) {
    ende("probe_anrufer_fehlt");
  }
  await zielGeprueft(modul.anrufer);
  if (!(await tagesStandOk(modul.anrufer))) return zeile("probe_tageslimit_erreicht");
  const uhr = modul.uhr ?? ECHTE_UHR;
  await ausgangMelden(await probeLaufen({ messen: messenAufruf(modul.anrufer), uhr }));
}

try {
  await hauptprogramm();
} catch (fehler) {
  if (!(fehler instanceof Ende)) throw fehler;
  process.exitCode = EXIT_ROT;
}
