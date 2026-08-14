#!/usr/bin/env node
// Drift-Gate zwischen der Repo-Vorlage und dem LIVE-Agenten bei ElevenLabs.
//
// WARUM ES DAS GIBT: Vorlage und Live-Agent sind auseinandergelaufen, und
// NICHTS hat es bemerkt - es fiel nur auf, weil ein Test in einen Timeout lief.
// Ein Vergleich, der erst durch einen Zufallsbefund entsteht, ist keiner.
//
// WARUM BESITZ STATT VOLLABGLEICH: ein Abgleich ueber alle Felder des Agenten
// wuerde auch tts.voice_id melden - eine Stimme, die der Eigentuemer im
// Dashboard gewaehlt hat und die in der Vorlage nie stand. In diesem Projekt
// hat schon einmal ein Provisionierer die ganze Live-Konfiguration aus lokalen
// Werten geschrieben und damit Live-Einstellungen zerstoert. Verglichen wird
// deshalb AUSSCHLIESSLICH, was die Vorlage ausdruecklich besitzt: die Liste
// steht als Datenfeld _besitz.felder in der Vorlage selbst (nicht hier im
// Skript, nicht als Prosa) - eine Besitz-Liste, die nur ein Mensch liest,
// driftet genauso wie das, was sie beschreiben soll. Die Arten des Vergleichs
// (wert | namen | variablen) sind dort an _art_hinweis begruendet.
//
// NEBEN DEM FELDVERGLEICH: Verbote (_besitz.regeln, dort an _regeln_hinweis
// begruendet). Ein Feldvergleich kann nur zwei bekannte Stellen gegeneinander
// halten; ein Verbot sagt "in dieser Sammlung darf NIRGENDS dieser Pfad
// gesetzt sein" und gilt damit auch fuer Eintraege, die es heute nicht gibt.
// Auch sie stehen als Daten in der Vorlage und nicht hier - fest verdrahtet
// waere die Regel fuer den unsichtbar, der die Vorlage pflegt.
//
// DIESES SKRIPT LIEST NUR (GET). Es patcht den Live-Agenten NICHT - das
// Reparieren ist eine eigene Entscheidung mit eigenem Paket.
//
// FAIL-CLOSED, weil ein gruenes Pruefkommando, das nichts geprueft hat, wie ein
// bestandenes aussieht: ohne Schluessel, ohne erreichbare API, ohne
// Besitz-Erklaerung oder bei einem besessenen Pfad, den die Vorlage gar nicht
// hat, endet der Lauf mit einer Meldung und Exit 1 - nie mit OK.
//
// Reine, seiteneffektfreie Vergleichs-Funktion (vergleicheBesitz); der CLI-Teil
// (Netz, exit, console) sitzt hinter dem main-Guard. Nur Node-Builtins.
//
// Aufruf:  npm run elevenlabs:drift            (Live-Agent, s. LIVE_AGENT_ID)
//          npm run elevenlabs:drift -- <agent_id>
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../src/config.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VORLAGE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
// Der heute produktive Agent. Als Vorgabe hier und nicht in src/config.js: der
// Wert ist kein Betriebsschalter, sondern das Pruefobjekt dieses einen
// Kommandos - ein Argument uebersteuert ihn (z.B. fuer einen Wegwerf-Agenten).
const LIVE_AGENT_ID = "agent_5301kwkh9vv3ezesf100pggfj9rs";
const AGENTEN_PFAD_PREFIX = "/v1/convai/agents/";
const ARG_INDEX_AGENT_ID = 2;

const BESITZ_SCHLUESSEL = "_besitz";
const FELDER_SCHLUESSEL = "felder";
const REGELN_SCHLUESSEL = "regeln";
const NICHT_BESESSEN_SCHLUESSEL = "_nicht_besessen";
// Einzige heute bekannte Form eines Verbots: "kein Eintrag dieser Sammlung darf
// einen dieser Pfade gesetzt haben". Eine unbekannte art ist ein Fehler und
// kein stilles Ueberspringen - sonst pruefte das Gate genau das Verbot nicht
// mehr, das es zu pruefen behauptet.
const REGEL_ART_VERBOTEN_JE_EINTRAG = "verboten_je_eintrag";
const ART_WERT = "wert";
const ART_NAMEN = "namen";
const ART_VARIABLEN = "variablen";
// Schluessel-Praefix der reinen Entwickler-Doku in diesen JSON-Dateien (Bestand,
// s. scripts/check-elevenlabs-tests.js): kein Teil des ElevenLabs-Schemas,
// zaehlt deshalb bei art "namen" nicht als Werkzeug-/Preset-Name mit.
const DOKU_PRAEFIX = "_";
// ElevenLabs' dynamic-variable-Syntax, identisch zu check-elevenlabs-tests.js:
// "double curly braces {{variable_name}}".
const VARIABLEN_MUSTER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const PFAD_TRENNER = ".";
const PFAD_VERBINDER = " + ";
const LISTEN_TRENNER = "; ";

