import { argv, env } from "node:process";
import { setTimeout as warten } from "node:timers/promises";

import {
  Abbruch,
  AusgabeVerweigert,
  berichteHermes,
  berichteNachher,
  berichteVorher,
  fehlercode,
  maskiere,
  melde,
  tabellenErlauben,
} from "./wiederherstellung/ausgabe.mjs";
import {
  eigeneKopieLesen,
  eigeneKopieLoeschen,
  eigeneKopieSuchen,
  kopieZugangSetzen,
  LoeschenVerweigert,
  uebrigeKopienLoeschen,
} from "./wiederherstellung/eigentum.mjs";
import {
  einstellungenLesen,
  minutenZwischen,
  zeitpunktBerechnen,
} from "./wiederherstellung/einstellungen.mjs";
import { hermesPruefen } from "./wiederherstellung/hermes.mjs";
import {
  erwartetesSchema,
  pruefenNachDemEnde,
  pruefenVorDemStart,
} from "./wiederherstellung/pruefungen.mjs";
import {
  eigeneAdresse,
  postgresLesen,
  renderZugang,
  rueckblickLesen,
  verbindungsdatenLesen,
  wiederherstellen,
} from "./wiederherstellung/render.mjs";
import {
  mitClient,
  tunnelOeffnen,
  tunnelUrl,
  verbindungVersuchen,
  verbindungZerlegen,
} from "./wiederherstellung/tunnel.mjs";

const HTTP_OK = 200;
const HTTP_ANGELEGT = 201;
const HTTP_KEIN_INHALT = 204;
const HTTP_NICHT_GEFUNDEN = 404;
const HTTP_ZU_VIELE = 429;
const HTTP_SERVERFEHLER = 500;
const LOESCH_STATUS = new Set([HTTP_KEIN_INHALT, HTTP_NICHT_GEFUNDEN]);
const BEREIT_TAKTE = 180;
const ZUGANG_TAKTE = 15;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const ENDE_FRIST_MS = 5000;
const BEFEHL_ARGUMENTE = 3;

const lauf = { schritt: "einstellungen", ok: true, signal: false };
const steuerung = new AbortController();

function schritt(name) {
  lauf.schritt = name;
}

function bilanz(ok) {
  if (!ok) lauf.ok = false;
}

function pruefzeile(schluessel, werte, ok) {
  melde(schluessel, werte);
  bilanz(ok);
}

function ruhe(ms) {
  return warten(ms, undefined, { signal: steuerung.signal });
}

function alsAbbruch(fehler) {
  if (fehler instanceof Abbruch || fehler instanceof AusgabeVerweigert) return fehler;
  if (fehler instanceof LoeschenVerweigert) return fehler;
  return new Abbruch(lauf.schritt, { code: fehlercode(fehler)?.text ?? null });
}

function abbruchMelden({ schritt: wo, status, code }) {
  const text = fehlercode(code);
  if (status !== null) melde("abbruch_http", { schritt: wo, status });
  else if (text === null) melde("abbruch", { schritt: wo });
  else melde("abbruch_code", { schritt: wo, code: text });
}

function fehlerMelden(fehler) {
  lauf.ok = false;
  try {
    if (fehler instanceof AusgabeVerweigert) melde("ausgabe_verweigert");
    else if (fehler instanceof LoeschenVerweigert) melde("loeschen_verweigert");
    else abbruchMelden(alsAbbruch(fehler));
  } catch {
    melde("ausgabe_verweigert");
  }
}

async function produktionPruefen({ zugang, einstellungen }) {
  schritt("produktion");
  const { status, daten } = await postgresLesen(zugang, einstellungen.produktionId);
  if (status !== HTTP_OK) throw new Abbruch("produktion", { status });
  if (daten?.id !== einstellungen.produktionId) throw new Abbruch("produktion");
  if (typeof daten.environmentId !== "string" || daten.environmentId === einstellungen.umgebung) {
    melde("produktion_im_kopien_environment");
    throw new Abbruch("produktion");
  }
}

function statusWort(wert) {
  return typeof wert === "string" ? wert : "unknown";
}

async function zeitpunktBestimmen({ zugang, einstellungen }) {
  schritt("rueckblick");
  const { status, daten } = await rueckblickLesen(zugang, einstellungen.produktionId);
  if (status !== HTTP_OK) throw new Abbruch("rueckblick", { status });
  if (daten?.recoveryStatus !== "AVAILABLE") {
    melde("rueckblick_status", { status: statusWort(daten?.recoveryStatus) });
    throw new Abbruch("rueckblick");
  }
  const jetzt = Date.now();
  const { zeitpunkt, fehlend } = zeitpunktBerechnen(jetzt, Date.parse(daten.startsAt));
  if (zeitpunkt === null) {
    if (fehlend === null) melde("rueckblick_unbekannt");
    else melde("rueckblick_zu_kurz", { minuten: fehlend });
    throw new Abbruch("rueckblick");
  }
  melde("zeitpunkt", { minuten: minutenZwischen(zeitpunkt, jetzt) });
  return zeitpunkt;
}

