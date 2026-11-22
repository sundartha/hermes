import { env } from "node:process";

import { EL_ABORT_PROVIDER_TIMEOUT_MS, EL_TERMINATION_RESULT_ATTEMPTS } from "../../src/elevenlabs/outbound.js";
import { STIMMEN_FRIST_MS } from "../../src/elevenlabs/wirksame-stimme.ts";
import { ELEVENLABS_RESULT_POLL_STANDARD_MS } from "../../src/konfiguration/rohwerte-voice.ts";
import { LOCALES } from "../../src/i18n/locales.ts";
import { STIMMEN_ANZAHL_META_KEY } from "../../src/ui/widget-i18n.js";
import { DAUER_GRENZE_S, MINDESTDAUER_S } from "./urteil.mjs";
import { ABSTAND_MS } from "./wiederholung.mjs";

const ABFRAGE_FRIST_MS = 10_000;
const TAKT_MS = 2000;
const MS_JE_SEKUNDE = 1000;
const ENDSTATUS = Object.freeze(["completed", "failed", "cancelled", "no_answer", "busy"]);
const GEGENSEITE = Object.freeze(["Gegenseite: ", "Other party: ", "Interlocuteur: "]);
const PROBEN_LAENGEN_IM_PUFFER = 2;
const WIEDERHOLUNG_PUFFER_MS = PROBEN_LAENGEN_IM_PUFFER * DAUER_GRENZE_S * MS_JE_SEKUNDE;
const WIEDERHOLUNG_BIS_MS = ABSTAND_MS + WIEDERHOLUNG_PUFFER_MS;
const SPRACHE = "de";
const RICHTUNG = "eingehend";
const ZIEL_OBJECTIVE = `Staging-Anrufprobe: Verbindung und Begrüßung prüfen, das Gespräch mindestens ${MINDESTDAUER_S} Sekunden führen.`;
const TAG_LAENGE = 10;
export const LISTE_OBERGRENZE = 30;
const ERGEBNIS_FRIST_MS = DAUER_GRENZE_S * MS_JE_SEKUNDE;
const ZUSAMMENFASSUNG_PLATZHALTER = Object.freeze(Object.values(LOCALES).map((locale) => locale.mcp.awaitSummary));
export const STIMMEN_NACHLAUF_QUELLEN = Object.freeze({
  versuche: EL_TERMINATION_RESULT_ATTEMPTS,
  abrufFristMs: EL_ABORT_PROVIDER_TIMEOUT_MS,
  pauseMs: ELEVENLABS_RESULT_POLL_STANDARD_MS,
  stimmenFristMs: STIMMEN_FRIST_MS,
});
const STIMMEN_NACHLAUF_FRIST_MS =
  STIMMEN_NACHLAUF_QUELLEN.versuche * STIMMEN_NACHLAUF_QUELLEN.abrufFristMs +
  (STIMMEN_NACHLAUF_QUELLEN.versuche - 1) * STIMMEN_NACHLAUF_QUELLEN.pauseMs +
  STIMMEN_NACHLAUF_QUELLEN.stimmenFristMs;
const GEGEN_VORLAUF_MS = 5000;
const GEGEN_NACHLAUF_MS = DAUER_GRENZE_S * MS_JE_SEKUNDE;
const ECHTE_UHR = Object.freeze({
  jetzt: () => Date.now(),
  warte: (ms) => new Promise((fertig) => setTimeout(fertig, ms)),
});

function leseRpc(text) {
  const eingabe = text.trim();
  const datenzeile = eingabe.split(/\r?\n/).find((zeile) => zeile.startsWith("data:")) ?? "";
  const roh = eingabe.startsWith("{") ? eingabe : datenzeile.slice("data:".length).trim();
  return roh === "" ? null : JSON.parse(roh);
}

async function werkzeug({ abfrage, basis, token, name, argumente, ohneStruktur = false }) {
  const antwort = await abfrage(`${basis}/mcp`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(ABFRAGE_FRIST_MS),
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: argumente } }),
  });
  if (!antwort.ok) throw new Error(`mcp_http_${antwort.status}`);
  const ergebnis = leseRpc(await antwort.text())?.result;
  if (!ergebnis || ergebnis.isError || (!ohneStruktur && !ergebnis.structuredContent)) {
    throw new Error(`mcp_${name}_fehlgeschlagen`);
  }
  return { ...ergebnis.structuredContent, _meta: ergebnis._meta };
}