// Der System-Prompt ist mehrere Kilobyte gross. Ungekuerzt waere die Meldung
// unlesbar - gekuerzt VERGLICHEN wird aber nie: der Vergleich laeuft immer ueber
// den vollen Wert, gekuerzt ist ausschliesslich die Anzeige (sonst saehen zwei
// Prompts mit gleichem Anfang faelschlich gleich aus).
const WERT_VORSCHAU_ZEICHEN = 200;
const FEHLER_VORSCHAU_ZEICHEN = 400;
const ABRUF_TIMEOUT_MS = 15000;

const FEHLT_MARKE = "(fehlt)";
const SCHLUESSEL_MASKE = "<ELEVENLABS_API_KEY>";
const LOG_PREFIX = "[check-elevenlabs-drift]";

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

// --- Pfad- und Werte-Zugriff ---

// Loest einen Punkt-Pfad in einem geparsten JSON-Wert auf. Liefert ausdruecklich
// { gefunden }, nicht undefined: "Pfad gibt es nicht" und "Wert ist leer" sind
// verschiedene Sachverhalte, und nur der erste ist ein Erklaerungs-Fehler.
function wertAnPfad(wurzel, pfad) {
  let aktuell = wurzel;
  for (const segment of pfad.split(PFAD_TRENNER)) {
    const istBehaelter = aktuell !== null && typeof aktuell === "object";
    if (!istBehaelter || !(segment in aktuell)) return { gefunden: false };
    aktuell = aktuell[segment];
  }
  return { gefunden: true, wert: aktuell };
}

// Die Namen EINER Sammlung (art "namen"). Zwei Formen, weil Vorlage und
// Anbieter dieselbe Sache verschieden formen: die Vorlage haelt Werkzeuge als
// Objekt-Karte, der Live-Agent als Liste. null-Werte zaehlen nicht als
// vorhanden - der Live-Agent fuehrt jedes bekannte Systemwerkzeug als
// Schluessel und setzt die nicht konfigurierten auf null; ohne diese Regel
// waere die Live-Menge immer die volle Anbieter-Liste.
function namenAus(wert) {
  if (Array.isArray(wert)) {
    return wert.map((eintrag) => eintrag?.name).filter((name) => typeof name === "string");
  }
  if (wert === null || typeof wert !== "object") return [];
  return Object.entries(wert)
    .filter(([schluessel, kind]) => {
      return !schluessel.startsWith(DOKU_PRAEFIX) && kind !== null;
    })
    .map(([schluessel]) => schluessel);
}

// Die {{name}}-Vorkommen EINES Texts (art "variablen"): bei dynamic_variables
// werden die NAMEN verglichen, nicht die Werte - die Werte sind
// auftragsspezifisch und bei jedem Anruf andere.
function variablenAus(wert) {
  if (typeof wert !== "string") return [];
  return [...wert.matchAll(VARIABLEN_MUSTER)].map((treffer) => treffer[1]);
}

function sortierteMenge(namen) {
  return [...new Set(namen)].sort();
}

function zeigeMenge(menge) {
  return `[${menge.join(", ")}]`;
}

// Anzeige eines Einzelwerts: JSON-Schreibweise (Zeilenumbrueche werden zu \n,
// die Meldung bleibt EINE Zeile) und gekuerzt, s. WERT_VORSCHAU_ZEICHEN.
function zeigeWert(wert) {
  const text = JSON.stringify(wert);
  if (text.length <= WERT_VORSCHAU_ZEICHEN) return text;
  const anfang = text.slice(0, WERT_VORSCHAU_ZEICHEN);
  return `${anfang}... (gekuerzt, ${text.length} Zeichen)`;
}

