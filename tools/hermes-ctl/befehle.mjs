import { spawnSync } from "node:child_process";
import { setTimeout as warten } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { STEUER_PFAD_ENDE } from "./attrappen.mjs";
import { HermesCtlFehler, REPO_WURZEL, laufendeSitzung } from "./sitzung.mjs";
import {
  LANGE_FRIST_MS,
  alsJson,
  anfrage,
  anrufLesen,
  gekuerzt,
  telnyxKopfzeilen,
  werkzeugAufrufen,
  werkzeugText,
} from "./zugriff.mjs";

const KATALOG_PRUEFEN = fileURLToPath(new URL("../katalog-pruefen.mjs", import.meta.url));
const BESTAETIGUNGSCODE = "hermes/confirmation_code";
const AUSGABE_PUFFER_BYTES = 67108864;
const ZUSTAND_FRIST_MS = 15000;
const ZUSTAND_TAKT_MS = 100;
const EL_WERKZEUG = "elevenlabs-werkzeug";
const EL_INIT = "elevenlabs-init";
const TELNYX = "telnyx";
const TELNYX_PFADE = ["status", "incoming", "turn", "outbound", "el-rueckfall", "el-bein"];

export const WEBHOOKS = new Map([
  ["elevenlabs-consult", { pfad: "/webhooks/elevenlabs/consult", art: EL_WERKZEUG }],
  ["elevenlabs-lookup", { pfad: "/webhooks/elevenlabs/lookup", art: EL_WERKZEUG }],
  ["elevenlabs-init", { pfad: "/webhooks/elevenlabs/init", art: EL_INIT }],
  ...TELNYX_PFADE.map((teil) => [`telnyx-${teil}`, { pfad: `/voice/${teil}`, art: TELNYX }]),
]);

function werkzeugErgebnis(name, ergebnis) {
  if (ergebnis.isError === true) {
    throw new HermesCtlFehler(
      `${name} lehnte ab: ${werkzeugText(ergebnis)}`,
      "Lies die Ablehnung und passe die Argumente oder den Ablauf an.",
    );
  }
  const { wert, ...kuerzung } = gekuerzt(ergebnis.structuredContent ?? ergebnis.content);
  return { werkzeug: name, ergebnis: wert, ...(kuerzung.gekuerzt ? kuerzung : {}) };
}

export async function werkzeug({ sitzung, argumente: [name, json] }) {
  const zustand = laufendeSitzung(sitzung);
  return werkzeugErgebnis(name, await werkzeugAufrufen(zustand, name, json));
}

export async function bestaetigen({ sitzung, argumente: [json] }) {
  const zustand = laufendeSitzung(sitzung);
  const vorbereitet = await werkzeugAufrufen(zustand, "prepare_call", json);
  werkzeugErgebnis("prepare_call", vorbereitet);
  const code = vorbereitet._meta?.[BESTAETIGUNGSCODE];
  if (!code) {
    throw new HermesCtlFehler(
      "prepare_call lieferte keinen Bestätigungscode",
      "Prüfe, ob MCP_UI_ENABLED in der Sitzung an ist (hermes-ctl setzt es beim Start).",
    );
  }
  const platziert = await werkzeugAufrufen(zustand, "place_call", {
    ...json,
    confirmation_code: code,
  });
  const { ergebnis } = werkzeugErgebnis("place_call", platziert);
  const anruf = await anrufLesen(zustand, ergebnis.call_id);
  return {
    call_id: ergebnis.call_id,
    conversation_id: anruf.elevenlabsConversationId ?? null,
    status: anruf.status,
  };
}

function telnyxAnfrage(zustand, json, falscheSignatur) {
  const { abfrage = {}, ...felder } = json;
  const parameter = new URLSearchParams(abfrage);
  if (felder.callId !== undefined) parameter.set("callId", felder.callId);
  const rumpf = new URLSearchParams(felder).toString();
  return {
    suffix: parameter.size > 0 ? `?${parameter}` : "",
    optionen: {
      method: "POST",
      headers: telnyxKopfzeilen(zustand, rumpf, falscheSignatur),
      body: rumpf,
    },
  };
}

function elevenLabsAnfrage(zustand, json, { art, falscheSignatur }) {
  const kopf = art === EL_INIT ? "x-hermes-init-token" : "x-hermes-tool-token";
  const token = art === EL_INIT ? zustand.token.init : zustand.token.werkzeug;
  return {
    suffix: "",
    optionen: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [kopf]: falscheSignatur ? `falsch-${token}` : token,
      },
      body: JSON.stringify(json),
    },
  };
}

