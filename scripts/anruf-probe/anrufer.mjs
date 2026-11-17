import { env } from "node:process";

import { DAUER_GRENZE_S } from "./urteil.mjs";
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
const ZIEL_OBJECTIVE = "Staging-Anrufprobe: Verbindung und Begrüßung prüfen, nach der Begrüßung auflegen.";
const TAG_LAENGE = 10;
const LISTE_OBERGRENZE = 30;
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

async function werkzeug({ abfrage, basis, token, name, argumente }) {
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
  if (!ergebnis || ergebnis.isError || !ergebnis.structuredContent) throw new Error(`mcp_${name}_fehlgeschlagen`);
  return ergebnis.structuredContent;
}

function gegenseitenText(zeile) {
  const vorspann = GEGENSEITE.find((rolle) => zeile.startsWith(rolle));
  return vorspann === undefined ? undefined : zeile.slice(vorspann.length);
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

export function anruferBauen({ basis, token, ziel, sprache, auftraggeber, vorname, abfrage, uhr = ECHTE_UHR }) {
  const ruf = (name, argumente) => werkzeug({ abfrage, basis, token, name, argumente });

  async function beobachten(callId) {
    const beginn = uhr.jetzt();
    const gegenseite = [];
    for (;;) {
      const stand = await ruf("get_call_status", { call_id: callId });
      gegenseite.push(...stand.last_transcript_lines.map(gegenseitenText).filter((text) => text !== undefined));
      if (ENDSTATUS.includes(stand.status)) return { stand, begruessung: gegenseite[0] };
      if (uhr.jetzt() - beginn >= DAUER_GRENZE_S * MS_JE_SEKUNDE) {
        await ruf("cancel_call", { call_id: callId });
        return { stand: await ruf("get_call_status", { call_id: callId }), begruessung: gegenseite[0] };
      }
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
      for (const anruf of offene) await ruf("cancel_call", { call_id: anruf.id });
      return offene.length;
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
        await ruf("cancel_call", { call_id: platziert.call_id }).catch(() => undefined);
        throw fehler;
      }
      const { stand, begruessung } = beobachtet;
      return {
        annahmeSekunden: (Date.parse(stand.answered_at) - Date.parse(stand.started_at)) / MS_JE_SEKUNDE,
        begruessung,
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