// Die drei Vergleichs-Arten, begruendet in der Vorlage (_besitz._art_hinweis).
// einPfad: art "wert" vergleicht genau EIN Feld je Seite; die Mengen-Arten
// duerfen mehrere Ablagen zusammenfassen (z.B. eigene UND eingebaute Werkzeuge).
const VERGLEICHS_ARTEN = new Map([
  [ART_WERT, { einPfad: true, sammle: (werte) => werte[0], zeige: zeigeWert }],
  [
    ART_NAMEN,
    {
      einPfad: false,
      sammle: (werte) => sortierteMenge(werte.flatMap(namenAus)),
      zeige: zeigeMenge,
    },
  ],
  [
    ART_VARIABLEN,
    {
      einPfad: false,
      sammle: (werte) => sortierteMenge(werte.flatMap(variablenAus)),
      zeige: zeigeMenge,
    },
  ],
]);

// --- Form der Besitz-Erklaerung ---

function istPfadListe(pfade) {
  return (
    Array.isArray(pfade) &&
    pfade.length > 0 &&
    pfade.every((pfad) => typeof pfad === "string" && pfad !== "")
  );
}

function pfadListeFehler({ feld, seite, pfade, einPfad }) {
  if (!istPfadListe(pfade)) {
    return `${feld}: "${seite}" ist keine nicht-leere Liste von Pfaden`;
  }
  if (einPfad && pfade.length !== 1) {
    return `${feld}: art "${ART_WERT}" braucht genau EINEN Pfad je Seite, "${seite}" hat ${pfade.length}`;
  }
  return null;
}

// Prueft die FORM eines Besitz-Eintrags. Ein kaputter Eintrag darf nicht still
// als "kein Fund" durchgehen: dann pruefte das Gate genau das Feld nicht mehr,
// das es zu pruefen behauptet.
function eintragsFormFehler(eintrag) {
  const { feld, art, vorlage, live } = eintrag ?? {};
  if (typeof feld !== "string" || feld === "") {
    return `${BESITZ_SCHLUESSEL}.${FELDER_SCHLUESSEL}: Eintrag ohne "feld"-Namen`;
  }
  const vergleich = VERGLEICHS_ARTEN.get(art);
  if (!vergleich) {
    const bekannt = [...VERGLEICHS_ARTEN.keys()].join(", ");
    return `${feld}: unbekannte Vergleichs-Art "${art}" (bekannt: ${bekannt})`;
  }
  const seiten = [
    { seite: "vorlage", pfade: vorlage },
    { seite: "live", pfade: live },
  ];
  for (const { seite, pfade } of seiten) {
    const fehler = pfadListeFehler({
      feld,
      seite,
      pfade,
      einPfad: vergleich.einPfad,
    });
    if (fehler) return fehler;
  }
  return null;
}

// --- Vergleich ---

function fehlendePfade(wurzel, pfade) {
  return pfade.filter((pfad) => !wertAnPfad(wurzel, pfad).gefunden);
}

// Der Vergleichswert EINER Seite. vorhanden=false gibt es nur bei art "wert":
// bei den Mengen-Arten ist die leere Menge ein gueltiger Wert, kein Fehlen.
function seiteVergleichswert(vergleich, wurzel, pfade) {
  const werte = [];
  for (const pfad of pfade) {
    const treffer = wertAnPfad(wurzel, pfad);
    if (treffer.gefunden) werte.push(treffer.wert);
  }
  if (vergleich.einPfad && werte.length === 0) return { vorhanden: false };
  return { vorhanden: true, wert: vergleich.sammle(werte) };
}

// Verglichen wird der VOLLE Wert, nie die gekuerzte Anzeige.
function istGleich(links, rechts) {
  const gleichVorhanden = links.vorhanden === rechts.vorhanden;
  return gleichVorhanden && JSON.stringify(links.wert) === JSON.stringify(rechts.wert);
}

function abweichungsZeile({ eintrag, vergleich, links, rechts }) {
  const zeige = (seite) => {
    return seite.vorhanden ? vergleich.zeige(seite.wert) : FEHLT_MARKE;
  };
  const vorlagePfade = eintrag.vorlage.join(PFAD_VERBINDER);
  const livePfade = eintrag.live.join(PFAD_VERBINDER);
  return `ABWEICHUNG ${eintrag.feld} | Vorlage ${vorlagePfade} = ${zeige(links)} | Live ${livePfade} = ${zeige(rechts)}`;
}

