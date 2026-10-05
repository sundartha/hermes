import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { abdruckEinstellungen, abdruckSpeicher, anrufstartFaelle, eingangsFaelle } from "./abdruck-faelle.mjs";
import { FEHLER, abbild, istEinfachesObjekt, kanonisch } from "./abdruck-wert.mjs";

const FESTE_ZEIT = Date.parse("2026-01-15T09:30:00Z");
const HTTP_OK = 200;
const MASKE = "‹maskiert›";
const MASKIERTE_VARIABLEN = Object.freeze(["today"]);
const STUMME_KONSOLE = Object.freeze(["log", "info", "warn", "error", "debug", "trace"]);
const NICHT_GESPROCHEN = new Set(["mcp", "gates", "postCall", "newsletter"]);
const EXIT_AUFRUF = 2;
const ERSTES_ARGUMENT = 2;

const PFADE = Object.freeze({
  anrufstart: "src/elevenlabs/outbound.js",
  eingangsstart: "src/elevenlabs/inbound-initiation.js",
  prompts: "src/i18n/prompts",
  locales: "src/i18n/locales.js",
  stimmen: "src/telephony/adapters/telnyx/elevenlabs-voice.js",
  vorlage: "elevenlabs/agent_configs/outbound-agent.template.json",
});

const netz = { mitschnitt: null };

function uhrFestsetzen() {
  const EchtesDatum = Date;
  class FestesDatum extends EchtesDatum {
    constructor(...werte) {
      if (werte.length === 0) super(FESTE_ZEIT);
      else super(...werte);
    }

    static now() {
      return FESTE_ZEIT;
    }
  }
  globalThis.Date = FestesDatum;
}

function pfadVon(adresse) {
  try {
    return new URL(String(adresse)).pathname;
  } catch {
    return "‹unlesbar›";
  }
}

function koerperVon(koerper) {
  if (typeof koerper !== "string") return koerper ?? null;
  try {
    return JSON.parse(koerper);
  } catch {
    return koerper;
  }
}

function netzAttrappe() {
  globalThis.fetch = async (adresse, anfrage = {}) => {
    netz.mitschnitt?.push({
      methode: anfrage.method ?? "GET",
      pfad: pfadVon(adresse),
      koerper: koerperVon(anfrage.body),
    });
    return new Response(JSON.stringify({ conversation_id: "abdruck-gespraech" }), {
      status: HTTP_OK,
      headers: { "content-type": "application/json" },
    });
  };
}

function konsoleStumm() {
  for (const name of STUMME_KONSOLE) console[name] = () => undefined;
  process.on("unhandledRejection", () => undefined);
}

function modulAdresse(wurzel, pfad) {
  return pathToFileURL(join(wurzel, pfad)).href;
}

function maskiereHeute(wert) {
  if (Array.isArray(wert)) return wert.map(maskiereHeute);
  if (wert === null || typeof wert !== "object") return wert;
  return Object.fromEntries(
    Object.entries(wert).map(([schluessel, kind]) => {
      if (schluessel !== "dynamic_variables" || !istEinfachesObjekt(kind)) return [schluessel, maskiereHeute(kind)];
      const maskiert = { ...kind };
      for (const name of MASKIERTE_VARIABLEN) if (name in maskiert) maskiert[name] = MASKE;
      return [schluessel, maskiert];
    }),
  );
}

async function sicher(erzeugen) {
  try {
    return abbild(await erzeugen());
  } catch {
    return FEHLER;
  }
}

async function anrufstartTeile(wurzel) {
  const teile = {};
  for (const fall of anrufstartFaelle()) {
    teile[fall.name] = await sicher(async () => {
      const { makeElevenLabsOutbound } = await import(modulAdresse(wurzel, PFADE.anrufstart));
      netz.mitschnitt = [];
      const { originateCall } = makeElevenLabsOutbound({
        store: abdruckSpeicher(fall.speicherSprache),
        config: abdruckEinstellungen(),
        terminateAndBillCall: async () => undefined,
        billThunk: () => async () => undefined,
        finishCall: async () => undefined,
        consultAllowedForCall: () => fall.consult,
      });
      await originateCall(fall.anruf);
      const anfragen = netz.mitschnitt;
      netz.mitschnitt = null;
      return maskiereHeute(anfragen);
    });
  }
  return teile;
}

async function eingangsTeile(wurzel) {
  const teile = {};
  for (const fall of eingangsFaelle()) {
    teile[fall.name] = await sicher(async () => {
      const { buildInitiationResponse } = await import(modulAdresse(wurzel, PFADE.eingangsstart));
      const antwort = buildInitiationResponse({
        store: abdruckSpeicher(fall.speicherSprache),
        config: abdruckEinstellungen(),
        call: fall.anruf,
      });
      return maskiereHeute(antwort);
    });
  }
  return teile;
}

function exportTeile(praefix, modul, bekannt) {
  const teile = {};
  for (const [name, wert] of Object.entries(modul)) {
    const teil = `${praefix}/${name}`;
    if (wert !== null && typeof wert === "object") bekannt.set(wert, teil);
    if (!istEinfachesObjekt(wert)) {
      teile[teil] = abbild(wert);
      continue;
    }
    for (const [schluessel, kind] of Object.entries(wert)) teile[`${teil}.${schluessel}`] = abbild(kind);
  }
  return teile;
}

