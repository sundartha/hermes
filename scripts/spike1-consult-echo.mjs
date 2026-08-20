#!/usr/bin/env node
// WEGWERF-SKRIPT fuer Spike 1 (UMSETZUNG-ElevenLabs.md Zeile 312-349, "Traegt
// der Rueckfrage-Kanal?"). Zeigt NICHT auf Hermes und haengt NICHT am
// Hauptserver (src/server.js) - ein eigener Node-Prozess auf einem eigenen
// Port. KEINE Auth, KEINE Safety-Gates, KEINE Persistenz - reine Attrappe
// fuer das spaetere get_consult-Webhook-Werkzeug. WIRD NACH SPIKE 1 WIEDER
// GELOESCHT - niemand baue etwas Dauerhaftes darauf auf.
//
// Tut GENAU EINS: eine einstellbare Zeit warten, dann antworten. Simuliert
// damit die Werkzeug-Wartezeit, die Spike 1 pruefen soll (haelt der
// ElevenLabs-Agent 30/45/60 Sekunden Wartezeit durch, ohne dazwischenzureden
// oder das Gespraech zerfallen zu lassen?).
//
// Wartezeit einstellbar ueber Query-Parameter ODER JSON-Body-Feld
// "wait_seconds" (Body schlaegt Query, falls beide gesetzt sind).
// Fliesskommazahlen sind erlaubt - so kann ein Test mit Millisekunden-Werten
// (z.B. 0.1) arbeiten, waehrend der echte ElevenLabs-Aufruf glatte Sekunden
// (30/45/60) schickt. Fehlt der Wert oder ist er unsinnig (keine Zahl,
// negativ), gilt DEFAULT_WAIT_SECONDS. Werte oberhalb MAX_WAIT_SECONDS werden
// gekappt, nie abgelehnt - der Endpunkt antwortet immer, hoechstens spaeter.
// MAX_WAIT_SECONDS ist die von ElevenLabs dokumentierte Obergrenze fuer
// response_timeout_secs (UMSETZUNG-ElevenLabs.md Zeile 320).
//
// Aufruf:  node scripts/spike1-consult-echo.mjs [port]
// Ohne Argument laeuft der Server auf DEFAULT_PORT.
//
// Protokolliert pro Anfrage genau das, was Spike 1 auswerten will: wann sie
// eintraf, wie lange gewartet wurde, wann geantwortet wurde.
import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WAIT_SECONDS = 30;
export const MAX_WAIT_SECONDS = 300;
const DEFAULT_PORT = 8931;
const MS_PER_SECOND = 1000;
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const LOG_PREFIX = "[spike1-consult-echo]";

// Request-Body vollstaendig einsammeln und tolerant als JSON parsen. Leerer
// oder kaputter Body wird zu {} statt einen Fehler zu werfen - der Endpunkt
// soll auf jede Anfrage antworten koennen, auch ohne Body.
function readJsonBody(req) {
  return new Promise((settle, fail) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("error", fail);
    req.on("end", () => {
      try {
        settle(raw ? JSON.parse(raw) : {});
      } catch {
        settle({});
      }
    });
  });
}

// Eine einzelne Zahl aus einem Query- oder Body-Wert lesen. Fehlender Wert,
// keine Zahl oder negativ -> undefined (Aufrufer faellt dann auf den
// Standardwert zurueck). Der explizite null/undefined-Check ist noetig, weil
// URLSearchParams.get() bei einem fehlenden Parameter null liefert und
// Number(null) 0 ergibt - ohne den Check wuerde ein fehlender Parameter als
// "0 Sekunden warten" statt als "kein Wert" gelesen.
function parseWaitSeconds(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return undefined;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

// Wartezeit aus der Anfrage aufloesen: Body-Feld schlaegt Query-Parameter,
// fehlende/unsinnige Werte fallen auf DEFAULT_WAIT_SECONDS zurueck, alles
// oberhalb MAX_WAIT_SECONDS wird gekappt. Reine Funktion (kein IO) -
// exportiert, damit der Test Kapp- und Fallback-Verhalten ohne echten
// Wartelauf pruefen kann.
export function resolveWaitSeconds(url, body) {
  const fromQuery = parseWaitSeconds(url.searchParams.get("wait_seconds"));
  const fromBody = parseWaitSeconds(body && body.wait_seconds);
  const requested = fromBody ?? fromQuery ?? DEFAULT_WAIT_SECONDS;
  return Math.min(requested, MAX_WAIT_SECONDS);
}

function wait(ms) {
  return new Promise((settle) => setTimeout(settle, ms));
}

// Eine Anfrage bedienen: Wartezeit ermitteln, warten, antworten - und dabei
// protokollieren, was Spike 1 auswerten will (Eingang/Wartezeit/Antwort).
async function handleRequest(req, res) {
  const receivedAt = new Date();
  const url = new URL(req.url, "http://localhost");
  const body = await readJsonBody(req);
  const waitSeconds = resolveWaitSeconds(url, body);
  const waitedMs = Math.round(waitSeconds * MS_PER_SECOND);

  await wait(waitedMs);

  const respondedAt = new Date();
  console.log(
    `${LOG_PREFIX} received_at=${receivedAt.toISOString()} wait_seconds=${waitSeconds} waited_ms=${waitedMs} responded_at=${respondedAt.toISOString()}`,
  );
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      wait_seconds: waitSeconds,
      waited_ms: waitedMs,
      received_at: receivedAt.toISOString(),
      responded_at: respondedAt.toISOString(),
    }),
  );
}

// Startet den Server auf dem uebergebenen Port (0 = zufaelliger freier Port -
// so ruft der Test ihn ohne Portkollision auf). Gibt {url, close} zurueck.
export async function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error(`${LOG_PREFIX} Fehler: ${err.message}`);
      res.writeHead(HTTP_SERVER_ERROR, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
  });
  await new Promise((settle) => server.listen(port, "127.0.0.1", settle));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((settle) => server.close(settle)) };
}

async function main() {
  const portArg = Number(process.argv[2]);
  const port = Number.isFinite(portArg) && portArg > 0 ? portArg : DEFAULT_PORT;
  const { url } = await startServer(port);
  console.log(
    `${LOG_PREFIX} laeuft auf ${url} (Standard-Wartezeit ${DEFAULT_WAIT_SECONDS}s, Obergrenze ${MAX_WAIT_SECONDS}s)`,
  );
}

const isMain = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (isMain) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} Fehler: ${err.message}`);
    process.exit(1);
  });
}
