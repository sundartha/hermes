import assert from "node:assert/strict";
import express from "express";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { mitRoutenServer } from "../anrufe/routen-server.js";

export const STATUS_PATH = "/intern/status";
export const ANRUFE_LAUFEND_PATH = "/intern/anrufe-laufend";
export const ANRUFPAUSE_PATH = "/intern/anrufpause";
export const SCHLUESSEL_MINDESTLAENGE = 32;
export const HTTP_OK = 200;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_INTERNAL_SERVER_ERROR = 500;
export const HTTP_SERVICE_UNAVAILABLE = 503;
export const SCHLUESSEL = "s".repeat(SCHLUESSEL_MINDESTLAENGE);
export const DEPLOY_TOKEN = "d".repeat(SCHLUESSEL_MINDESTLAENGE);
export const FALSCHER_SCHLUESSEL = "x".repeat(SCHLUESSEL_MINDESTLAENGE);
export const ZU_KURZ = "s".repeat(SCHLUESSEL_MINDESTLAENGE - 1);
export const COMMIT = "b2c0ffee";
export const KURZE_FRIST_MS = 5;
export const STANDARD_FRIST_MS = 2000;
export const FRIST_UNSCHAERFE_MS = 10;
export const ABRUFE_PRO_MINUTE = 30;
export const MEHRERE_ABRUFE = 3;
export const FEHLERDETAIL = "verbindung_b2_geheim_kaputt";
export const KEIN_ZWISCHENSPEICHER = "no-store";
export const ABGELEHNT = Object.freeze({ error: "unauthorized" });
export const AUDIT_ABGELEHNT = "[audit] auth_failed";
export const STANDIN_NAMEN = [
  "callFinish lifecycle provisioning outboundGates callQuotaDenial requestTenant requireTenant",
  "conversationWatchdog ttsStore directiveSynth voiceRender costTruing messaging consultDelivery",
  "elevenLabsOutbound inboundBridges durableAuditFor",
].flatMap((zeile) => zeile.split(" "));

export const standIn = new Proxy(function standIn() {}, {
  get: (_ziel, schluessel) => (schluessel === "then" ? undefined : standIn),
  apply: () => standIn,
});

export function konfiguration(statusToken = SCHLUESSEL) {
  return { auth: { statusToken, deployToken: DEPLOY_TOKEN }, server: { deployedCommit: COMMIT } };
}

export const bearer = (schluessel) => `Bearer ${schluessel}`;

export async function abrufen(
  basis,
  { pfad = STATUS_PATH, authorization = bearer(SCHLUESSEL), koerper } = {},
) {
  const headers = authorization === null ? {} : { authorization };
  const anfrage = { headers };
  if (koerper !== undefined) {
    Object.assign(headers, { "content-type": "application/json" });
    Object.assign(anfrage, { method: "POST", body: JSON.stringify(koerper) });
  }
  const antwort = await abrufMitFrist(`${basis}${pfad}`, anfrage);
  return {
    status: antwort.status,
    kopf: antwort.headers.get("cache-control"),
    text: await antwort.text(),
    gesendet: headers,
  };
}

export async function abrufeNacheinander(basis, anzahl, optionen) {
  const antworten = [];
  for (let nr = 0; nr < anzahl; nr += 1) antworten.push(await abrufen(basis, optionen));
  return antworten;
}

export async function mitStatusroute({ speicher, makeInternStatusRoutes }, einstellung, aufruf) {
  const empfangen = [];
  const router = express.Router();
  router.use((req, _res, weiter) => {
    empfangen.push(req.headers.authorization);
    weiter();
  });
  router.use(
    makeInternStatusRoutes({
      config: einstellung.config ?? konfiguration(),
      store: speicher,
      datenbankFristMs: KURZE_FRIST_MS,
      ...einstellung.routenOptionen,
    }),
  );
  const ergebnis = await mitRoutenServer(router, aufruf);
  return { ergebnis, empfangen };
}

export async function mitApp({ config, speicher, buildApp }, aufruf) {
  const abhaengigkeiten = {
    ...Object.fromEntries(STANDIN_NAMEN.map((name) => [name, standIn])),
    config,
    store: speicher,
    audit: () => {},
  };
  const { app } = await buildApp(abhaengigkeiten);
  return mitRoutenServer(app, aufruf);
}

export async function mitProtokoll(arbeit) {
  const zeilen = [];
  const { log, warn, error } = console;
  console.log = (...teile) => zeilen.push(teile.join(" "));
  console.warn = console.error = () => {};
  try {
    return { ergebnis: await arbeit(), zeilen };
  } finally {
    Object.assign(console, { log, warn, error });
  }
}

export async function stumm(arbeit) {
  const { ergebnis } = await mitProtokoll(arbeit);
  return ergebnis;
}

export function abgelehnteAuditZeilen(zeilen, pfad, grund) {
  const muster = new RegExp(`path=${pfad} grund=${grund}$`);
  return zeilen.filter((zeile) => zeile.startsWith(AUDIT_ABGELEHNT) && muster.test(zeile));
}

export function pruefeAbgelehnt(antwort) {
  assert.equal(antwort.status, HTTP_UNAUTHORIZED);
  assert.equal(antwort.kopf, KEIN_ZWISCHENSPEICHER);
  assert.deepEqual(JSON.parse(antwort.text), ABGELEHNT);
}