function gegenseitenText(zeile) {
  const vorspann = GEGENSEITE.find((rolle) => zeile.startsWith(rolle));
  return vorspann === undefined ? undefined : zeile.slice(vorspann.length);
}

function ueberlappung(bisher, fenster) {
  for (let laenge = Math.min(bisher.length, fenster.length); laenge > 0; laenge -= 1) {
    if (bisher.slice(-laenge).every((zeile, index) => zeile === fenster[index])) return laenge;
  }
  return 0;
}

function verlaufNeu() {
  return { zeilen: [], eroeffnungMs: undefined, naechsteMs: undefined };
}

function verlaufAufnehmen(verlauf, fenster, jetzt) {
  const zeilen = [...verlauf.zeilen, ...fenster.slice(ueberlappung(verlauf.zeilen, fenster))];
  const index = zeilen.findIndex((zeile) => gegenseitenText(zeile) !== undefined);
  if (index < 0) return { ...verlauf, zeilen };
  return {
    zeilen,
    eroeffnungMs: verlauf.eroeffnungMs ?? jetzt,
    naechsteMs: verlauf.naechsteMs ?? (zeilen.length > index + 1 ? jetzt : undefined),
  };
}

function verlaufErgebnis(verlauf, endeMs) {
  const gegenseite = verlauf.zeilen.map(gegenseitenText).filter((text) => text !== undefined);
  const stillstandSekunden =
    verlauf.eroeffnungMs === undefined
      ? undefined
      : ((verlauf.naechsteMs ?? endeMs) - verlauf.eroeffnungMs) / MS_JE_SEKUNDE;
  return { gegenseite, begruessung: gegenseite[0], begruessungAntwort: gegenseite.length > 1, stillstandSekunden };
}

function startMs(stand) {
  const ms = Date.parse(stand.started_at);
  if (!Number.isFinite(ms)) throw new Error("probe_startzeit_unlesbar");
  return ms;
}

function wiederholungen(starts) {
  return starts.filter((ms, index) => {
    const abstand = ms - starts[index - 1];
    return abstand >= ABSTAND_MS && abstand <= WIEDERHOLUNG_BIS_MS;
  }).length;
}

async function gegenStimmenAnzahl(ruf, probeStartMs) {
  const { calls } = await ruf("list_calls", {});
  for (const anruf of calls.filter((eintrag) => eintrag.direction === "inbound")) {
    const gegen = await ruf("get_call_status", { call_id: anruf.id });
    const nach = Date.parse(gegen.started_at) - probeStartMs;
    if (nach >= -GEGEN_VORLAUF_MS && nach <= GEGEN_NACHLAUF_MS) return gegen._meta?.[STIMMEN_ANZAHL_META_KEY];
  }
  return undefined;
}

