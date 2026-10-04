import { resolve } from "node:path";
import { chdir } from "node:process";
import { parseArgs } from "node:util";

import { aufraeumen } from "./rotproben-woche/aufraeumen.mjs";
import { warteUndWerteAus } from "./rotproben-woche/auswerten.mjs";
import { alsBericht, exitCode, gruen, rot, technisch } from "./rotproben-woche/bericht.mjs";
import {
  fallNamens,
  patchesSchreiben,
  probenAnlegen,
  sauberOderAbbruch,
} from "./rotproben-woche/faelle.mjs";
import { git } from "./rotproben-woche/git.mjs";
import { ohneMenschen } from "./rotproben-woche/ohne-menschen.mjs";
import { pushProbe } from "./rotproben-woche/push.mjs";

const EXIT_TECHNIK = 2;
const AUFRUF =
  "Aufruf: node tools/rotproben-woche.mjs [--auswerten <fall>=<pr> … | --nur-patches <ordner> | --nur-push | --aufraeumen | --ohne-menschen]";
const PAAR = /^([a-z-]+)=(\d+)$/;
const OPTIONEN = {
  auswerten: { type: "boolean" },
  "nur-patches": { type: "string" },
  "nur-push": { type: "boolean" },
  aufraeumen: { type: "boolean" },
  "ohne-menschen": { type: "boolean" },
};

function zurWurzel() {
  chdir(git(["rev-parse", "--show-toplevel"]).trim());
}

function probeAusPaar(paar) {
  const [, name, nummer] = PAAR.exec(paar) ?? [];
  const fall = fallNamens(name);
  if (fall === undefined) throw new Error(`unbekannter Fall oder keine PR-Nummer: ${paar}`);
  return { ...fall, pr: Number(nummer) };
}

async function auswerten(paare) {
  if (paare.length === 0) throw new Error(AUFRUF);
  const proben = paare.map(probeAusPaar);
  if (new Set(proben.map(({ fall }) => fall)).size < proben.length) {
    throw new Error("Ein Fall ist doppelt genannt.");
  }
  return alsBericht({ proben: await warteUndWerteAus(proben) });
}

function nurPatches(ordner) {
  const ziel = resolve(ordner);
  zurWurzel();
  sauberOderAbbruch();
  const ergebnisse = patchesSchreiben(ziel);
  const fehler = ergebnisse.filter((eintrag) => eintrag.fehler);
  for (const { fall, fehler: meldung } of fehler) console.error(`${fall}: ${meldung}`);
  return {
    zeilen: ergebnisse.map(({ fall, datei, fehler: meldung }) => `- ${fall}: ${datei ?? meldung}`),
    urteile: fehler.map(({ fehler: meldung }) => rot(meldung)),
  };
}

function nurPush() {
  zurWurzel();
  return alsBericht({ push: pushProbe() });
}

async function sicher(arbeit, vorsatz) {
  try {
    return await arbeit();
  } catch (fehler) {
    return technisch(`${vorsatz}: ${fehler.message}`);
  }
}

async function aufraeumUrteil() {
  return gruen(await aufraeumen());
}

async function auswertenSoweitAngelegt(proben) {
  const offen = proben.filter(({ ergebnis }) => ergebnis === undefined);
  if (offen.length === 0) return proben;
  const fertig = await warteUndWerteAus(offen).catch((fehler) =>
    offen.map((probe) => ({ ...probe, ergebnis: technisch(`nicht ausgewertet: ${fehler.message}`) })),
  );
  const nachFall = new Map(fertig.map((probe) => [probe.fall, probe]));
  return proben.map((probe) => nachFall.get(probe.fall) ?? probe);
}

async function vollerLauf() {
  zurWurzel();
  sauberOderAbbruch();
  await aufraeumen();
  const teile = {};
  try {
    const angelegt = probenAnlegen();
    teile.push = await sicher(pushProbe, "Push-Probe nicht ausgeführt");
    teile.proben = await auswertenSoweitAngelegt(angelegt);
    teile.menschen = await sicher(ohneMenschen, "nicht geprüft");
  } finally {
    teile.aufgeraeumt = await sicher(aufraeumUrteil, "Aufräumen gescheitert");
  }
  return alsBericht(teile);
}

const BETRIEBSARTEN = new Map([
  ["auswerten", ({ positionals }) => auswerten(positionals)],
  ["nur-patches", ({ values }) => nurPatches(values["nur-patches"])],
  ["nur-push", nurPush],
  ["aufraeumen", async () => alsBericht({ aufgeraeumt: await aufraeumUrteil() })],
  ["ohne-menschen", async () => alsBericht({ menschen: await ohneMenschen() })],
]);

async function main() {
  const { values, positionals } = parseArgs({ options: OPTIONEN, allowPositionals: true });
  const gewaehlt = [...BETRIEBSARTEN.keys()].filter((name) => values[name] !== undefined);
  if (gewaehlt.length > 1 || (positionals.length > 0 && !values.auswerten)) {
    throw new Error(AUFRUF);
  }
  const betriebsart = BETRIEBSARTEN.get(gewaehlt[0]) ?? vollerLauf;
  const { zeilen, urteile } = await betriebsart({ values, positionals });
  console.log(zeilen.join("\n"));
  return exitCode(urteile);
}

try {
  process.exitCode = await main();
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_TECHNIK;
}