// Vergleicht EIN besessenes Feld. Liefert { fehler } (die Besitz-Erklaerung
// passt nicht zur Vorlage - hier waere ein "kein Fund" eine Luege),
// { abweichung } oder {} bei Uebereinstimmung.
function vergleicheFeld({ eintrag, vorlage, live }) {
  const formFehler = eintragsFormFehler(eintrag);
  if (formFehler) return { fehler: formFehler };

  const vergleich = VERGLEICHS_ARTEN.get(eintrag.art);
  const fehlend = fehlendePfade(vorlage, eintrag.vorlage);
  if (fehlend.length > 0) {
    return {
      fehler: `${eintrag.feld}: besessener Pfad fehlt in der Vorlage (${fehlend.join(PFAD_VERBINDER)}) - Besitz-Erklaerung und Vorlage sind auseinander, dieses Feld wuerde nichts vergleichen`,
    };
  }

  const links = seiteVergleichswert(vergleich, vorlage, eintrag.vorlage);
  const rechts = seiteVergleichswert(vergleich, live, eintrag.live);
  if (istGleich(links, rechts)) return {};
  return { abweichung: abweichungsZeile({ eintrag, vergleich, links, rechts }) };
}

// Alle BESESSENEN Felder und nur sie.
function vergleicheFelder(besitz, vorlage, live) {
  const eintraege = besitz?.[FELDER_SCHLUESSEL];
  if (!Array.isArray(eintraege) || eintraege.length === 0) {
    return {
      geprueft: 0,
      abweichungen: [],
      fehler: [
        `${VORLAGE_REL}: keine Besitz-Erklaerung (${BESITZ_SCHLUESSEL}.${FELDER_SCHLUESSEL}) mit mindestens einem Feld - ohne sie wuerde NICHTS verglichen`,
      ],
    };
  }

  const abweichungen = [];
  const fehler = [];
  for (const eintrag of eintraege) {
    const ergebnis = vergleicheFeld({ eintrag, vorlage, live });
    if (ergebnis.fehler) fehler.push(ergebnis.fehler);
    if (ergebnis.abweichung) abweichungen.push(ergebnis.abweichung);
  }
  return { geprueft: eintraege.length, abweichungen, fehler };
}

// --- Verbote (_besitz.regeln) ---

// Prueft die FORM eines Verbots. Wie bei den Feldern gilt: ein kaputter Eintrag
// darf nicht still als "kein Fund" durchgehen - sonst pruefte das Gate genau
// das Verbot nicht mehr, das es zu pruefen behauptet.
function regelFormFehler(eintrag) {
  const { regel, art, live, verboten, meldung } = eintrag ?? {};
  if (typeof regel !== "string" || regel === "") {
    return `${BESITZ_SCHLUESSEL}.${REGELN_SCHLUESSEL}: Eintrag ohne "regel"-Namen`;
  }
  if (art !== REGEL_ART_VERBOTEN_JE_EINTRAG) {
    return `${regel}: unbekannte Regel-Art "${art}" (bekannt: ${REGEL_ART_VERBOTEN_JE_EINTRAG})`;
  }
  if (typeof live !== "string" || live === "") {
    return `${regel}: "live" ist kein Pfad auf die gepruefte Sammlung`;
  }
  if (!istPfadListe(verboten)) {
    return `${regel}: "verboten" ist keine nicht-leere Liste von Pfaden`;
  }
  if (typeof meldung !== "string" || meldung === "") {
    return `${regel}: "meldung" fehlt - ein Fund wuerde seinen Grund nicht nennen`;
  }
  return null;
}

// "Gesetzt" heisst: der Pfad existiert UND traegt nicht null. Der Anbieter
// fuehrt die Felder eines Presets vollstaendig und setzt die ungenutzten auf
// null. Ein LEERER Text zaehlt dagegen als gesetzt - eine geleerte Offenlegung
// ist der schlimmste Fall des Verbots, nicht sein harmloser.
function istGesetzt(wurzel, pfad) {
  const treffer = wertAnPfad(wurzel, pfad);
  return treffer.gefunden && treffer.wert !== null;
}