async function wiederherstellungAusloesen({ zugang, einstellungen }, zeitpunkt) {
  schritt("wiederherstellen");
  const koerper = {
    restoreTime: new Date(zeitpunkt).toISOString(),
    restoreName: einstellungen.kopieName,
    environmentId: einstellungen.umgebung,
    datadogApiKey: "",
  };
  steuerung.signal.throwIfAborted();
  const { status, daten } = await wiederherstellen(zugang, einstellungen.produktionId, koerper);
  if (status !== HTTP_OK && status !== HTTP_ANGELEGT)
    throw new Abbruch("wiederherstellen", { status });
  melde("ausgeloest");
  return daten;
}

async function kopieFestlegen({ zugang, einstellungen }, antwort) {
  schritt("kopie");
  const name = einstellungen.kopieName;
  const direkt = antwort?.id !== einstellungen.produktionId && antwort?.name === name;
  if (direkt && typeof antwort.id === "string") {
    const { kopie } = await eigeneKopieLesen(zugang, antwort.id, einstellungen);
    if (kopie?.name === name) return kopie;
  }
  const kopie = await eigeneKopieSuchen(zugang, einstellungen, name);
  melde("kopie_gesucht", { gefunden: kopie !== null });
  return kopie;
}

async function kopieZustand({ zugang }, kopie) {
  const { status, daten } = await postgresLesen(zugang, kopie.id);
  if (status === HTTP_OK) return statusWort(daten?.status);
  if (status === HTTP_ZU_VIELE || status >= HTTP_SERVERFEHLER) return null;
  throw new Abbruch("bereit", { status });
}

async function bereitAbwarten(kontext, kopie) {
  schritt("bereit");
  const start = Date.now();
  const frist = start + BEREIT_TAKTE * kontext.takt;
  let bisher = null;
  for (;;) {
    const zustand = await kopieZustand(kontext, kopie);
    if (zustand !== null && zustand !== bisher) melde("kopie_status", { status: zustand });
    bisher = zustand ?? bisher;
    if (zustand === "available") {
      melde("bereit", { minuten: minutenZwischen(start, Date.now()) });
      return;
    }
    if (zustand === "recovery_failed") {
      melde("wiederherstellung_gescheitert");
      throw new Abbruch("bereit");
    }
    if (Date.now() >= frist) throw new Abbruch("bereit", { code: "FRIST" });
    await ruhe(kontext.takt);
  }
}

async function zugangSetzen({ zugang, einstellungen }, kopie) {
  schritt("adresse");
  const adresse = await eigeneAdresse(einstellungen.ipUrl);
  if (adresse === null) throw new Abbruch("adresse");
  maskiere([adresse]);
  schritt("zugang");
  const { status, genau } = await kopieZugangSetzen(zugang, kopie, adresse + "/32");
  if (status !== HTTP_OK) throw new Abbruch("zugang", { status });
  pruefzeile("zugang", { ok: genau }, genau);
  if (!genau) throw new Abbruch("zugang");
}

async function verbindungsdatenHolen({ zugang }, kopie) {
  schritt("verbindungsdaten");
  const { status, daten } = await verbindungsdatenLesen(zugang, kopie.id);
  if (status !== HTTP_OK) throw new Abbruch("verbindungsdaten", { status });
  maskiere([daten?.externalConnectionString, daten?.password]);
  const verbindung = verbindungZerlegen(daten?.externalConnectionString);
  if (verbindung === null) throw new Abbruch("verbindungsdaten");
  const { host, port } = verbindung.server;
  maskiere([
    verbindung.passwort,
    verbindung.passwortRoh,
    verbindung.benutzer,
    verbindung.datenbank,
    host,
    host + ":" + port,
  ]);
  return verbindung;
}

async function verbindungAbwarten({ takt }, tunnel, lokal) {
  const frist = Date.now() + ZUGANG_TAKTE * takt;
  for (;;) {
    const fehler = await verbindungVersuchen(tunnel, lokal);
    if (fehler === null) {
      melde("verbindung", { ok: true });
      return;
    }
    if (!fehler.wiederholen || Date.now() >= frist) {
      pruefzeile("verbindung", { ok: false }, false);
      throw new Abbruch(fehler.wo, { code: fehler.code });
    }
    await ruhe(takt);
  }
}

