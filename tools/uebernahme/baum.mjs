import {
  appendFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { env, version } from "node:process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { TOOL_TEST_GLOB } from "../../test/testbaenke-run.mjs";
import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { waehleTeil } from "../testlaufzeit/teilung.mjs";
import { erzeugerFuer, QUELLEN } from "./erzeuger.mjs";
import {
  festhaltungsZeile,
  geprueftBaum,
  laufKennung,
  pruefsumme,
  wackeligeDateien,
} from "./festhaltung.mjs";

const ERSTES_ARGUMENT = 2;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const EXIT_AUFRUF = 2;
const FORMAT = 1;
const JSON_EINZUG = 2;
const MODUS_SCHATTEN = "schatten";
const MODUS_AUS = "aus";
const MODI = [MODUS_SCHATTEN, MODUS_AUS];
const ART_CI = "ci";
const ART_PRUEFLEITER = "pruefleiter";
const ARTEN = [ART_CI, ART_PRUEFLEITER];
const SCHATTEN_DATEI = ".pruefung/uebernahme-schatten.json";
const WACKELIG_DATEI = ".pruefung/wackelig.json";
const AUFRUF =
  "Aufruf: node tools/uebernahme/baum.mjs planen --art ci|pruefleiter --teil <k> --teile <n> [--dateien <liste>]\n" +
  "        node tools/uebernahme/baum.mjs festhalten --bericht <datei> --name <artefakt>";

export function dateienDesTeils({ art, teil, teile, dateienDatei }) {
  if (art === ART_CI) {
    return readFileSync(dateienDatei, "utf8").split("\n").filter((zeile) => zeile !== "");
  }
  return waehleTeil({ dateien: globSync(TOOL_TEST_GLOB), teil, anzahl: teile });
}

function entscheideDatei(datei, erzeuger) {
  const treffer = erzeuger.flatMap((quelle) =>
    (quelle.zeilen.get(datei) ?? []).map((zeile) => ({ zeile, lauf: quelle.lauf.id })),
  );
  if (treffer.length === 0) return { datei, uebernehmbar: false, grund: "kein Ergebnis im Erzeuger" };
  if (treffer.some(({ zeile }) => zeile.bestanden !== true)) {
    return { datei, uebernehmbar: false, grund: "im Erzeuger nicht bestanden" };
  }
  return { datei, uebernehmbar: true, erwartet: { bestanden: true }, quelle: treffer[0].lauf };
}

function beschreibe(ergebnis, ereignis) {
  const { workflow, lauf, grund } = ergebnis;
  return lauf && !grund
    ? { workflow, ereignis, lauf: lauf.id, adresse: lauf.html_url }
    : { workflow, ereignis, grund };
}

async function sammleErzeuger(kontext) {
  const ergebnisse = [];
  for (const quelle of QUELLEN[kontext.ereignis]?.[kontext.art] ?? []) {
    const ergebnis = await erzeugerFuer(kontext.github, quelle, kontext);
    ergebnisse.push({ ...ergebnis, ereignis: quelle.ereignis });
  }
  return ergebnisse;
}

export async function planeUebernahme(kontext) {
  const { art, teil, dateien, ereignis, kennung } = kontext;
  const kopf = { format: FORMAT, modus: MODUS_SCHATTEN, art, teil, ereignis, baum: kontext.baum };
  const erzeuger = kennung === null ? [] : await sammleErzeuger({ ...kontext, erwartet: { baum: kontext.baum, kennung } });
  const brauchbar = erzeuger.filter(({ zeilen }) => zeilen !== undefined);
  const eintraege = dateien.map((datei) =>
    kennung === null
      ? { datei, uebernehmbar: false, grund: "Runner-Image unbekannt" }
      : entscheideDatei(datei, brauchbar),
  );
  return {
    ...kopf,
    schluessel: kennung,
    teilUebernehmbar: eintraege.length > 0 && eintraege.every(({ uebernehmbar }) => uebernehmbar),
    erzeuger: erzeuger.map((ergebnis) => beschreibe(ergebnis, ergebnis.ereignis)),
    dateien: eintraege,
  };
}

function zusammenfassung(plan) {
  const bereit = plan.dateien.filter(({ uebernehmbar }) => uebernehmbar).length;
  const quellen = plan.erzeuger.map((quelle) =>
    quelle.lauf ? `Lauf ${quelle.lauf} (${quelle.workflow})` : `${quelle.workflow}: ${quelle.grund}`,
  );
  return `Übernahme im Schatten, ${plan.art} Teil ${plan.teil}: ${bereit} von ${plan.dateien.length} Dateien wären übernehmbar aus Baum ${plan.baum}; Erzeuger: ${quellen.join("; ") || "keiner"}`;
}

function schreibePlan(plan, ausgabe) {
  mkdirSync(dirname(ausgabe), { recursive: true });
  writeFileSync(ausgabe, `${JSON.stringify(plan, null, JSON_EINZUG)}\n`);
  const text = zusammenfassung(plan);
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function optionen(argumente) {
  return parseArgs({
    args: argumente,
    options: {
      art: { type: "string" },
      teil: { type: "string" },
      teile: { type: "string" },
      dateien: { type: "string" },
      bericht: { type: "string" },
      name: { type: "string" },
      ausgabe: { type: "string", default: SCHATTEN_DATEI },
    },
  }).values;
}

function planungsKontext(werte) {
  const teil = Number(werte.teil);
  const teile = Number(werte.teile);
  const dateien = dateienDesTeils({ art: werte.art, teil, teile, dateienDatei: werte.dateien });
  if (dateien === null) throw new Error("Die Testdateien des Teils sind nicht bestimmbar");
  return {
    art: werte.art,
    teil,
    dateien,
    ereignis: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    baum: geprueftBaum(),
    kennung: laufKennung({ version, umgebung: env }),
    github: githubZugang(),
    repo: env.GITHUB_REPOSITORY,
    jetzt: Date.now(),
    wurzel: process.cwd(),
  };
}

function ausgefallen(werte, grund) {
  return {
    format: FORMAT,
    modus: MODUS_SCHATTEN,
    art: werte.art,
    teil: Number(werte.teil),
    ereignis: env.GITHUB_EVENT_NAME,
    fehler: grund,
    teilUebernehmbar: false,
    erzeuger: [],
    dateien: [],
    baum: "unbekannt",
  };
}

async function planen(werte) {
  if (!ARTEN.includes(werte.art) || !werte.teil || !werte.teile) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  const modus = env.UEBERNAHME ?? MODUS_SCHATTEN;
  if (!MODI.includes(modus)) {
    console.error(`UEBERNAHME=${modus} ist nicht gebaut; erlaubt: ${MODI.join(", ")}.`);
    return EXIT_AUFRUF;
  }
  if (modus === MODUS_AUS || !QUELLEN[env.GITHUB_EVENT_NAME]?.[werte.art]) {
    console.log("Übernahme: keine Vorhersage nötig.");
    return EXIT_OK;
  }
  try {
    schreibePlan(await planeUebernahme(planungsKontext(werte)), werte.ausgabe);
  } catch (grund) {
    schreibePlan(ausgefallen(werte, grund.message), werte.ausgabe);
  }
  return EXIT_OK;
}

function festhalten(werte) {
  const kennung = laufKennung({ version, umgebung: env });
  if (!werte.bericht || !werte.name || kennung === null) {
    console.error(`${AUFRUF}\nImageOS und ImageVersion müssen gesetzt sein.`);
    return EXIT_AUFRUF;
  }
  if (!existsSync(werte.bericht)) {
    console.log(`Übernahme: ${werte.bericht} fehlt, nichts festgehalten.`);
    return EXIT_OK;
  }
  console.log(
    festhaltungsZeile({
      name: werte.name,
      summe: pruefsumme(readFileSync(werte.bericht)),
      baum: geprueftBaum(),
      kennung,
      wackelig: wackeligeDateien(WACKELIG_DATEI),
    }),
  );
  return EXIT_OK;
}

const BEFEHLE = { planen, festhalten };

export async function main(argumente) {
  const [befehl, ...rest] = argumente;
  if (!Object.hasOwn(BEFEHLE, befehl ?? "")) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  try {
    return await BEFEHLE[befehl](optionen(rest));
  } catch (grund) {
    console.error(grund.message);
    return EXIT_FEHLER;
  }
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  process.exitCode = await main(process.argv.slice(ERSTES_ARGUMENT));
}
