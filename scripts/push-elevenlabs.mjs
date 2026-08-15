#!/usr/bin/env node
// Schreibt die BESESSENEN Felder der Repo-Vorlage auf den LIVE-Agenten bei
// ElevenLabs - das Gegenstueck zum lesenden Gate (npm run elevenlabs:drift).
//
// WARUM ES DAS GIBT: bis heute gab es fuer eine gemeldete Abweichung nur zwei
// Wege - Handarbeit im Dashboard oder ein Wegwerf-Spike. Beides ist nicht
// wiederholbar und hinterlaesst keine Spur, welcher Wert warum gesetzt wurde.
//
// DIE VIER RIEGEL, in der Reihenfolge ihrer Wichtigkeit:
//
// 1. TROCKENLAUF IST DER NORMALFALL. Ohne den ausdruecklichen Schalter
//    --ausfuehren wird NICHTS geschrieben; ein versehentlicher Aufruf zeigt nur
//    an. Der Schalter existiert nur als Argument - es gibt keine Env-Variable
//    und keine Datei, die ihn setzen koennte, damit er nicht aus Versehen in
//    einer Automatisierung landet.
// 2. NUR BESESSENE PFADE. Geschrieben wird ausschliesslich an den Live-Pfaden
//    aus _besitz.felder der Vorlage, und der Patch-Koerper wird AUS DIESEN
//    PFADEN gebaut - er kann gar nichts anderes enthalten. In diesem Projekt
//    hat schon einmal ein Provisionierer die ganze Live-Konfiguration aus
//    lokalen Werten geschrieben und Dashboard-Einstellungen zerstoert; genau
//    dieser Weg ist hier baulich versperrt (kein "ganze Config hochladen").
// 3. LESEN, VERGLEICHEN, DANN SCHREIBEN. Erst GET des Live-Agenten, dann der
//    gemeinsame Besitz-Vergleich, dann ein PATCH nur der abweichenden Pfade.
//    Ein Feld, das schon stimmt, wird nicht angefasst.
// 4. FAIL-CLOSED. Fehlender Schluessel, unlesbare oder unparsebare Vorlage,
//    eine Besitz-Erklaerung, die nicht traegt, oder eine verletzte Regel der
//    Vorlage: Abbruch mit Exit 1, ohne jeden Schreibversuch.
//
// WAS DAS WERKZEUG NICHT KANN: Felder, deren Vergleichs-Art mehrere Stellen zu
// einer MENGE zusammenfasst (namen, variablen, texte). Aus "diese Namen fehlen"
// folgt kein einzelner Zielwert - welches Objekt mit welchen Anbieter-Feldern
// dahinter entstehen soll, waere geraten. Solche Abweichungen werden angezeigt
// und ausdruecklich NICHT geschrieben.
//
// GEGENPROBE STATT VERTRAUEN: PATCH deep-merged verschachtelte Modelle, aber
// Dict- und Listenfelder ERSETZT es (am Anbieter gemessen, .fortschritt.md
// 14.08.). Ein besessener Pfad kann also unter einem Dict liegen, und dann
// wuerde ein minimaler Patch dessen Geschwister loeschen. Deshalb sagt dieser
// Lauf VOR dem Schreiben trocken voraus, welche besessenen Felder danach noch
// abweichen, liest nach dem Schreiben erneut und meldet ROT, sobald die
// Wirklichkeit schlechter ausfaellt als die Vorhersage.
//
// Aufruf:  npm run elevenlabs:push                     (Trockenlauf)
//          npm run elevenlabs:push -- <agent_id>       (Trockenlauf, anderer Agent)
//          npm run elevenlabs:push -- --ausfuehren     (schreibt wirklich)
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../src/config.js";

import {
  AGENTEN_PFAD_PREFIX,
  FEHLER_VORSCHAU_ZEICHEN,
  LIVE_AGENT_ID,
  holeLiveAgenten,
  ladeVorlage,
  ohneSchluessel,
  schluesselFehlt,
} from "./lib/elevenlabs-agent-lesen.mjs";
import {
  ART_WERT,
  PFAD_VERBINDER,
  setzeAnPfad,
  vergleicheBesitz,
} from "./lib/elevenlabs-besitz.mjs";