// Nennt den Eintrag beim Namen und traegt die Begruendung aus der Vorlage mit:
// eine Verletzung ist kein Feldunterschied, den man wegvergleichen kann,
// sondern eine Aussage darueber, was hier ueberhaupt nicht stehen darf.
function verletzungsZeile({ eintrag, name, gesetzt }) {
  const pfade = gesetzt.join(PFAD_VERBINDER);
  return `VERLETZUNG ${eintrag.regel} | Live ${eintrag.live}."${name}" setzt ${pfade} | ${eintrag.meldung}`;
}

// EIN Verbot gegen EINE Sammlung des Live-Agenten. Geprueft wird jeder Eintrag,
// den der Agent wirklich fuehrt - damit auch kuenftig hinzugefuegte und
// unabhaengig davon, ob die Namen der Sammlung gerade abweichen.
function pruefeRegel(eintrag, live) {
  const formFehler = regelFormFehler(eintrag);
  if (formFehler) return { geprueft: 0, verletzungen: [], fehler: [formFehler] };

  const treffer = wertAnPfad(live, eintrag.live);
  const sammlung = treffer.wert;
  const istSammlung = treffer.gefunden && sammlung !== null && typeof sammlung === "object";
  if (!istSammlung) {
    return {
      geprueft: 0,
      verletzungen: [],
      fehler: [
        `${eintrag.regel}: Sammlung ${eintrag.live} fehlt im Live-Agenten oder ist kein Objekt - dieses Verbot wuerde nichts pruefen`,
      ],
    };
  }

  const verletzungen = [];
  const eintraege = Object.entries(sammlung);
  for (const [name, wert] of eintraege) {
    const gesetzt = eintrag.verboten.filter((pfad) => istGesetzt(wert, pfad));
    if (gesetzt.length > 0) verletzungen.push(verletzungsZeile({ eintrag, name, gesetzt }));
  }
  return { geprueft: eintraege.length, verletzungen, fehler: [] };
}

// Alle Verbote. geprueft zaehlt die wirklich angesehenen Paare (Regel x
// Eintrag) - eine Zahl, die 0 bleibt, waere sonst von "nichts gefunden" nicht
// zu unterscheiden.
function pruefeRegeln(besitz, live) {
  const regeln = besitz?.[REGELN_SCHLUESSEL];
  if (!Array.isArray(regeln) || regeln.length === 0) {
    return {
      geprueft: 0,
      verletzungen: [],
      fehler: [
        `${VORLAGE_REL}: keine Regeln (${BESITZ_SCHLUESSEL}.${REGELN_SCHLUESSEL}) mit mindestens einem Verbot - ohne sie wuerde KEIN Verbot durchgesetzt`,
      ],
    };
  }

  const verletzungen = [];
  const fehler = [];
  let geprueft = 0;
  for (const eintrag of regeln) {
    const ergebnis = pruefeRegel(eintrag, live);
    verletzungen.push(...ergebnis.verletzungen);
    fehler.push(...ergebnis.fehler);
    geprueft += ergebnis.geprueft;
  }
  return { geprueft, verletzungen, fehler };
}

// Vergleicht Vorlage und Live-Agenten ueber die BESESSENEN Felder und setzt die
// Verbote der Vorlage durch. Wirft nie an den Aufrufer weiter: jedes erwartbare
// Problem wird zu einem Eintrag in fehler[], abweichungen[] oder
// verletzungen[] (fail-closed). ok = alle drei leer.
export function vergleicheBesitz({ vorlage, live }) {
  const besitz = vorlage?.[BESITZ_SCHLUESSEL];
  const felder = vergleicheFelder(besitz, vorlage, live);
  const regeln = pruefeRegeln(besitz, live);
  const fehler = [...felder.fehler, ...regeln.fehler];
  const sauber = felder.abweichungen.length === 0 && regeln.verletzungen.length === 0;
  return {
    ok: sauber && fehler.length === 0,
    geprueft: felder.geprueft,
    geprueftRegeln: regeln.geprueft,
    abweichungen: felder.abweichungen,
    verletzungen: regeln.verletzungen,
    fehler,
  };
}

// Was die Vorlage ausdruecklich NICHT besitzt - wird mitgemeldet, damit die
// Grenze des Vergleichs sichtbar bleibt und niemand ein stilles "gruen" fuer
// "alles geprueft" haelt.
export function nichtBesessen(vorlage) {
  const besitz = vorlage?.[BESITZ_SCHLUESSEL];
  const liste = besitz?.[NICHT_BESESSEN_SCHLUESSEL];
  return Array.isArray(liste) ? liste.filter((zeile) => typeof zeile === "string") : [];
}

