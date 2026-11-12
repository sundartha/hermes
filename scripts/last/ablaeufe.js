import http from "k6/http";
import exec from "k6/execution";
import { sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

import { baueErgebnis, ROUTEN_BUDGET_MS } from "./ergebnis.js";

const UMGEBUNG = globalThis.__ENV;
const konfig = JSON.parse(globalThis.open(UMGEBUNG.LAST_KONFIG));
const HTTP_OK = 200;
const HTTP_WEITERLEITUNG = 302;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const ANRUF_FRIST_MS = 90000;
const TAKT_S = 0.5;
const ENDSTATUS = ["completed", "failed", "cancelled", "no_answer", "busy"];
const ZIEL_VORWAHL = "+49151";
const LAUFNUMMER_STELLEN = 6;
const FORMULAR = { "Content-Type": "application/x-www-form-urlencoded" };
const JSON_KOPF = { "Content-Type": "application/json" };

const ablaufFehler = new Counter("ablauf_fehler");
const gestartet = new Counter("anrufe_gestartet");
const beendet = new Counter("anrufe_beendet");
const wartezeit = new Trend("anruf_wartezeit", true);
const routen = Object.fromEntries(Object.keys(ROUTEN_BUDGET_MS).map((name) => [name, new Trend(name, true)]));

export const options = {
  scenarios: {
    mcp_anmeldung: { executor: "constant-vus", vus: 2, duration: "10s", exec: "mcpAnmeldung" },
    anruf: { executor: "per-vu-iterations", vus: 3, iterations: 3, maxDuration: "120s", exec: "anruf" },
    webhooks: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "10s",
      preAllocatedVUs: 5,
      exec: "webhooks",
    },
    app_login: { executor: "per-vu-iterations", vus: 2, iterations: 5, maxDuration: "60s", exec: "appLogin" },
  },
};

export function setup() {
  ablaufFehler.add(0);
  gestartet.add(0);
  beendet.add(0);
}

function senden({ route, methode = "POST", url, koerper = null, kopf, erwartet }) {
  const antwort = http.request(methode, url, koerper, {
    headers: kopf,
    redirects: 0,
    responseCallback: http.expectedStatuses(erwartet),
  });
  routen[route].add(antwort.timings.duration);
  return antwort;
}

function leseRpc(antwort) {
  const text = String(antwort.body).trim();
  const datenzeile = text.split(/\r?\n/).find((zeile) => zeile.startsWith("data:")) || "";
  const roh = text.startsWith("{") ? text : datenzeile.slice("data:".length).trim();
  return roh ? JSON.parse(roh) : null;
}

function mcp({ route, ziel, token, nachricht }) {
  const kopf = { ...JSON_KOPF, Accept: "application/json, text/event-stream" };
  if (token) kopf.Authorization = `Bearer ${token}`;
  const erwartet = token ? HTTP_OK : HTTP_UNAUTHORIZED;
  return senden({ route, url: `${ziel}/mcp`, koerper: JSON.stringify(nachricht), kopf, erwartet });
}

function werkzeugErgebnis({ route, ziel, token, name, argumente }) {
  const nachricht = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: argumente } };
  const antwort = mcp({ route, ziel, token, nachricht });
  const rpc = antwort.status === HTTP_OK ? leseRpc(antwort) : null;
  const ergebnis = rpc ? rpc.result : null;
  if (!ergebnis || ergebnis.isError) {
    ablaufFehler.add(1);
    return undefined;
  }
  return ergebnis.structuredContent;
}