const LOG_PREFIX = "[push-elevenlabs]";
// Der einzige Schalter, der schreibt. Ausgeschrieben und ohne Kurzform: ein
// einzelnes vertipptes Zeichen soll keinen Live-Agenten veraendern.
const BESTAETIGUNGS_FLAG = "--ausfuehren";
const FLAG_PRAEFIX = "--";
const ARG_START = 2;
const LISTEN_TRENNER = ", ";
// Grosszuegiger als der Lese-Abruf: der Patch traegt den vollen System-Prompt.
const SCHREIB_TIMEOUT_MS = 30000;

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

// --- Argumente ---

// Freies Argument = Agenten-Kennung, Schalter = Verhalten. Ein UNBEKANNTER
// Schalter bricht ab, statt still als Trockenlauf durchzugehen: wer
// "--ausfuehren=true" tippt, meint schreiben, und ein Werkzeug, das solche
// Absicht wortlos verschluckt, erzieht dazu, es noch einmal zu versuchen.
function leseArgumente(argv) {
  const argumente = argv.slice(ARG_START);
  const schalter = argumente.filter((wert) => wert.startsWith(FLAG_PRAEFIX));
  const frei = argumente.filter((wert) => !wert.startsWith(FLAG_PRAEFIX));
  return {
    agentId: frei[0] || LIVE_AGENT_ID,
    ausfuehren: schalter.includes(BESTAETIGUNGS_FLAG),
    unbekannt: schalter.filter((wert) => wert !== BESTAETIGUNGS_FLAG),
  };
}

// --- Schreibbarkeit und Patch-Koerper ---

// Schreibbar ist genau die Vergleichs-Art "wert": sie hat einen einzigen
// Live-Pfad und einen einzigen Vorlagen-Wert - beides zusammen ergibt eine
// eindeutige Zuweisung. soll.vorhanden wird trotz des Vergleichs mitgeprueft:
// ein Wert, den die Vorlage gar nicht fuehrt, duerfte niemals geschrieben
// werden, auch nicht als undefined.
function istSchreibbar(abweichung) {
  const einPfad = abweichung.livePfade.length === 1;
  return abweichung.art === ART_WERT && einPfad && abweichung.soll.vorhanden;
}

function zielPfad(abweichung) {
  return abweichung.livePfade[0];
}

// Der Patch-Koerper entsteht AUSSCHLIESSLICH aus den besessenen Live-Pfaden der
// abweichenden Felder. Es gibt keinen Zweig, der eine ganze Konfiguration
// uebernimmt - was hier nicht als Pfad steht, kann nicht gesendet werden.
function bauePatchKoerper(schreibbar) {
  const koerper = {};
  for (const abweichung of schreibbar) {
    setzeAnPfad(koerper, zielPfad(abweichung), abweichung.soll.wert);
  }
  return koerper;
}

// Der Live-Stand, WIE ER NACH dem Patch aussaehe - auf einer Kopie, damit der
// gelesene Stand unveraendert bleibt. Grundlage der Vorhersage: dieselbe
// Vergleichslogik gegen diese Kopie sagt, welche besessenen Felder danach noch
// rot waeren. Das faengt auch die abgeleiteten Arten richtig ein: die Namen der
// dynamischen Variablen etwa werden aus dem Prompt gelesen und stimmen deshalb
// von selbst, sobald der Prompt geschrieben ist.
function simuliereSchreiben({ live, schreibbar }) {
  const kopie = structuredClone(live);
  for (const abweichung of schreibbar) {
    setzeAnPfad(kopie, zielPfad(abweichung), abweichung.soll.wert);
  }
  return kopie;
}

// --- Schreiben (die einzige Stelle im Repo, die den Agenten veraendert) ---