async function promptTeile(wurzel, bekannt) {
  let dateien;
  try {
    dateien = readdirSync(join(wurzel, PFADE.prompts)).filter((datei) => datei.endsWith(".js")).sort();
  } catch {
    return { prompts: FEHLER };
  }
  const teile = {};
  for (const datei of dateien) {
    const praefix = `prompts/${datei.slice(0, -".js".length)}`;
    try {
      const modul = await import(modulAdresse(wurzel, join(PFADE.prompts, datei)));
      Object.assign(teile, exportTeile(praefix, modul, bekannt));
    } catch {
      teile[praefix] = FEHLER;
    }
  }
  return teile;
}

function katalogAufrufe(funktion, katalog) {
  return Object.fromEntries(
    katalog.map((eintrag) => {
      try {
        return [eintrag, abbild(funktion(eintrag))];
      } catch {
        return [eintrag, { art: "wirft" }];
      }
    }),
  );
}

function buendelWert(wert, { bekannt, katalog }) {
  if (bekannt.has(wert)) return { art: "verweis", ziel: bekannt.get(wert) };
  if (typeof wert !== "function" || katalog.length === 0) return abbild(wert);
  return { ...abbild(wert), katalog: katalogAufrufe(wert, katalog) };
}

function stilKatalog(modul) {
  const katalog = modul.PERSONA_STYLE_IDS;
  return Array.isArray(katalog) ? katalog.filter((eintrag) => typeof eintrag === "string") : [];
}

function buendelTeile(sprache, buendel, kontext) {
  if (!istEinfachesObjekt(buendel)) return { [`locales/${sprache}`]: abbild(buendel) };
  const teile = {};
  for (const [schluessel, wert] of Object.entries(buendel)) {
    if (!NICHT_GESPROCHEN.has(schluessel)) teile[`locales/${sprache}.${schluessel}`] = buendelWert(wert, kontext);
  }
  return teile;
}

async function localeTeile(wurzel, bekannt) {
  try {
    const modul = await import(modulAdresse(wurzel, PFADE.locales));
    const { LOCALES } = modul;
    if (!istEinfachesObjekt(LOCALES)) return { locales: FEHLER };
    const kontext = { bekannt, katalog: stilKatalog(modul) };
    const teile = {};
    for (const [sprache, buendel] of Object.entries(LOCALES)) Object.assign(teile, buendelTeile(sprache, buendel, kontext));
    return teile;
  } catch {
    return { locales: FEHLER };
  }
}

async function stimmenTeile(wurzel) {
  return {
    stimmen: await sicher(async () => {
      const { ELEVENLABS_VOICE_ID_BY_PROFILE: tabelle } = await import(modulAdresse(wurzel, PFADE.stimmen));
      if (!istEinfachesObjekt(tabelle)) throw new TypeError("Stimmen-Tabelle fehlt");
      return tabelle;
    }),
  };
}

function wertAnPfad(wurzel, pfad) {
  let aktuell = wurzel;
  for (const segment of String(pfad).split(".")) {
    if (aktuell === null || typeof aktuell !== "object" || !(segment in aktuell)) return { art: "fehlt" };
    aktuell = aktuell[segment];
  }
  return aktuell;
}

function eintraegeVon(sammlung) {
  if (Array.isArray(sammlung)) return sammlung.filter((eintrag) => typeof eintrag?.name === "string").map((eintrag) => [eintrag.name, eintrag]);
  if (sammlung === null || typeof sammlung !== "object") return [];
  return Object.entries(sammlung).filter(([name, inhalt]) => !name.startsWith("_") && inhalt !== null);
}

function besitzWert(vorlage, eintrag) {
  const werte = (Array.isArray(eintrag.vorlage) ? eintrag.vorlage : []).map((pfad) => wertAnPfad(vorlage, pfad));
  if (eintrag.art === "namen") return [...new Set(werte.flatMap((wert) => eintraegeVon(wert).map(([name]) => name)))].sort();
  if (eintrag.art === "texte") {
    return werte
      .flatMap(eintraegeVon)
      .map(([name, inhalt]) => [name, wertAnPfad(inhalt, eintrag.je_eintrag)])
      .sort(([links], [rechts]) => (links < rechts ? -1 : Number(links > rechts)));
  }
  return werte;
}

function vorlageTeile(wurzel) {
  try {
    const vorlage = JSON.parse(readFileSync(join(wurzel, PFADE.vorlage), "utf8"));
    const felder = vorlage?._besitz?.felder;
    if (!Array.isArray(felder)) return { vorlage: FEHLER };
    const teile = {};
    for (const eintrag of felder) teile[`vorlage/${eintrag?.feld}`] = abbild(besitzWert(vorlage, eintrag ?? {}));
    return teile;
  } catch {
    return { vorlage: FEHLER };
  }
}

async function abdruck(wurzel) {
  const bekannt = new Map();
  const prompts = await promptTeile(wurzel, bekannt);
  return {
    ...prompts,
    ...(await localeTeile(wurzel, bekannt)),
    ...(await stimmenTeile(wurzel)),
    ...vorlageTeile(wurzel),
    ...(await anrufstartTeile(wurzel)),
    ...(await eingangsTeile(wurzel)),
  };
}

const [wurzel, ausgabe] = process.argv.slice(ERSTES_ARGUMENT);
if (!wurzel || !ausgabe) process.exit(EXIT_AUFRUF);
uhrFestsetzen();
netzAttrappe();
konsoleStumm();
writeFileSync(ausgabe, kanonisch(await abdruck(wurzel)));
process.exit(0);