export function mcpAnmeldung() {
  const ziel = konfig.ziele[exec.scenario.iterationInTest % konfig.ziele.length];
  const route = "route_mcp_anmeldung";
  const ohne = mcp({ route, ziel, token: "", nachricht: { jsonrpc: "2.0", id: 1, method: "initialize" } });
  if (ohne.status !== HTTP_UNAUTHORIZED) ablaufFehler.add(1);
  const mit = mcp({ route, ziel, token: konfig.tokens[0], nachricht: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
  const antwort = mit.status === HTTP_OK ? leseRpc(mit) : null;
  if (!antwort || !antwort.result || !antwort.result.tools) ablaufFehler.add(1);
  sleep(TAKT_S);
}

function warteBisEnde({ ziel, token, anrufId, beginn }) {
  let gemessen = false;
  while (Date.now() - beginn < ANRUF_FRIST_MS) {
    const argumente = { call_id: anrufId };
    const stand = werkzeugErgebnis({ route: "route_anruf_status", ziel, token, name: "get_call_status", argumente });
    if (stand && !gemessen && stand.status !== "dialing") {
      wartezeit.add(Date.now() - beginn);
      gemessen = true;
    }
    if (stand && ENDSTATUS.includes(stand.status)) return stand.status;
    sleep(TAKT_S);
  }
  return "frist";
}

export function anruf() {
  const nummer = exec.vu.idInTest;
  const lauf = exec.vu.iterationInScenario;
  const ziel = konfig.ziele[(nummer + lauf) % konfig.ziele.length];
  const token = konfig.tokens[(nummer - 1) % konfig.tokens.length];
  const beginn = Date.now();
  const to = `${ZIEL_VORWAHL}${nummer}${String(lauf).padStart(LAUFNUMMER_STELLEN, "0")}`;
  const argumente = { to, objective: `Lastlauf Auftrag ${to}` };
  const angelegt = werkzeugErgebnis({ route: "route_place_call", ziel, token, name: "place_call", argumente });
  if (!angelegt) return;
  gestartet.add(1);
  const anrufId = angelegt.call_id;
  const ende = warteBisEnde({ ziel, token, anrufId, beginn });
  const abfrage = { route: "route_anruf_ergebnis", ziel, token, name: "get_call_result", argumente: { call_id: anrufId } };
  const ergebnis = werkzeugErgebnis(abfrage);
  if (ende === "completed" && ergebnis) beendet.add(1);
}

function telnyx(ziel, webhook, erwartet) {
  const kopf = { ...FORMULAR, ...webhook.kopf };
  const url = `${ziel}/voice/status`;
  return senden({ route: "route_webhook_telnyx", url, koerper: webhook.koerper, kopf, erwartet });
}

export function webhooks() {
  const nummer = exec.scenario.iterationInTest;
  const ziel = konfig.ziele[nummer % konfig.ziele.length];
  const gueltig = konfig.webhooks.gueltig;
  const ungueltig = konfig.webhooks.ungueltig;
  const angenommen = telnyx(ziel, gueltig[nummer % gueltig.length], HTTP_OK);
  const abgelehnt = telnyx(ziel, ungueltig[nummer % ungueltig.length], HTTP_FORBIDDEN);
  const kopf = { ...JSON_KOPF, "x-hermes-tool-token": konfig.werkzeugToken };
  const url = `${ziel}/webhooks/elevenlabs/consult`;
  senden({ route: "route_webhook_elevenlabs", url, koerper: "{}", kopf, erwartet: HTTP_NOT_FOUND });
  if (angenommen.status !== HTTP_OK || abgelehnt.status !== HTTP_FORBIDDEN) ablaufFehler.add(1);
}

function sitzungsKopf(antwort) {
  const cookie = Object.entries(antwort.cookies).map(([name, werte]) => `${name}=${werte[0].value}`);
  return { Cookie: cookie.join("; ") };
}

export function appLogin() {
  const ziel = konfig.ziele[exec.scenario.iterationInTest % konfig.ziele.length];
  const route = "route_app_login";
  const koerper = JSON.stringify({ sub: konfig.appSub, email: konfig.appEmail });
  const login = senden({ route, url: `${ziel}/auth/dev-login`, koerper, kopf: JSON_KOPF, erwartet: HTTP_WEITERLEITUNG });
  const url = `${ziel}/api/self-service/state`;
  const stand = senden({ route, methode: "GET", url, kopf: sitzungsKopf(login), erwartet: HTTP_OK });
  if (login.status !== HTTP_WEITERLEITUNG || stand.status !== HTTP_OK) ablaufFehler.add(1);
}

export function handleSummary(daten) {
  return { [UMGEBUNG.LAST_ERGEBNIS]: JSON.stringify(baueErgebnis(daten)) };
}
