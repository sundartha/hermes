import { isIPv4 } from "node:net";

const ANFRAGE_FRIST_MS = 15000;
const JSON_TYP = "application/json";
const HTTP_OK = 200;
const HTTP_ERFOLG_BIS = 300;
const HTTP_KEIN_INHALT = 204;
const SEITEN_GROESSE = 100;
const HOECHSTENS_SEITEN = 50;
const IPV4_FORM = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function renderZugang({ apiUrl, schluessel }) {
  return Object.freeze({ apiUrl, schluessel });
}

function postgresPfad(id, rest = "") {
  return "/postgres/" + encodeURIComponent(id) + rest;
}

async function anfrage(zugang, { methode = "GET", pfad, koerper }) {
  const headers = { Authorization: "Bearer " + zugang.schluessel, accept: JSON_TYP };
  if (koerper !== undefined) headers["content-type"] = JSON_TYP;
  const antwort = await fetch(zugang.apiUrl + pfad, {
    method: methode,
    headers,
    body: koerper === undefined ? undefined : JSON.stringify(koerper),
    redirect: "error",
    signal: AbortSignal.timeout(ANFRAGE_FRIST_MS),
  });
  const { status } = antwort;
  if (status === HTTP_KEIN_INHALT || status < HTTP_OK || status >= HTTP_ERFOLG_BIS) {
    await antwort.body?.cancel();
    return { status, daten: null };
  }
  return { status, daten: await antwort.json() };
}

export function postgresLesen(zugang, id) {
  return anfrage(zugang, { pfad: postgresPfad(id) });
}

export function rueckblickLesen(zugang, id) {
  return anfrage(zugang, { pfad: postgresPfad(id, "/recovery") });
}

export function wiederherstellen(zugang, id, koerper) {
  return anfrage(zugang, { methode: "POST", pfad: postgresPfad(id, "/recovery"), koerper });
}

export function verbindungsdatenLesen(zugang, id) {
  return anfrage(zugang, { pfad: postgresPfad(id, "/connection-info") });
}

export function zugriffslisteAnfrage(zugang, id, eintraege) {
  return anfrage(zugang, {
    methode: "PATCH",
    pfad: postgresPfad(id),
    koerper: { ipAllowList: eintraege },
  });
}

export function loeschAnfrage(zugang, id) {
  return anfrage(zugang, { methode: "DELETE", pfad: postgresPfad(id) });
}

function seitenPfad(filter, cursor) {
  const parameter = new URLSearchParams({ ...filter, limit: String(SEITEN_GROESSE) });
  if (cursor !== null) parameter.set("cursor", cursor);
  return "/postgres?" + parameter.toString();
}

export async function postgresListe(zugang, filter) {
  const eintraege = [];
  let cursor = null;
  for (let seite = 0; seite < HOECHSTENS_SEITEN; seite += 1) {
    const { status, daten } = await anfrage(zugang, { pfad: seitenPfad(filter, cursor) });
    if (status !== HTTP_OK || !Array.isArray(daten)) return { status, eintraege: null };
    eintraege.push(...daten.map((eintrag) => eintrag?.postgres).filter(Boolean));
    cursor = daten.at(-1)?.cursor;
    if (daten.length < SEITEN_GROESSE || typeof cursor !== "string") return { status, eintraege };
  }
  return { status: HTTP_OK, eintraege: null };
}

export async function eigeneAdresse(url) {
  const antwort = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(ANFRAGE_FRIST_MS),
  });
  if (antwort.status !== HTTP_OK) {
    await antwort.body?.cancel();
    return null;
  }
  const text = (await antwort.text()).trim();
  return IPV4_FORM.test(text) && isIPv4(text) ? text : null;
}