async function patcheAgenten({ agentId, koerper }) {
  const pfad = `${AGENTEN_PFAD_PREFIX}${agentId}`;
  let antwort;
  try {
    antwort = await fetch(`${apiBase}${pfad}`, {
      method: "PATCH",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(koerper),
      signal: AbortSignal.timeout(SCHREIB_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `PATCH ${apiBase}${pfad} -> nicht erreichbar (Zeitlimit ${SCHREIB_TIMEOUT_MS} ms): ${ohneSchluessel(err.message)}`,
      { cause: err },
    );
  }
  if (!antwort.ok) {
    const text = await antwort.text();
    const anfang = ohneSchluessel(text.slice(0, FEHLER_VORSCHAU_ZEICHEN));
    throw new Error(`PATCH ${pfad} -> HTTP ${antwort.status}: ${anfang}`);
  }
}

// --- Ausgabe ---

function feldNamen(abweichungen) {
  return abweichungen.map((abweichung) => abweichung.feld).sort();
}

// EINE Zeile je Feld, immer mit IST und SOLL - die Marke sagt, was mit diesem
// Feld geschieht. Die Werte kommen fertig gerendert aus dem Vergleichs-Kern
// (lange Texte gekuerzt); geschrieben wird immer der volle Wert.
function feldZeile(marke, abweichung) {
  const pfade = abweichung.livePfade.join(PFAD_VERBINDER);
  return `${marke} ${abweichung.feld} (art "${abweichung.art}") | Live ${pfade} | IST ${abweichung.istAnzeige} -> SOLL ${abweichung.sollAnzeige}`;
}

function meldeZeilen(marke, abweichungen) {
  for (const abweichung of abweichungen) {
    console.log(`${LOG_PREFIX} ${feldZeile(marke, abweichung)}`);
  }
}

function meldeNichtSchreibbar(rest) {
  if (rest.length === 0) return;
  meldeZeilen("NICHT SCHREIBBAR", rest);
  console.log(
    `${LOG_PREFIX} NICHT SCHREIBBAR heisst: diese Vergleichs-Arten fassen mehrere Stellen zu einer Menge zusammen (Namen, Variablen, Texte). Aus einer Menge folgt kein einzelner Zielwert - ihn zu erraten waere genau der Fehler, den dieses Werkzeug verhindern soll. Diese Felder gehoeren ins Dashboard oder in die Vorlage.`,
  );
}

// Belegt Riegel 2 an der AUSGABE statt nur im Kommentar: der Koerper, der
// gesendet wuerde, traegt genau diese Zweige - was hier fehlt, kann den Agenten
// nicht erreichen. Steht auch im Trockenlauf da, damit die Zusage pruefbar ist,
// bevor jemand den Schalter setzt.
function meldeKoerper(koerper) {
  const zweige = Object.keys(koerper);
  if (zweige.length === 0) return;
  const groesse = JSON.stringify(koerper).length;
  console.log(
    `${LOG_PREFIX} PATCH-KOERPER - nur diese Zweige, ${groesse} Zeichen gesamt: ${zweige.join(LISTEN_TRENNER)}`,
  );
}

// Was der Lauf vorhat, bevor irgendetwas passiert - im Trockenlauf ist das das
// ganze Ergebnis, mit --ausfuehren die Ankuendigung.
function meldePlan({ agentId, befund, schreibbar, rest, danach }) {
  console.log(
    `${LOG_PREFIX} Agent ${agentId}: ${befund.geprueft} besessene Felder verglichen, ${befund.abweichungen.length} weichen ab (${schreibbar.length} schreibbar, ${rest.length} nicht).`,
  );
  for (const verletzung of befund.verletzungen) {
    console.error(`${LOG_PREFIX} ${verletzung}`);
  }
  meldeZeilen("WUERDE SCHREIBEN", schreibbar);
  meldeNichtSchreibbar(rest);
  const uebrig = feldNamen(danach.abweichungen);
  const namen = uebrig.length > 0 ? `: ${uebrig.join(LISTEN_TRENNER)}` : "";
  console.log(
    `${LOG_PREFIX} VORHERSAGE - danach waeren noch ${uebrig.length} besessene Felder abweichend${namen} (trocken am gelesenen Live-Stand gerechnet, nichts gesendet).`,
  );
}

// --- Ablauf ---

// Der Schreibteil. Getrennt vom Trockenlauf, damit an EINER Stelle steht, was
// nur mit ausdruecklicher Bestaetigung passiert.
async function fuehreAus({ agentId, vorlage, befund, schreibbar, danach, koerper }) {
  if (befund.verletzungen.length > 0) {
    console.error(
      `${LOG_PREFIX} Abbruch (fail-closed): ${befund.verletzungen.length} Verbote der Vorlage sind am Live-Agenten verletzt (oben genannt). In eine Konfiguration, von der bekannt ist, dass sie eine Regel bricht, wird nicht geschrieben - der Push wuerde einen Teil richtig stellen und den Bruch bestehen lassen. NICHTS gesendet.`,
    );
    return 1;
  }
  if (schreibbar.length === 0) {
    console.log(`${LOG_PREFIX} Nichts zu schreiben - kein schreibbares Feld weicht ab.`);
    return 0;
  }

  const pfade = schreibbar.map(zielPfad);
  console.log(`${LOG_PREFIX} PATCH an ${pfade.length} Pfaden: ${pfade.join(LISTEN_TRENNER)}`);
  await patcheAgenten({ agentId, koerper });

  // Gegenprobe: erneut lesen und mit derselben Logik vergleichen. Ein Feld,
  // das jetzt abweicht, obwohl die Vorhersage es nicht nannte, heisst, dass der
  // Patch mehr angefasst hat als seine Pfade.
  const nachher = await holeLiveAgenten(agentId);
  const geprueft = vergleicheBesitz({ vorlage, live: nachher });
  const vorhergesagt = new Set(feldNamen(danach.abweichungen));
  const unerwartet = feldNamen(geprueft.abweichungen).filter((feld) => !vorhergesagt.has(feld));
  if (unerwartet.length > 0) {
    console.error(
      `${LOG_PREFIX} ROT nach dem Schreiben - unerwartet abweichend: ${unerwartet.join(LISTEN_TRENNER)}. Der Patch hat mehr veraendert als seine Pfade (PATCH ersetzt Dict- und Listenfelder). Live-Stand pruefen, bevor erneut geschrieben wird.`,
    );
    return 1;
  }
  console.log(
    `${LOG_PREFIX} OK - ${schreibbar.length} Felder geschrieben und zurueckgelesen, ${geprueft.abweichungen.length} besessene Felder weichen noch ab (wie vorhergesagt).`,
  );
  return 0;
}

async function runCli() {
  const schluesselGrund = schluesselFehlt();
  if (schluesselGrund) {
    console.error(
      `${LOG_PREFIX} Abbruch (fail-closed): ${schluesselGrund} Ohne gelesenen Live-Stand wird nicht geschrieben.`,
    );
    return 1;
  }
  const { agentId, ausfuehren, unbekannt } = leseArgumente(process.argv);
  if (unbekannt.length > 0) {
    console.error(
      `${LOG_PREFIX} Abbruch (fail-closed): unbekannte Schalter ${unbekannt.join(LISTEN_TRENNER)} - bekannt ist nur ${BESTAETIGUNGS_FLAG}. NICHTS gesendet.`,
    );
    return 1;
  }

  const vorlage = ladeVorlage();
  const live = await holeLiveAgenten(agentId);
  const befund = vergleicheBesitz({ vorlage, live });
  if (befund.fehler.length > 0) {
    for (const fehler of befund.fehler) console.error(`${LOG_PREFIX} ${fehler}`);
    console.error(
      `${LOG_PREFIX} Abbruch (fail-closed): die Besitz-Erklaerung der Vorlage traegt nicht (${befund.fehler.length} Fehler). Was nicht verlaesslich verglichen werden kann, wird nicht geschrieben. NICHTS gesendet.`,
    );
    return 1;
  }

  const schreibbar = befund.abweichungen.filter(istSchreibbar);
  const rest = befund.abweichungen.filter((abweichung) => !istSchreibbar(abweichung));
  const danach = vergleicheBesitz({ vorlage, live: simuliereSchreiben({ live, schreibbar }) });
  const koerper = bauePatchKoerper(schreibbar);
  meldePlan({ agentId, befund, schreibbar, rest, danach });
  meldeKoerper(koerper);

  if (!ausfuehren) {
    console.log(
      `${LOG_PREFIX} TROCKENLAUF - nichts gesendet, der Live-Agent ist unveraendert. Zum wirklichen Schreiben: npm run elevenlabs:push -- ${BESTAETIGUNGS_FLAG}`,
    );
    return 0;
  }
  return await fuehreAus({ agentId, vorlage, befund, schreibbar, danach, koerper });
}

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  try {
    process.exit(await runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Abbruch (fail-closed): ${ohneSchluessel(err.message)}`);
    process.exit(1);
  }
}
