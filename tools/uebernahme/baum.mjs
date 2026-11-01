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
import { erzeugerFuer, MAX_ALTER_MS, QUELLEN } from "./erzeuger.mjs";
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
const MODUS_AN = "an";
const MODUS_AUS = "aus";
const MODI = [MODUS_SCHATTEN, MODUS_AN, MODUS_AUS];
const WERKZEUGTESTS_GEWOLLT = "ja";
const ART_CI = "ci";
const ART_PRUEFLEITER = "pruefleiter";
const ARTEN = [ART_CI, ART_PRUEFLEITER];
const SCHATTEN_DATEI = ".pruefung/uebernahme-schatten.json";
const WACKELIG_DATEI = ".pruefung/wackelig.json";
const UEBERNOMMEN_DATEI = ".pruefung/uebernommen.jsonl";
const AUFRUF =
  "Aufruf: node tools/uebernahme/baum.mjs planen --art ci|pruefleiter --teil <k> --teile <n> [--dateien <liste>] [--rest <liste>] [--gewollt ja|nein]\n" +
  "        node tools/uebernahme/baum.mjs festhalten --bericht <datei> --name <artefakt>";

export function dateienDesTeils({ art, teil, teile, dateienDatei }) {
  if (art === ART_CI) {
    return readFileSync(dateienDatei, "utf8").split("\n").filter((zeile) => zeile !== "");
  }
  return waehleTeil({ dateien: globSync(TOOL_TEST_GLOB), teil, anzahl: teile });
}

function ursprungDes(zeile, treffer) {
  return zeile.uebernommen ?? { lauf: treffer.lauf, workflow: treffer.workflow, zeitpunkt: treffer.erstellt };
}

