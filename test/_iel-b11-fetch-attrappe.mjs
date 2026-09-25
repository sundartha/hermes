// IEL-B11: Fetch-Attrappe fuer den ECHTEN (nicht --dry-run) Modus von scripts/iel-mess.mjs im
// Kindprozess. Wird per "--import" geladen, BEVOR das Skript importiert wird - ESM wertet
// Importe in Reihenfolge aus, der Ersatz von globalThis.fetch ist also scharf, bevor
// src/config.js oder ein Anbieter-Modul geladen wird.
//
// Szenario (JSON in IEL_B11_ATTRAPPE): { routen: [{ methode, muster, status, koerper }] },
// wobei "muster" ein RegExp-String auf pathname+search ist. Unbekannte Route -> 404 {}.
// Protokoll ({methode, pfad, koerper} je Aufruf) landet beim Prozessende in IEL_B11_PROTOKOLL.

import { writeFileSync } from "node:fs";

const SZENARIO_ENV = "IEL_B11_ATTRAPPE";
const PROTOKOLL_ENV = "IEL_B11_PROTOKOLL";
const HTTP_NOT_FOUND = 404;
const HTTP_OK_MAX = 299;
const HTTP_OK_MIN = 200;

const szenario = JSON.parse(process.env[SZENARIO_ENV] || "{}");
const routen = (szenario.routen ?? []).map((route) => ({ ...route, regex: new RegExp(route.muster) }));
const protokoll = [];

function koerperVon(init) {
  if (!init?.body) return null;
  if (typeof init.body !== "string") return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

function passendeRoute(methode, pfad) {
  return routen.find((route) => (!route.methode || route.methode === methode) && route.regex.test(pfad));
}

globalThis.fetch = async (adresse, init = {}) => {
  const url = new URL(String(adresse));
  const methode = init.method ?? "GET";
  const pfad = `${url.pathname}${url.search}`;
  const koerper = koerperVon(init);
  protokoll.push({ methode, pfad, koerper });
  const route = passendeRoute(methode, pfad);
  const status = route?.status ?? HTTP_NOT_FOUND;
  const antwortKoerper = route?.koerper ?? {};
  return {
    ok: status >= HTTP_OK_MIN && status <= HTTP_OK_MAX,
    status,
    json: async () => structuredClone(antwortKoerper),
    text: async () => JSON.stringify(antwortKoerper),
  };
};

process.on("exit", () => {
  const pfad = process.env[PROTOKOLL_ENV];
  if (!pfad) return;
  // Synchron: "exit" laesst keine asynchrone I/O mehr zu.
  writeFileSync(pfad, JSON.stringify(protokoll));
});
