import { setTimeout as warten } from "node:timers/promises";

import { loeschAnfrage, postgresLesen, postgresListe, zugriffslisteAnfrage } from "./render.mjs";

const KOPIE_NAME = /^hermes-wiederherstellung-\d+-\d+$/;
const HTTP_OK = 200;
const HTTP_KEIN_INHALT = 204;
const HTTP_NICHT_GEFUNDEN = 404;
const LOESCHEN_TAKTE = 30;
const ZUGANG_BESCHREIBUNG = "GitHub-Runner Wiederherstellung";

const geprueft = new WeakSet();

export class LoeschenVerweigert extends Error {
  constructor() {
    super("Löschen verweigert");
    this.name = "LoeschenVerweigert";
  }
}

export function istEigeneKopie(objekt, einstellungen) {
  return (
    typeof objekt?.id === "string" &&
    objekt.id !== einstellungen.produktionId &&
    objekt.environmentId === einstellungen.umgebung &&
    typeof objekt.name === "string" &&
    KOPIE_NAME.test(objekt.name)
  );
}

export async function eigeneKopieLesen(zugang, id, einstellungen) {
  const { status, daten } = await postgresLesen(zugang, id);
  if (status !== HTTP_OK || daten?.id !== id || !istEigeneKopie(daten, einstellungen)) {
    return { status, kopie: null };
  }
  const kopie = Object.freeze({ id: daten.id, name: daten.name });
  geprueft.add(kopie);
  return { status, kopie };
}

export async function eigeneKopieSuchen(zugang, einstellungen, name) {
  const filter = { environmentId: einstellungen.umgebung, name };
  const { eintraege } = await postgresListe(zugang, filter);
  for (const eintrag of eintraege ?? []) {
    if (eintrag.name !== name || !istEigeneKopie(eintrag, einstellungen)) continue;
    const { kopie } = await eigeneKopieLesen(zugang, eintrag.id, einstellungen);
    if (kopie !== null) return kopie;
  }
  return null;
}

function nurGeprueft(kopie) {
  if (!geprueft.has(kopie)) throw new LoeschenVerweigert();
}

export async function kopieZugangSetzen(zugang, kopie, cidr) {
  nurGeprueft(kopie);
  const eintraege = [{ cidrBlock: cidr, description: ZUGANG_BESCHREIBUNG }];
  const { status, daten } = await zugriffslisteAnfrage(zugang, kopie.id, eintraege);
  const liste = daten?.ipAllowList;
  const genau = Array.isArray(liste) && liste.length === 1 && liste[0]?.cidrBlock === cidr;
  return { status, genau };
}

async function verschwunden(zugang, id, takt) {
  const frist = Date.now() + LOESCHEN_TAKTE * takt;
  for (;;) {
    const { status } = await postgresLesen(zugang, id);
    if (status === HTTP_NICHT_GEFUNDEN) return true;
    if (Date.now() >= frist) return false;
    await warten(takt);
  }
}

export async function eigeneKopieLoeschen(zugang, kopie, { einstellungen, takt }) {
  nurGeprueft(kopie);
  const frisch = await eigeneKopieLesen(zugang, kopie.id, einstellungen);
  if (frisch.status === HTTP_NICHT_GEFUNDEN) return { geloescht: true, status: frisch.status };
  if (frisch.status !== HTTP_OK) return { geloescht: false, status: frisch.status };
  if (frisch.kopie === null) throw new LoeschenVerweigert();
  const { status } = await loeschAnfrage(zugang, frisch.kopie.id);
  if (status !== HTTP_KEIN_INHALT) return { geloescht: false, status };
  return { geloescht: await verschwunden(zugang, frisch.kopie.id, takt), status };
}

async function eintragAufraeumen(zugang, eintrag, rahmen) {
  if (!istEigeneKopie(eintrag, rahmen.einstellungen)) return { art: "fremd" };
  const { status, kopie } = await eigeneKopieLesen(zugang, eintrag.id, rahmen.einstellungen);
  if (status === HTTP_NICHT_GEFUNDEN) return { art: "weg" };
  if (status !== HTTP_OK) return { art: "fehler", status };
  if (kopie === null) return { art: "fremd" };
  const ergebnis = await eigeneKopieLoeschen(zugang, kopie, rahmen);
  return { art: ergebnis.geloescht ? "geloescht" : "fehler", status: ergebnis.status };
}

export async function uebrigeKopienLoeschen(zugang, rahmen) {
  const filter = { environmentId: rahmen.einstellungen.umgebung };
  const { status, eintraege } = await postgresListe(zugang, filter);
  if (eintraege === null) return { status, zaehler: null, fehlerStatus: [] };
  const ergebnisse = [];
  for (const eintrag of eintraege)
    ergebnisse.push(await eintragAufraeumen(zugang, eintrag, rahmen));
  const von = (art) => ergebnisse.filter((ergebnis) => ergebnis.art === art);
  return {
    status,
    zaehler: {
      geloescht: von("geloescht").length,
      fremd: von("fremd").length,
      fehler: von("fehler").length,
    },
    fehlerStatus: von("fehler").map((ergebnis) => ergebnis.status),
  };
}