async function datenPruefen({ takt, einstellungen }, lokal, zeitpunkt) {
  schritt("schema");
  const erwartet = await erwartetesSchema();
  tabellenErlauben([...erwartet.keys()]);
  schritt("pruefungen");
  const vorher = await mitClient(lokal, (client) =>
    pruefenVorDemStart(client, { zeitpunkt, erwartet }),
  );
  bilanz(berichteVorher(vorher));
  schritt("hermes");
  const rahmen = { datenbankUrl: tunnelUrl(lokal), takt, commit: einstellungen.commit };
  bilanz(berichteHermes(await hermesPruefen({ ...rahmen, signal: steuerung.signal })));
  steuerung.signal.throwIfAborted();
  schritt("pruefungen");
  const mengenVorher = vorher.mengen;
  const nachher = await mitClient(lokal, (client) =>
    pruefenNachDemEnde(client, { erwartet, mengenVorher }),
  );
  bilanz(berichteNachher(nachher));
}

async function kopiePruefen(kontext, kopie, zeitpunkt) {
  await bereitAbwarten(kontext, kopie);
  await zugangSetzen(kontext, kopie);
  const verbindung = await verbindungsdatenHolen(kontext, kopie);
  schritt("tunnel");
  const tunnel = await tunnelOeffnen(verbindung.server);
  try {
    const lokal = { ...verbindung, port: tunnel.port };
    maskiere([tunnelUrl(lokal)]);
    await verbindungAbwarten(kontext, tunnel, lokal);
    await datenPruefen(kontext, lokal, zeitpunkt);
  } finally {
    await tunnel.schliessen();
  }
}

async function kopieEntsorgen({ zugang, einstellungen, takt }, kopie) {
  if (kopie === null) {
    fehlerMelden(new LoeschenVerweigert());
    return;
  }
  try {
    const { geloescht, status } = await eigeneKopieLoeschen(zugang, kopie, { einstellungen, takt });
    if (!LOESCH_STATUS.has(status)) melde("loeschen_gescheitert", { status });
    pruefzeile("geloescht", { ok: geloescht }, geloescht);
  } catch (fehler) {
    schritt("loeschen");
    fehlerMelden(fehler);
  }
}

async function pruefen(kontext) {
  await produktionPruefen(kontext);
  const zeitpunkt = await zeitpunktBestimmen(kontext);
  const antwort = await wiederherstellungAusloesen(kontext, zeitpunkt);
  let kopie = null;
  try {
    kopie = await kopieFestlegen(kontext, antwort);
    if (kopie === null) throw new Abbruch("kopie");
    await kopiePruefen(kontext, kopie, zeitpunkt);
  } catch (fehler) {
    fehlerMelden(fehler);
  } finally {
    await kopieEntsorgen(kontext, kopie);
  }
}

async function aufraeumen(kontext) {
  await produktionPruefen(kontext);
  schritt("aufraeumen");
  const rahmen = { einstellungen: kontext.einstellungen, takt: kontext.takt };
  const { status, zaehler, fehlerStatus } = await uebrigeKopienLoeschen(kontext.zugang, rahmen);
  if (zaehler === null) throw new Abbruch("liste", { status });
  for (const wert of fehlerStatus.filter((code) => !LOESCH_STATUS.has(code))) {
    melde("loeschen_gescheitert", { status: wert });
  }
  pruefzeile("aufgeraeumt", zaehler, zaehler.fehler === 0);
}

const BEFEHLE = new Map([
  ["pruefen", pruefen],
  ["aufraeumen", aufraeumen],
]);

function signalBehandeln() {
  if (lauf.signal) return;
  lauf.signal = true;
  lauf.ok = false;
  melde("signal");
  steuerung.abort();
}

function unerwartet() {
  lauf.ok = false;
  process.exitCode = EXIT_FEHLER;
  fehlerMelden(new Abbruch(lauf.schritt));
  steuerung.abort();
}

async function hauptprogramm() {
  const befehl = BEFEHLE.get(argv[2]);
  if (befehl === undefined || argv.length > BEFEHL_ARGUMENTE) {
    melde("aufruf");
    return EXIT_FEHLER;
  }
  try {
    const einstellungen = einstellungenLesen(env);
    await befehl({ einstellungen, zugang: renderZugang(einstellungen), takt: einstellungen.takt });
  } catch (fehler) {
    fehlerMelden(fehler);
  }
  melde("ergebnis", { ok: lauf.ok });
  return lauf.ok ? EXIT_OK : EXIT_FEHLER;
}

process.on("SIGTERM", signalBehandeln);
process.on("SIGINT", signalBehandeln);
process.on("uncaughtException", unerwartet);
process.on("unhandledRejection", unerwartet);

hauptprogramm().then(
  (code) => {
    process.exitCode = code;
    setTimeout(() => process.exit(), ENDE_FRIST_MS).unref();
  },
  () => {
    process.exitCode = EXIT_FEHLER;
  },
);