function entscheideDatei(datei, erzeuger, jetzt) {
  const treffer = erzeuger.flatMap((quelle) =>
    (quelle.zeilen.get(datei) ?? []).map((zeile) => ({
      zeile,
      lauf: quelle.lauf.id,
      workflow: quelle.workflow,
      erstellt: quelle.lauf.created_at,
    })),
  );
  if (treffer.length === 0) return { datei, uebernehmbar: false, grund: "kein Ergebnis im Erzeuger" };
  if (treffer.some(({ zeile }) => zeile.bestanden !== true)) {
    return { datei, uebernehmbar: false, grund: "im Erzeuger nicht bestanden" };
  }
  const [erstes] = treffer;
  const ursprung = ursprungDes(erstes.zeile, erstes);
  if (!(jetzt - Date.parse(ursprung.zeitpunkt) <= MAX_ALTER_MS)) {
    return { datei, uebernehmbar: false, grund: "Ergebnis ist älter als 24 Stunden" };
  }
  return {
    datei,
    uebernehmbar: true,
    erwartet: { bestanden: true },
    quelle: erstes.lauf,
    workflow: erstes.workflow,
    ursprung,
  };
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
  const kopf = { format: FORMAT, modus: kontext.modus ?? MODUS_SCHATTEN, art, teil, ereignis, baum: kontext.baum };
  const erzeuger = kennung === null ? [] : await sammleErzeuger({ ...kontext, erwartet: { baum: kontext.baum, kennung } });
  const brauchbar = erzeuger.filter(({ zeilen }) => zeilen !== undefined);
  const eintraege = dateien.map((datei) =>
    kennung === null
      ? { datei, uebernehmbar: false, grund: "Runner-Image unbekannt" }
      : entscheideDatei(datei, brauchbar, kontext.jetzt),
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

function melde(text) {
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function schreibeDatei(pfad, inhalt) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}

function schreibePlan(plan, ausgabe) {
  schreibeDatei(ausgabe, `${JSON.stringify(plan, null, JSON_EINZUG)}\n`);
}

function uebernommeneDateien(plan) {
  return plan.dateien.filter(({ uebernehmbar }) => uebernehmbar);
}

function uebernommeneZeilen(plan) {
  return uebernommeneDateien(plan).map(({ datei, ursprung }) => ({
    datei,
    bestanden: true,
    uebernommen: { ...ursprung, baum: plan.baum },
  }));
}

function ausfallText(plan) {
  return `Übernahme ausgefallen (${plan.fehler}), alle Dateien laufen`;
}

function uebernahmeText(plan, dateien, uebernommen) {
  const laufen = dateien.length - uebernommen.length;
  const kopf = `Übernahme, ${plan.art} Teil ${plan.teil}: ${uebernommen.length} von ${dateien.length} Dateien übernommen, ${laufen} laufen`;
  const grund = plan.fehler ? [ausfallText(plan)] : [];
  const zeilen = uebernommen.map(
    ({ datei, ursprung }) => `- ${datei}: Lauf ${ursprung.lauf} (${ursprung.workflow}), Baum ${plan.baum}`,
  );
  return [kopf, ...grund, ...zeilen].join("\n");
}

function wendeUebernahmeAn(plan, dateien, rest) {
  const uebernommen = uebernommeneDateien(plan);
  const bleiben = new Set(uebernommen.map(({ datei }) => datei));
  const laufen = dateien.filter((datei) => !bleiben.has(datei));
  schreibeDatei(rest, laufen.map((datei) => `${datei}\n`).join(""));
  if (uebernommen.length > 0) {
    schreibeDatei(UEBERNOMMEN_DATEI, uebernommeneZeilen(plan).map((zeile) => `${JSON.stringify(zeile)}\n`).join(""));
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `uebrig=${laufen.length}\n`);
  melde(uebernahmeText(plan, dateien, uebernommen));
}

function optionen(argumente) {
  return parseArgs({
    args: argumente,
    options: {
      art: { type: "string" },
      teil: { type: "string" },
      teile: { type: "string" },
      dateien: { type: "string" },
      rest: { type: "string" },
      gewollt: { type: "string" },
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

function ausgefallen(werte, grund, modus) {
  return {
    format: FORMAT,
    modus,
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

function keineVorhersage(modus, werte) {
  if (modus === MODUS_AUS || !QUELLEN[env.GITHUB_EVENT_NAME]?.[werte.art]) return true;
  return modus === MODUS_AN && werte.art === ART_PRUEFLEITER && werte.gewollt !== WERKZEUGTESTS_GEWOLLT;
}

async function vorhersage(werte, modus) {
  let kontext;
  try {
    kontext = planungsKontext(werte);
  } catch (grund) {
    return { plan: ausgefallen(werte, grund.message, modus) };
  }
  try {
    return { plan: await planeUebernahme({ ...kontext, modus }), dateien: kontext.dateien };
  } catch (grund) {
    return { plan: ausgefallen(werte, grund.message, modus), dateien: kontext.dateien };
  }
}

function aufrufFehler(werte, modus) {
  if (!ARTEN.includes(werte.art) || !werte.teil || !werte.teile) return AUFRUF;
  if (!MODI.includes(modus)) return `UEBERNAHME=${modus} ist unbekannt; erlaubt: ${MODI.join(", ")}.`;
  if (modus === MODUS_AN && !werte.rest) return `${AUFRUF}\nMit UEBERNAHME=an braucht planen --rest.`;
  return null;
}

function meldeErgebnis({ plan, dateien, modus, rest }) {
  if (modus === MODUS_AN && dateien === undefined) melde(ausfallText(plan));
  else if (modus === MODUS_AN) wendeUebernahmeAn(plan, dateien, rest);
  else melde(zusammenfassung(plan));
}

async function planen(werte) {
  const modus = env.UEBERNAHME ?? MODUS_SCHATTEN;
  const fehler = aufrufFehler(werte, modus);
  if (fehler !== null) {
    console.error(fehler);
    return EXIT_AUFRUF;
  }
  if (keineVorhersage(modus, werte)) {
    console.log("Übernahme: keine Vorhersage nötig.");
    return EXIT_OK;
  }
  const { plan, dateien } = await vorhersage(werte, modus);
  schreibePlan(plan, werte.ausgabe);
  meldeErgebnis({ plan, dateien, modus, rest: werte.rest });
  return EXIT_OK;
}

function berichtMitUebernommenen(bericht) {
  const eigene = existsSync(bericht) ? readFileSync(bericht) : Buffer.alloc(0);
  if (!existsSync(UEBERNOMMEN_DATEI)) return eigene;
  const inhalt = Buffer.concat([eigene, readFileSync(UEBERNOMMEN_DATEI)]);
  writeFileSync(bericht, inhalt);
  return inhalt;
}

function festhalten(werte) {
  const kennung = laufKennung({ version, umgebung: env });
  if (!werte.bericht || !werte.name || kennung === null) {
    console.error(`${AUFRUF}\nImageOS und ImageVersion müssen gesetzt sein.`);
    return EXIT_AUFRUF;
  }
  if (!existsSync(werte.bericht) && !existsSync(UEBERNOMMEN_DATEI)) {
    console.log(`Übernahme: ${werte.bericht} fehlt, nichts festgehalten.`);
    return EXIT_OK;
  }
  console.log(
    festhaltungsZeile({
      name: werte.name,
      summe: pruefsumme(berichtMitUebernommenen(werte.bericht)),
      baum: geprueftBaum(),
      kennung,
      wackelig: wackeligeDateien(WACKELIG_DATEI),
    }),
  );
  return EXIT_OK;
}

const BEFEHLE = new Map([
  ["planen", planen],
  ["festhalten", festhalten],
]);

export async function main(argumente) {
  const [befehl, ...rest] = argumente;
  const ausfuehren = BEFEHLE.get(befehl);
  if (ausfuehren === undefined) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  try {
    return await ausfuehren(optionen(rest));
  } catch (grund) {
    console.error(grund.message);
    return EXIT_FEHLER;
  }
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  process.exitCode = await main(process.argv.slice(ERSTES_ARGUMENT));
}