// --- CLI (von der Logik getrennt, hinter main-Guard) ---

// Maskiert den Schluessel in allem, was nach aussen geht (CLAUDE.md Regel 4).
function ohneSchluessel(text) {
  if (!apiKey) return text;
  return text.replaceAll(apiKey, SCHLUESSEL_MASKE);
}

// Der reine Netz-Zugriff. Eigene Funktion, damit ein nicht erreichbarer
// Anbieter seinen Pfad im Klartext nennt: nacktes "fetch failed" sagt weder,
// welche Adresse gemeint war, noch ob das Zeitlimit zuschlug (P8).
async function fetchAgent(pfad) {
  try {
    return await fetch(`${apiBase}${pfad}`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(ABRUF_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `GET ${apiBase}${pfad} -> nicht erreichbar (Zeitlimit ${ABRUF_TIMEOUT_MS} ms): ${ohneSchluessel(err.message)}`,
      { cause: err },
    );
  }
}

// Liest den Live-Agenten. NUR GET - dieses Skript patcht nichts.
async function holeLiveAgenten(agentId) {
  const pfad = `${AGENTEN_PFAD_PREFIX}${agentId}`;
  const antwort = await fetchAgent(pfad);
  const text = await antwort.text();
  if (!antwort.ok) {
    const anfang = ohneSchluessel(text.slice(0, FEHLER_VORSCHAU_ZEICHEN));
    throw new Error(`GET ${pfad} -> HTTP ${antwort.status}: ${anfang}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`GET ${pfad} -> Antwort ist kein JSON: ${ohneSchluessel(err.message)}`, {
      cause: err,
    });
  }
}

function ladeVorlage() {
  return JSON.parse(readFileSync(join(REPO_ROOT, VORLAGE_REL), "utf8"));
}

function melde({ ergebnis, agentId, ausserhalb }) {
  const { ok, geprueft, geprueftRegeln, abweichungen, verletzungen, fehler } = ergebnis;
  for (const zeile of [...fehler, ...verletzungen, ...abweichungen]) {
    console.error(`${LOG_PREFIX} ${zeile}`);
  }
  if (ausserhalb.length > 0) {
    console.log(
      `${LOG_PREFIX} nicht verglichen, weil die Vorlage es nicht besitzt: ${ausserhalb.join(LISTEN_TRENNER)}`,
    );
  }
  // Beide Zahlen stehen auch im gruenen Fall da: ein Pruefkommando, das nichts
  // findet, sieht sonst aus wie eines, das nichts sucht.
  if (ok) {
    console.log(
      `${LOG_PREFIX} OK - alle ${geprueft} besessenen Felder stimmen mit dem Live-Agenten ${agentId} ueberein, ${geprueftRegeln} Verbots-Pruefungen (Regel x Eintrag) ohne Verletzung.`,
    );
    return 0;
  }
  console.error(
    `${LOG_PREFIX} ROT - ${abweichungen.length} von ${geprueft} besessenen Feldern weichen ab, ${verletzungen.length} von ${geprueftRegeln} Verbots-Pruefungen (Regel x Eintrag) verletzt, ${fehler.length} Fehler in der Besitz-/Regel-Erklaerung. Der Live-Agent wurde NICHT veraendert; das Reparieren ist eine eigene Entscheidung.`,
  );
  return 1;
}

async function runCli() {
  if (!apiKey) {
    console.error(
      `${LOG_PREFIX} Fehler (fail-closed): ELEVENLABS_API_KEY ist leer - ohne Schluessel ist der Live-Agent nicht lesbar, und ungelesen wird nichts als gruen gemeldet.`,
    );
    return 1;
  }
  const agentId = process.argv[ARG_INDEX_AGENT_ID] || LIVE_AGENT_ID;
  const vorlage = ladeVorlage();
  const live = await holeLiveAgenten(agentId);
  return melde({
    ergebnis: vergleicheBesitz({ vorlage, live }),
    agentId,
    ausserhalb: nichtBesessen(vorlage),
  });
}

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  try {
    process.exit(await runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${ohneSchluessel(err.message)}`);
    process.exit(1);
  }
}
