import { existsSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { summeDerDateien, transkripteDerSitzung } from "../kosten.mjs";
import { alsText, kontextGroesse } from "../verlauf.mjs";

const TRANSKRIPT_ENDUNG = /\.jsonl$/;
const META_ENDUNG = ".meta.json";
const HAUPTAGENT = "haupt";
const EXIT_GRUEN = 0;
const JSON_EINRUECKUNG = 2;
const MS_JE_SEKUNDE = 1000;

function saetze(datei) {
  return readFileSync(datei, "utf8")
    .split("\n")
    .flatMap((zeile) => {
      try {
        const satz = JSON.parse(zeile);
        return satz !== null && typeof satz === "object" ? [satz] : [];
      } catch {
        return [];
      }
    });
}

function rolleDer(datei) {
  const meta = datei.replace(TRANSKRIPT_ENDUNG, META_ENDUNG);
  if (!existsSync(meta)) return HAUPTAGENT;
  return JSON.parse(readFileSync(meta, "utf8")).agentType ?? HAUPTAGENT;
}

function dauer(liste) {
  const zeiten = liste.map(({ timestamp }) => Date.parse(timestamp)).filter(Number.isFinite);
  return zeiten.length > 0 ? Math.max(...zeiten) - Math.min(...zeiten) : 0;
}

function werkzeugergebnisse(liste) {
  const zeichen = new Map();
  for (const satz of liste.filter(({ type }) => type === "user")) {
    const teile = Array.isArray(satz.message?.content) ? satz.message.content : [];
    for (const teil of teile.filter(({ type }) => type === "tool_result")) zeichen.set(teil.tool_use_id, alsText(teil.content).length);
  }
  return [...zeichen.values()].reduce((summe, anzahl) => summe + anzahl, 0);
}

function antworten(liste) {
  const jeNachricht = new Map();
  liste.forEach((satz, stelle) => {
    if (satz.type === "assistant") jeNachricht.set(satz.message?.id ?? `zeile ${stelle}`, satz.message?.usage ?? {});
  });
  return [...jeNachricht.values()];
}

export function messeDatei(datei) {
  const liste = saetze(datei);
  if (liste.length === 0) throw new Error(`Protokoll ohne lesbare Zeilen: ${datei}`);
  const verbrauch = antworten(liste);
  const sitzung = liste.find((satz) => satz.agentId !== undefined)?.agentId ?? liste.find((satz) => satz.sessionId !== undefined)?.sessionId ?? null;
  return {
    rolle: rolleDer(datei),
    sitzung,
    dauerMs: dauer(liste),
    schritte: verbrauch.length,
    groessterKontext: Math.max(0, ...verbrauch.map(kontextGroesse)),
    token: summeDerDateien([datei]).gesamt,
    werkzeugZeichen: werkzeugergebnisse(liste),
  };
}

export function messeProtokoll(datei) {
  if (!existsSync(datei)) throw new Error(`Protokoll fehlt: ${datei}`);
  const sitzung = basename(datei).replace(TRANSKRIPT_ENDUNG, "");
  return transkripteDerSitzung(dirname(datei), sitzung).map(messeDatei);
}

function zeile({ rolle, sitzung, dauerMs, schritte, groessterKontext, token, werkzeugZeichen }) {
  const sekunden = Math.round(dauerMs / MS_JE_SEKUNDE);
  return [rolle, sitzung, `${sekunden} s`, `${schritte} Schritte`, `Kontext ${groessterKontext}`, `${token} Token`, `${werkzeugZeichen} Werkzeugzeichen`].join("\t");
}

export function messung(datei, { json = false } = {}) {
  const beteiligte = messeProtokoll(datei);
  console.log(json ? JSON.stringify(beteiligte, null, JSON_EINRUECKUNG) : beteiligte.map(zeile).join("\n"));
  return EXIT_GRUEN;
}
