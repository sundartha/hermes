import { existsSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { summeDerVerbraeuche, transkripteDerSitzung, verbrauchJeAntwort } from "../kosten.mjs";
import { alsText, kontextGroesse } from "../verlauf.mjs";

const TRANSKRIPT_ENDUNG = /\.jsonl$/;
const META_ENDUNG = ".meta.json";
const HAUPTAGENT = "haupt";
const EXIT_GRUEN = 0;
const JSON_EINRUECKUNG = 2;
const MS_JE_SEKUNDE = 1000;
const QUOTE_WIRKT = 0.9;
const QUOTE_WIRKT_NICHT = 0.1;
const QUOTE_STELLEN = 1000;

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

export function messeDatei(datei) {
  const liste = saetze(datei);
  if (liste.length === 0) throw new Error(`Protokoll ohne lesbare Zeilen: ${datei}`);
  const verbrauch = verbrauchJeAntwort(datei);
  const sitzung = liste.find((satz) => satz.agentId !== undefined)?.agentId ?? liste.find((satz) => satz.sessionId !== undefined)?.sessionId ?? null;
  return {
    rolle: rolleDer(datei),
    sitzung,
    dauerMs: dauer(liste),
    schritte: verbrauch.length,
    groessterKontext: Math.max(0, ...verbrauch.map(kontextGroesse)),
    token: summeDerVerbraeuche(verbrauch).gesamt,
    werkzeugZeichen: werkzeugergebnisse(liste),
  };
}

export function messeProtokoll(datei) {
  if (!existsSync(datei)) throw new Error(`Protokoll fehlt: ${datei}`);
  const sitzung = basename(datei).replace(TRANSKRIPT_ENDUNG, "");
  return transkripteDerSitzung(dirname(datei), sitzung).map(messeDatei);
}

function istNachricht(satz) {
  if (satz.type !== "user" || satz.isMeta === true) return false;
  const inhalt = satz.message?.content;
  return typeof inhalt === "string" || (Array.isArray(inhalt) && !inhalt.some((teil) => teil?.type === "tool_result"));
}

function zahl(wert) {
  return Number(wert) || 0;
}

function urteil(quote) {
  if (quote === null) return "nicht gemessen";
  if (quote >= QUOTE_WIRKT) return "wirkt";
  return quote < QUOTE_WIRKT_NICHT ? "wirkt nicht" : "teilweise";
}

function messeFortsetzung(vorher, nachher) {
  const verbrauch = nachher.message?.usage ?? {};
  const kontextVorher = kontextGroesse(vorher.message?.usage);
  const cacheRead = zahl(verbrauch.cache_read_input_tokens);
  const quote = kontextVorher > 0 ? Math.round((cacheRead / kontextVorher) * QUOTE_STELLEN) / QUOTE_STELLEN : null;
  return {
    pauseS: Math.round((Date.parse(nachher.timestamp) - Date.parse(vorher.timestamp)) / MS_JE_SEKUNDE),
    kontextVorher,
    cacheRead,
    cacheWrite: zahl(verbrauch.cache_creation_input_tokens),
    cacheWrite1h: zahl(verbrauch.cache_creation?.ephemeral_1h_input_tokens),
    cacheWrite5m: zahl(verbrauch.cache_creation?.ephemeral_5m_input_tokens),
    input: zahl(verbrauch.input_tokens),
    quote,
    urteil: urteil(quote),
  };
}

export function fortsetzungen(datei) {
  const ergebnis = [];
  let nachrichten = 0;
  let letzte = null;
  let wartend = null;
  for (const satz of saetze(datei)) {
    if (istNachricht(satz)) {
      nachrichten += 1;
      wartend = nachrichten > 1 ? letzte : null;
    } else if (satz.type === "assistant") {
      if (wartend !== null) ergebnis.push(messeFortsetzung(wartend, satz));
      wartend = null;
      letzte = satz;
    }
  }
  return ergebnis;
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