export function anruferBauen({ basis, token, ziel, sprache, auftraggeber, vorname, abfrage, uhr = ECHTE_UHR }) {
  const ruf = (name, argumente) => werkzeug({ abfrage, basis, token, name, argumente });
  const abbrechen = (callId) =>
    werkzeug({ abfrage, basis, token, name: "cancel_call", argumente: { call_id: callId }, ohneStruktur: true });

  let probeStartMs = Number.NaN;
  let probeCallId;

  async function beobachten(callId) {
    const beginn = uhr.jetzt();
    let verlauf = verlaufNeu();
    for (;;) {
      const stand = await ruf("get_call_status", { call_id: callId });
      const jetzt = uhr.jetzt();
      verlauf = verlaufAufnehmen(verlauf, stand.last_transcript_lines, jetzt);
      if (ENDSTATUS.includes(stand.status)) return { stand, ...verlaufErgebnis(verlauf, jetzt) };
      if (jetzt - beginn >= DAUER_GRENZE_S * MS_JE_SEKUNDE) {
        await abbrechen(callId);
        return { stand: await ruf("get_call_status", { call_id: callId }), ...verlaufErgebnis(verlauf, jetzt) };
      }
      await uhr.warte(TAKT_MS);
    }
  }

  async function ergebnisAbwarten(callId) {
    const beginn = uhr.jetzt();
    for (;;) {
      const ergebnis = await ruf("get_call_result", { call_id: callId }).catch(() => undefined);
      const text = ergebnis?.result_summary;
      if (typeof text === "string" && text.trim() !== "" && !ZUSAMMENFASSUNG_PLATZHALTER.includes(text)) return true;
      if (uhr.jetzt() - beginn >= ERGEBNIS_FRIST_MS) return false;
      await uhr.warte(TAKT_MS);
    }
  }

  return {
    eigeneNummer: async () => (await ruf("get_agent_number", {})).number,
    tagesstand: async () => {
      const { calls } = await ruf("list_calls", {});
      const heute = new Date(uhr.jetzt()).toISOString().slice(0, TAG_LAENGE);
      const startVon = async (anruf) => startMs(await ruf("get_call_status", { call_id: anruf.id }));
      const tag = (ms) => new Date(ms).toISOString().slice(0, TAG_LAENGE);
      if (calls.length >= LISTE_OBERGRENZE) {
        const tage = [];
        for (const anruf of calls) tage.push(tag(await startVon(anruf)));
        if (!tage.some((eintrag) => eintrag < heute)) throw new Error("probe_tageszaehl_unklar");
      }
      const eigene = calls.filter((anruf) => anruf.direction === "outbound" && anruf.counterparty === ziel);
      const starts = [];
      for (const anruf of eigene) starts.push(await startVon(anruf));
      const heutige = starts.filter((ms) => tag(ms) === heute).sort((frueher, spaeter) => frueher - spaeter);
      return { erstversuche: heutige.length - wiederholungen(heutige), anrufe: heutige.length };
    },
    offeneBeenden: async () => {
      const { calls } = await ruf("list_calls", {});
      const offene = calls.filter(
        (anruf) => anruf.direction === "outbound" && anruf.counterparty === ziel && !ENDSTATUS.includes(anruf.status),
      );
      for (const anruf of offene) await abbrechen(anruf.id);
      return offene.length;
    },
    ergebnisVorgetragen: () => ergebnisAbwarten(probeCallId),
    stimmenAnzahl: async () => {
      for (let gewartetMs = 0; ; gewartetMs += TAKT_MS) {
        const wert = await gegenStimmenAnzahl(ruf, probeStartMs);
        if (wert !== undefined || gewartetMs >= STIMMEN_NACHLAUF_FRIST_MS) return wert;
        await uhr.warte(TAKT_MS);
      }
    },
    anrufen: async ({ ziel: nummer }) => {
      const platziert = await ruf("place_call", {
        to: nummer,
        objective: ZIEL_OBJECTIVE,
        max_duration_s: DAUER_GRENZE_S,
        language: SPRACHE,
      });
      let beobachtet;
      try {
        beobachtet = await beobachten(platziert.call_id);
      } catch (fehler) {
        await abbrechen(platziert.call_id).catch(() => undefined);
        throw fehler;
      }
      const { stand, begruessung, begruessungAntwort, gegenseite, stillstandSekunden } = beobachtet;
      probeStartMs = Date.parse(stand.started_at);
      probeCallId = platziert.call_id;
      return {
        annahmeSekunden: (Date.parse(stand.answered_at) - Date.parse(stand.started_at)) / MS_JE_SEKUNDE,
        begruessung,
        begruessungAntwort,
        gegenseite,
        stillstandSekunden,
        sprache,
        auftraggeber,
        vorname,
        richtung: RICHTUNG,
        dauerSekunden: stand.duration_s,
        status: stand.status,
      };
    },
  };
}

export const anrufer = anruferBauen({
  basis: env.STAGING_URL,
  token: env.STAGING_TEST_TOKEN,
  ziel: env.STAGING_PROBE_ZIEL,
  sprache: SPRACHE,
  auftraggeber: env.STAGING_PROBE_AUFTRAGGEBER,
  vorname: env.STAGING_PROBE_VORNAME,
  abfrage: (...argumente) => fetch(...argumente),
});
