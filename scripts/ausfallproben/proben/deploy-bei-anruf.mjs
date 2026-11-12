import { lokaleDatenbank } from "../datenbank.mjs";
import { warteBereit } from "../hermes-kind.mjs";
import { baueAuf } from "./postgres-neustart.mjs";

const SIGNAL = "SIGTERM";
const FLUSH_ZEILE = "[shutdown] Finaler Store-Flush abgeschlossen";
const HTTP_UMLEITUNG = 302;
const EXIT_OK = 0;
const warte = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rot(schwelle, grund, extra = {}) {
  return { ergebnis: "rot", schwelle: schwelle.beendetMs, gemessen: null, grund, ...extra };
}

export function bewerteAbschaltung({ exitCode, text, dauerMs, schwelle }) {
  if (dauerMs === null || dauerMs > schwelle.beendetMs)
    return `Hermes beendete sich nicht binnen ${schwelle.beendetMs} ms nach ${SIGNAL}`;
  if (exitCode !== EXIT_OK) return "Hermes beendete sich nicht mit Exit 0";
  if (!text.includes(FLUSH_ZEILE)) return "Die Zeile mit dem abgeschlossenen Store-Flush fehlt";
  return null;
}

async function halteAnfrageOffen(url) {
  const einstieg = await fetch(`${url}/auth/login`, { redirect: "manual" });
  if (einstieg.status !== HTTP_UMLEITUNG) return false;
  const { headers } = einstieg;
  const cookies = headers
    .getSetCookie()
    .map((kopf) => kopf.split(";")[0])
    .join("; ");
  const state = new URL(headers.get("location")).searchParams.get("state");
  fetch(`${url}/auth/callback?code=ausfallprobe&state=${encodeURIComponent(state)}`, {
    headers: { cookie: cookies },
  }).catch(() => {});
  return true;
}

async function warteAufAufruf(anbieter, schwelle) {
  const frist = Date.now() + schwelle.anfrageFristMs;
  while (Date.now() < frist && anbieter.gesehen.length === 0) await warte(schwelle.messTaktMs);
  return anbieter.gesehen.length > 0;
}

async function wartebisBeendet(kind, schwelle) {
  const start = performance.now();
  let uhr;
  const frist = new Promise((resolve) => {
    uhr = setTimeout(() => resolve(null), schwelle.beendetMs);
  });
  const ende = await Promise.race([kind.beendet.then(() => performance.now() - start), frist]);
  clearTimeout(uhr);
  return ende === null ? null : Math.round(ende);
}

export async function deployBeiAnruf(kontext, SCHWELLE) {
  if (!kontext.postgresUrl) return rot(SCHWELLE, "HERMES_TEST_POSTGRES_URL fehlt");
  const url = lokaleDatenbank(kontext.postgresUrl);
  if (!url) return rot(SCHWELLE, "Postgres ist nicht lokal (nur 127.0.0.1 oder localhost)");
  const { kind, anbieter } = await baueAuf(kontext, url, { mitRolle: true });
  if (!(await warteBereit(kind))) return rot(SCHWELLE, "Hermes wurde nicht bereit");
  anbieter.setzeVerzug(SCHWELLE.anbieterHaltenMs);
  if (!(await halteAnfrageOffen(kind.url)))
    return rot(SCHWELLE, "Der Login-Einstieg antwortete nicht mit einer Umleitung");
  if (!(await warteAufAufruf(anbieter, SCHWELLE)))
    return rot(SCHWELLE, "Die Weiche sah keinen Anbieter-Aufruf der offenen Anfrage");
  kind.prozess.kill(SIGNAL);
  const dauerMs = await wartebisBeendet(kind, SCHWELLE);
  const beleg = {
    beleg: {
      signal: SIGNAL,
      exitCode: kind.prozess.exitCode,
      gehalteneAufrufe: anbieter.gesehen.length,
    },
  };
  const grund = bewerteAbschaltung({
    exitCode: kind.prozess.exitCode,
    text: kind.ausgabe.text,
    dauerMs,
    schwelle: SCHWELLE,
  });
  if (grund) return rot(SCHWELLE, grund, beleg);
  return {
    ergebnis: "gruen",
    schwelle: SCHWELLE.beendetMs,
    gemessen: dauerMs,
    grund: "Hermes beendete sich bei offener Anfrage mit Exit 0 und schrieb den Store-Flush",
    ...beleg,
  };
}