export async function webhook({ sitzung, argumente: [art, json], falscheSignatur }) {
  const ziel = WEBHOOKS.get(art);
  if (ziel === undefined) {
    throw new HermesCtlFehler(
      `Unbekannter Webhook: ${art}`,
      `Nimm einen dieser Namen: ${[...WEBHOOKS.keys()].join(", ")}.`,
    );
  }
  const zustand = laufendeSitzung(sitzung);
  const { suffix, optionen } =
    ziel.art === TELNYX
      ? telnyxAnfrage(zustand, json, falscheSignatur)
      : elevenLabsAnfrage(zustand, json, { art: ziel.art, falscheSignatur });
  const { status, text, anfrageMs } = await anfrage(
    `${zustand.url}${ziel.pfad}${suffix}`,
    optionen,
    LANGE_FRIST_MS,
  );
  return { webhook: art, status, koerper: alsJson(text), anfrage_ms: anfrageMs };
}

async function gespraechsKennung(zustand, json) {
  if (json.conversation_id) return json.conversation_id;
  if (!json.call_id) {
    throw new HermesCtlFehler(
      "Weder call_id noch conversation_id angegeben",
      'Gib {"call_id": "…"} mit.',
    );
  }
  const anruf = await anrufLesen(zustand, json.call_id);
  if (!anruf.elevenlabsConversationId) {
    throw new HermesCtlFehler(
      `Anruf ${json.call_id} hat keine ElevenLabs-Konversation`,
      "Nur über „bestaetigen“ gestartete Anrufe haben eine Konversation bei der Attrappe.",
    );
  }
  return anruf.elevenlabsConversationId;
}

export async function anbieter({ sitzung, argumente: [ereignis, json] }) {
  if (ereignis !== "elevenlabs-ende") {
    throw new HermesCtlFehler(
      `Unbekanntes Anbieter-Ereignis: ${ereignis}`,
      "Bekannt ist nur elevenlabs-ende.",
    );
  }
  const zustand = laufendeSitzung(sitzung);
  const kennung = await gespraechsKennung(zustand, json);
  const zusammenfassung = new URLSearchParams(
    json.zusammenfassung ? { zusammenfassung: json.zusammenfassung } : {},
  );
  const adresse = `${zustand.attrappen.elevenLabs}${STEUER_PFAD_ENDE}${encodeURIComponent(kennung)}?${zusammenfassung}`;
  await anfrage(adresse, { method: "POST" });
  return { ereignis, conversation_id: kennung, anbieter_status: "done" };
}

export async function zustandLesen({ sitzung, argumente: [callId], wartenAuf }) {
  const zustand = laufendeSitzung(sitzung);
  const frist = Date.now() + ZUSTAND_FRIST_MS;
  let anruf = await anrufLesen(zustand, callId);
  while (wartenAuf && anruf.status !== wartenAuf && Date.now() < frist) {
    await warten(ZUSTAND_TAKT_MS);
    anruf = await anrufLesen(zustand, callId);
  }
  if (wartenAuf && anruf.status !== wartenAuf) {
    throw new HermesCtlFehler(
      `Anruf ${callId} steht nach ${ZUSTAND_FRIST_MS} ms auf ${anruf.status}, nicht auf ${wartenAuf}`,
      "Prüfe, ob das Anbieter-Ereignis gesendet wurde (anbieter elevenlabs-ende).",
    );
  }
  const { wert, ...kuerzung } = gekuerzt(anruf);
  return {
    call_id: callId,
    status: anruf.status,
    anruf: wert,
    ...(kuerzung.gekuerzt ? kuerzung : {}),
  };
}

export function flaechen() {
  const lauf = spawnSync(process.execPath, [KATALOG_PRUEFEN, "--flaechen"], {
    cwd: REPO_WURZEL,
    encoding: "utf8",
    env: { NODE_ENV: "test" },
    maxBuffer: AUSGABE_PUFFER_BYTES,
  });
  if (lauf.status !== 0) {
    throw new HermesCtlFehler(
      `Flächen ließen sich nicht ermitteln: ${lauf.stderr.trim()}`,
      "Führe „node tools/katalog-pruefen.mjs --flaechen“ aus und behebe die Meldung.",
    );
  }
  const liste = JSON.parse(lauf.stdout);
  const anzahl = {};
  for (const { art } of liste) anzahl[art] = (anzahl[art] ?? 0) + 1;
  return { anzahl, flaechen: liste };
}
