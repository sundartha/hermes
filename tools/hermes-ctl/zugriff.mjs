import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

import { HermesCtlFehler } from "./sitzung.mjs";

const STANDARD_FRIST_MS = 15000;
export const LANGE_FRIST_MS = 60000;
const MS_JE_SEKUNDE = 1000;
const ANTWORT_GRENZE = 20000;
const DATENZEILE = "data:";
const NACHRICHTEN_KENNUNG = 1;
export const HTTP_OK = 200;

export async function anfrage(url, optionen, fristMs = STANDARD_FRIST_MS) {
  const beginn = performance.now();
  let antwort;
  try {
    antwort = await fetch(url, { ...optionen, signal: AbortSignal.timeout(fristMs) });
  } catch (fehler) {
    throw new HermesCtlFehler(
      `Anfrage an ${url} gescheitert: ${fehler.cause?.code ?? fehler.name}`,
      "Prüfe, ob die Sitzung noch läuft (stopp und start), und rufe den Befehl erneut auf.",
    );
  }
  const text = await antwort.text();
  return { status: antwort.status, text, anfrageMs: Math.round(performance.now() - beginn) };
}

export function alsJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function gekuerzt(wert) {
  const text = JSON.stringify(wert) ?? "";
  if (text.length <= ANTWORT_GRENZE) return { wert, gekuerzt: false };
  return {
    wert: text.slice(0, ANTWORT_GRENZE),
    gekuerzt: true,
    hinweis: `Ausgabe nach ${ANTWORT_GRENZE} von ${text.length} Zeichen gekürzt; der Wert ist hier Text, kein JSON.`,
  };
}

function rpcNachricht(text) {
  const rumpf = text.trim();
  const roh = rumpf.startsWith("{")
    ? rumpf
    : (text.split(/\r?\n/).find((zeile) => zeile.startsWith(DATENZEILE)) ?? "").slice(
        DATENZEILE.length,
      );
  const nachricht = alsJson(roh);
  if (typeof nachricht === "object" && nachricht !== null) return nachricht;
  throw new HermesCtlFehler(
    `Keine JSON-RPC-Antwort vom MCP-Endpunkt: ${text.slice(0, ANTWORT_GRENZE)}`,
    "Prüfe im Hermes-Protokoll der Sitzung, ob der Server läuft.",
  );
}

export async function werkzeugAufrufen(zustand, name, argumente) {
  const { text } = await anfrage(
    `${zustand.url}/mcp`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: NACHRICHTEN_KENNUNG,
        method: "tools/call",
        params: { name, arguments: argumente },
      }),
    },
    LANGE_FRIST_MS,
  );
  const nachricht = rpcNachricht(text);
  if (nachricht.error !== undefined) {
    throw new HermesCtlFehler(
      `MCP-Fehler bei ${name}: ${nachricht.error.message}`,
      "Prüfe Werkzeugname und Argumente; die Werkzeuge listet „npm run hermes-ctl -- flaechen“.",
    );
  }
  return nachricht.result;
}

export function werkzeugText(ergebnis) {
  return (ergebnis.content ?? []).map((teil) => teil.text ?? "").join(" ");
}

export async function anrufLesen(zustand, callId) {
  const { status, text } = await anfrage(
    `${zustand.url}/api/calls/${encodeURIComponent(callId)}`,
    {},
  );
  if (status !== HTTP_OK) {
    throw new HermesCtlFehler(
      `Anruf ${callId} nicht gefunden (HTTP ${status})`,
      "Nimm die call_id, die „bestaetigen“ ausgegeben hat.",
    );
  }
  return JSON.parse(text);
}

export function telnyxKopfzeilen(zustand, rumpf, falscheSignatur) {
  const zeitstempel = String(Math.floor(Date.now() / MS_JE_SEKUNDE));
  const schluessel = falscheSignatur
    ? generateKeyPairSync("ed25519").privateKey
    : createPrivateKey(zustand.telnyxPrivatPem);
  const signatur = sign(null, Buffer.from(`${zeitstempel}|${rumpf}`), schluessel).toString(
    "base64",
  );
  return {
    "content-type": "application/x-www-form-urlencoded",
    "telnyx-signature-ed25519": signatur,
    "telnyx-timestamp": zeitstempel,
  };
}
