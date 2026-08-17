#!/usr/bin/env node
// Schreibt die BESESSENEN Felder der Repo-Vorlage auf den LIVE-Agenten bei
// ElevenLabs - das Gegenstueck zum lesenden Gate (npm run elevenlabs:drift).
//
// WARUM ES DAS GIBT: bis heute gab es fuer eine gemeldete Abweichung nur zwei
// Wege - Handarbeit im Dashboard oder ein Wegwerf-Spike. Beides ist nicht
// wiederholbar und hinterlaesst keine Spur, welcher Wert warum gesetzt wurde.
//
// DIE SIEBEN RIEGEL, in der Reihenfolge ihrer Wichtigkeit:
//
// 1. GESPERRTE FELDER. retention_days und record_voice werden NIE geschrieben,
//    in KEINE Richtung - weder als genanntes Feld (Abbruch vor jedem
//    Netzzugriff) noch als blinder Passagier im fertigen Patch-Koerper
//    (Abbruch vor dem PATCH). Begruendung an GESPERRTE_FELDER.
// 2. KEIN BLINDER PASSAGIER. Jeder Blatt-Pfad des fertigen Koerpers muss unter
//    einem Pfad liegen, den der Lauf ausdruecklich zum Schreiben gewaehlt hat.
//    Geprueft wird der KOERPER, nicht die Absicht, die ihn gebaut hat - sonst
//    belegte die Pruefung nur, dass die Eingabe die Eingabe ist.
// 3. TROCKENLAUF IST DER NORMALFALL. Ohne den ausdruecklichen Schalter
//    --ausfuehren wird NICHTS geschrieben; ein versehentlicher Aufruf zeigt nur
//    an. Der Schalter existiert nur als Argument - es gibt keine Env-Variable
//    und keine Datei, die ihn setzen koennte, damit er nicht aus Versehen in
//    einer Automatisierung landet.
// 4. NUR BESESSENE PFADE. Geschrieben wird ausschliesslich an den Live-Pfaden
//    aus _besitz.felder der Vorlage, und der Patch-Koerper wird AUS DIESEN
//    PFADEN gebaut - er kann gar nichts anderes enthalten. In diesem Projekt
//    hat schon einmal ein Provisionierer die ganze Live-Konfiguration aus
//    lokalen Werten geschrieben und Dashboard-Einstellungen zerstoert; genau
//    dieser Weg ist hier baulich versperrt (kein "ganze Config hochladen").
// 5. NUR DIE BENANNTEN FELDER. Mit --felder=<feld,feld> wird genau gesagt, was
//    geschrieben werden darf; jedes andere besessene Feld bleibt unberuehrt,
//    auch wenn es abweicht. Das ist die Grundfunktion und keine Erweiterung:
//    "abweichend" heisst nicht "soll geaendert werden". Die Aufbewahrungs-Felder
//    etwa stehen am Live-Agenten bewusst anders als in der Vorlage - ein Push,
//    der sie als Nebenwirkung mitnimmt, dreht eine Entscheidung um, die niemand
//    zur Abstimmung gestellt hat. Ein unbekannter Feldname bricht ab: eine
//    Auswahl, die Tippfehler verschluckt, schuetzt nicht.
//    DAMIT DAS NICHT AN DER AUFMERKSAMKEIT DES AUFRUFERS HAENGT, kann die
//    Vorlage ein Feld selbst sperren: ein Besitz-Eintrag mit "ausgenommen"
//    (Grund + Datum) ist ohne ausdrueckliche Nennung NIE Schreib-Kandidat,
//    auch nicht im Lauf ohne --felder. Genannt wird er geschrieben - die
//    Ausnahme ist ein Riegel gegen Unachtsamkeit, kein Verbot; das Umdrehen
//    bleibt moeglich, es muss nur jemand tippen und sieht dabei die Meldung.
//    NICHT fuer die gesperrten Felder (Riegel 1): die sind nicht nennbar, ihre
//    Ausnahme laesst sich mit diesem Werkzeug ueberhaupt nicht uebersteuern.
// 6. LESEN, VERGLEICHEN, DANN SCHREIBEN. Erst GET des Live-Agenten, dann der
//    gemeinsame Besitz-Vergleich, dann ein PATCH nur der abweichenden Pfade.
//    Ein Feld, das schon stimmt, wird nicht angefasst.
// 7. FAIL-CLOSED. Fehlender Schluessel, unlesbare oder unparsebare Vorlage,
//    eine Besitz-Erklaerung, die nicht traegt, eine verletzte Regel der Vorlage
//    oder ein unverstandenes Argument: Abbruch mit Exit 1, ohne jeden
//    Schreibversuch.
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
// Aufruf:  npm run elevenlabs:push                        (Trockenlauf, alle Felder Kandidat)
//          npm run elevenlabs:push -- <agent_id>          (Trockenlauf, anderer Agent)
//          npm run elevenlabs:push -- --felder=prompt     (Trockenlauf, nur dieses Feld)
//          npm run elevenlabs:push -- --felder=prompt --ausfuehren   (schreibt wirklich)
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
  PFAD_TRENNER,
  PFAD_VERBINDER,
  besesseneFeldNamen,
  setzeAnPfad,
  vergleicheBesitz,
} from "./lib/elevenlabs-besitz.mjs";

const LOG_PREFIX = "[push-elevenlabs]";
// Der einzige Schalter, der schreibt. Ausgeschrieben und ohne Kurzform: ein
// einzelnes vertipptes Zeichen soll keinen Live-Agenten veraendern.
const BESTAETIGUNGS_FLAG = "--ausfuehren";
// Der Schalter, der die zu schreibenden Felder benennt. Wert am selben Token
// (--felder=a,b) und nicht als naechstes Argument: ein getrenntes Argument
// waere von der Agenten-Kennung nicht zu unterscheiden, und ein vergessener
// Wert wuerde dann still den falschen Agenten adressieren.
const FELDER_FLAG = "--felder";
const FLAG_PRAEFIX = "--";
const WERT_TRENNER = "=";
const FELDER_TRENNER = ",";
const ARG_START = 2;
const LISTEN_TRENNER = ", ";
// Grosszuegiger als der Lese-Abruf: der Patch traegt den vollen System-Prompt.
const SCHREIB_TIMEOUT_MS = 30000;

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

// --- Argumente ---

// Zerlegt ein Schalter-Token an der ERSTEN Gleichheits-Stelle; ein Wert darf
// selbst "=" enthalten. wert === null heisst "ohne Wert geschrieben" und ist
// etwas anderes als ein leerer Wert: "--felder" ist ein vergessener Wert,
// "--felder=" eine leere Liste - beides ein Fehler, aber nicht dasselbe.
function zerlegeSchalter(token) {
  const stelle = token.indexOf(WERT_TRENNER);
  if (stelle < 0) return { name: token, wert: null };
  return { name: token.slice(0, stelle), wert: token.slice(stelle + 1) };
}

function feldNamenAus(wert) {
  return (wert ?? "")
    .split(FELDER_TRENNER)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

function mitFehler(stand, fehler) {
  return { ...stand, fehler: [...stand.fehler, fehler] };
}

// EIN Schalter, auf den bisherigen Stand angewandt - liefert den neuen Stand,
// ohne den alten zu veraendern. Alles Unverstandene wird zu einem Eintrag in
// fehler[], nie zu einem stillen Ueberspringen: wer "--ausfuehren=true" oder
// "--Felder=prompt" tippt, meint etwas, und ein Werkzeug, das solche Absicht
// wortlos verschluckt, schreibt am Ende etwas anderes als das Gemeinte.
function wendeSchalterAn(stand, token) {
  const { name, wert } = zerlegeSchalter(token);
  if (name === BESTAETIGUNGS_FLAG) {
    if (wert !== null)
      return mitFehler(stand, `${token} - ${BESTAETIGUNGS_FLAG} nimmt keinen Wert`);
    return { ...stand, ausfuehren: true };
  }
  if (name === FELDER_FLAG) {
    const namen = feldNamenAus(wert);
    if (namen.length === 0) {
      return mitFehler(
        stand,
        `${token} - ${FELDER_FLAG} braucht mindestens einen Feldnamen, z.B. ${FELDER_FLAG}=prompt${FELDER_TRENNER}language`,
      );
    }
    return { ...stand, auswahl: [...(stand.auswahl ?? []), ...namen] };
  }
  return mitFehler(
    stand,
    `${token} - unbekannter Schalter (bekannt: ${BESTAETIGUNGS_FLAG}, ${FELDER_FLAG}=<feld${FELDER_TRENNER}feld>)`,
  );
}

// Freies Argument = Agenten-Kennung, Schalter = Verhalten. auswahl === null
// heisst "keine Auswahl getroffen" (jedes abweichende schreibbare Feld ist
// Kandidat) - eine leere Liste kann es nicht geben, die waere ein Fehler.
function leseArgumente(argv) {
  const argumente = argv.slice(ARG_START);
  const frei = argumente.filter((wert) => !wert.startsWith(FLAG_PRAEFIX));
  const schalter = argumente.filter((wert) => wert.startsWith(FLAG_PRAEFIX));
  const start = { ausfuehren: false, auswahl: null, fehler: [] };
  const stand = schalter.reduce(wendeSchalterAn, start);
  return { ...stand, agentId: frei[0] || LIVE_AGENT_ID };
}

// Die Auswahl gegen die Besitz-Erklaerung der Vorlage. Ein Name, den die
// Vorlage nicht fuehrt, ist ein Abbruchgrund: still ignoriert wuerde er zu
// "dieses Feld weicht eben nicht ab" - und der Aufrufer glaubte, er haette
// etwas geschrieben.
function unbekannteFelder(auswahl, vorlage) {
  const bekannt = new Set(besesseneFeldNamen(vorlage));
  return auswahl.filter((feld) => !bekannt.has(feld));
}

// Gewaehlt ist ein Feld, wenn die Auswahl es ausdruecklich nennt - oder wenn es
// gar keine Auswahl gibt UND die Vorlage es nicht ausgenommen hat. Die Ausnahme
// wirkt damit genau gegen den unbedachten Lauf: "alles, was abweicht" nimmt sie
// nicht mit, ein ausdruecklich getippter Feldname schon. Sie ist ein Riegel
// gegen Unachtsamkeit, kein Verbot - wer die festgehaltene Entscheidung
// umdrehen will, muss sie beim Namen nennen und sieht dabei die Meldung
// "AUSNAHME UEBERSTIMMT".
function istGewaehlt(auswahl, abweichung) {
  if (auswahl !== null) return auswahl.includes(abweichung.feld);
  return !abweichung.ausgenommen;
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

// Die abweichenden Felder in vier Toepfe, aus denen die ganze weitere Arbeit
// folgt: was geschrieben wird, was die Vorlage vorerst ausnimmt, was die
// Feldauswahl auslaesst und was gar nicht schreibbar ist. Sie getrennt zu
// halten ist der Punkt der Uebung - "nicht angefasst, weil die Vorlage es
// ausnimmt", "nicht angefasst, weil nicht gewaehlt" und "nicht angefasst, weil
// unmoeglich" sind verschiedene Sachverhalte, und nur die ersten beiden sind
// Entscheidungen, die jemand getroffen hat.
export function teileAbweichungen({ abweichungen, auswahl }) {
  const kandidaten = abweichungen.filter(istSchreibbar);
  const uebergangen = kandidaten.filter((abweichung) => !istGewaehlt(auswahl, abweichung));
  return {
    schreibbar: kandidaten.filter((abweichung) => istGewaehlt(auswahl, abweichung)),
    ausgenommen: uebergangen.filter((abweichung) => abweichung.ausgenommen),
    ausgelassen: uebergangen.filter((abweichung) => !abweichung.ausgenommen),
    rest: abweichungen.filter((abweichung) => !istSchreibbar(abweichung)),
  };
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

// --- Riegel am fertigen Koerper (Riegel 1 und 2) ---

// DIE SPERRLISTE. Diese zwei Felder schreibt dieses Werkzeug NIE - unabhaengig
// davon, in welche Richtung der Wert ginge.
//
// WARUM GENAU DIESE ZWEI: sie tragen die Eigentuemer-Entscheidung vom
// 2026-08-15 - Aufbewahrung (retention_days) und Mitschnitt (record_voice)
// bleiben vorerst AN, solange an echten Anrufen gemessen wird; VOR DEM ERSTEN
// FREMDKUNDEN wird auf G7 zurueckgedreht. Beides sind keine
// Konfigurationsfragen, sondern Aussagen darueber, was mit den Gespraechen
// echter Menschen geschieht. Reist so ein Feld versehentlich mit, ist der
// Schaden nicht "falscher Wert", sondern ein Rechtsproblem - und ein
// versehentliches ABschalten waere genauso falsch wie ein versehentliches
// Anschalten, deshalb sperrt die Liste beide Richtungen.
//
// WARUM ZUSAETZLICH ZUR AUSNAHME IN DER VORLAGE: die Ausnahme ("ausgenommen",
// Riegel 5) ist ein Riegel gegen Unachtsamkeit und laesst sich durch Nennung
// uebersteuern - sie schuetzt gegen den unbedachten Lauf, nicht gegen den
// falschen Tastendruck und nicht gegen einen kuenftigen Umbau, der den Koerper
// anders baut. Diese Liste laesst sich nicht uebersteuern; das Zurueckdrehen
// auf G7 geschieht bewusst ausserhalb dieses Werkzeugs und damit von Hand.
const GESPERRTE_FELDER = ["retention_days", "record_voice"];

function istZweig(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

// Die BLATT-Pfade eines fertigen Koerpers, aus dem Koerper selbst gelesen und
// nicht aus der Absicht, die ihn gebaut hat. Nur so ist der Umriss ein Beleg:
// eine Liste, die aus den Eingabe-Pfaden abgeleitet waere, bewiese lediglich,
// dass die Eingabe die Eingabe ist. Eine Liste ist ein Blatt, kein Zweig - sie
// wird als GANZES gesetzt.
function blattPfade(wert, praefix) {
  if (!istZweig(wert)) return [praefix];
  return Object.entries(wert).flatMap(([schluessel, kind]) => {
    const pfad = praefix === "" ? schluessel : `${praefix}${PFAD_TRENNER}${schluessel}`;
    return blattPfade(kind, pfad);
  });
}

// RIEGEL 1a: die AUSDRUECKLICHE Nennung. Greift am fruehesten Punkt, an dem die
// Absicht ueberhaupt sichtbar ist - vor dem Laden der Vorlage und vor jedem
// Netzzugriff.
function gesperrteInAuswahl(auswahl) {
  if (auswahl === null) return [];
  return auswahl.filter((feld) => GESPERRTE_FELDER.includes(feld));
}

// RIEGEL 1b, der wichtigere: ein gesperrter Name als SCHLUESSEL irgendwo im
// fertigen Koerper. Er faengt den Fall, in dem das Feld MITREIST, ohne genannt
// worden zu sein. Sieht anders als blattPfade auch in Listen hinein: ein
// Riegel, der eine Ablageform auslaesst, ist keiner - und welche Form der
// Anbieter morgen erwartet, entscheidet nicht dieses Werkzeug.
function gesperrteStellen(wert, praefix) {
  if (wert === null || typeof wert !== "object") return [];
  const eintraege = Array.isArray(wert)
    ? wert.map((kind, i) => [String(i), kind])
    : Object.entries(wert);
  return eintraege.flatMap(([schluessel, kind]) => {
    const pfad = praefix === "" ? schluessel : `${praefix}${PFAD_TRENNER}${schluessel}`;
    const treffer = GESPERRTE_FELDER.includes(schluessel) ? [pfad] : [];
    return [...treffer, ...gesperrteStellen(kind, pfad)];
  });
}

// RIEGEL 2: die Pfade, die dieser Lauf ueberhaupt beruehren darf - abgeleitet
// aus der AUSWAHL des Aufrufers, nicht aus dem Koerper. Beide Seiten der
// Pruefung getrennt zu gewinnen ist der ganze Punkt: der Koerper sagt, was
// gesendet wuerde, die Auswahl sagt, was verlangt wurde.
function erlaubtePfade({ abweichungen, auswahl }) {
  return abweichungen
    .filter((abweichung) => istGewaehlt(auswahl, abweichung))
    .flatMap((abweichung) => abweichung.livePfade);
}

// Ein Blatt-Pfad zaehlt als gedeckt, wenn er der erlaubte Pfad selbst ist ODER
// unter ihm liegt: ein besessener Wert kann ein Objekt sein (z.B. die
// Uebersteuerungs-Erlaubnisse), und dann traegt der Koerper unterhalb des
// erlaubten Pfades weitere Blaetter. Sie gehoeren zum selben gesetzten Wert.
function liegtUnter(pfad, erlaubt) {
  return pfad === erlaubt || pfad.startsWith(`${erlaubt}${PFAD_TRENNER}`);
}

function blindePassagiere({ koerper, erlaubt }) {
  const gedeckt = (pfad) => erlaubt.some((pfadDerAuswahl) => liegtUnter(pfad, pfadDerAuswahl));
  return blattPfade(koerper, "").filter((pfad) => !gedeckt(pfad));
}

// Die Pruefung des FERTIGEN Koerpers an EINER Stelle: was hier durchkommt, ist
// genau das, was den Anbieter erreichen wuerde. Liefert Befunde; eine leere
// Liste heisst sauber. Kein Filtern, kein Ueberspringen - der Aufrufer bricht
// ab, sobald hier etwas steht (fail-closed).
export function koerperVerstoesse({ koerper, abweichungen, auswahl }) {
  const befunde = [];
  const gesperrt = gesperrteStellen(koerper, "");
  if (gesperrt.length > 0) {
    befunde.push(
      `GESPERRT - der Patch-Koerper traegt gesperrte Felder an: ${gesperrt.join(LISTEN_TRENNER)}. Gesperrt sind ${GESPERRTE_FELDER.join(LISTEN_TRENNER)}; sie werden nie geschrieben, in keine Richtung.`,
    );
  }
  const fremd = blindePassagiere({ koerper, erlaubt: erlaubtePfade({ abweichungen, auswahl }) });
  if (fremd.length > 0) {
    befunde.push(
      `BLINDER PASSAGIER - der Patch-Koerper traegt Pfade, die kein gewaehltes Feld verlangt hat: ${fremd.join(LISTEN_TRENNER)}.`,
    );
  }
  return befunde;
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

// Belegt die Riegel 2 und 3 an der AUSGABE statt nur im Kommentar: der Koerper,
// der gesendet wuerde, traegt genau diese Blatt-Pfade - was hier fehlt, kann den
// Agenten nicht erreichen. Steht auch im Trockenlauf da, damit die Zusage
// pruefbar ist, bevor jemand den Schalter setzt.
function meldeKoerper(koerper) {
  const pfade = blattPfade(koerper, "");
  if (pfade.length === 0) return;
  const groesse = JSON.stringify(koerper).length;
  console.log(
    `${LOG_PREFIX} PATCH-KOERPER - ${groesse} Zeichen, genau diese Blatt-Pfade und nichts sonst: ${pfade.join(LISTEN_TRENNER)}`,
  );
}

function meldeAusgelassen(ausgelassen) {
  if (ausgelassen.length === 0) return;
  meldeZeilen("AUSGELASSEN", ausgelassen);
  console.log(
    `${LOG_PREFIX} AUSGELASSEN heisst: dieses Feld weicht ab und waere schreibbar, steht aber nicht in ${FELDER_FLAG}. Es wird NICHT angefasst - "abweichend" ist keine Aufforderung, den Live-Wert umzudrehen.`,
  );
}

// Die ausgenommenen Felder tragen ihren Grund und ihr Datum MIT - eine Marke
// ohne Begruendung waere nur ein zweites "ist halt so", und genau die
// unbelegte Sonderbehandlung soll die Ausnahme ersetzen.
function meldeAusgenommen(ausgenommen) {
  if (ausgenommen.length === 0) return;
  for (const abweichung of ausgenommen) {
    const { grund, seit } = abweichung.ausgenommen;
    const zeile = `${feldZeile("AUSGENOMMEN", abweichung)} | ausgenommen seit ${seit}: ${grund}`;
    console.log(`${LOG_PREFIX} ${zeile}`);
  }
  console.log(
    `${LOG_PREFIX} AUSGENOMMEN heisst: die Vorlage nimmt dieses Feld ausdruecklich von Schreibvorgaengen aus (Feld "ausgenommen" am Besitz-Eintrag, mit Grund und Datum). Ohne Nennung in ${FELDER_FLAG} ist es NIE Schreib-Kandidat - ein unbedachter Lauf kann die festgehaltene Entscheidung nicht umdrehen. Wer sie umdrehen WILL, nennt das Feld ausdruecklich: ${FELDER_FLAG}=<feld>. NICHT so bei den gesperrten Feldern (${GESPERRTE_FELDER.join(LISTEN_TRENNER)}): die sind nicht nennbar, ihre Nennung bricht den Lauf ab.`,
  );
}

// Das Gegenstueck: eine Ausnahme, die ausdruecklich genannt wurde, wird
// geschrieben - aber nicht lautlos. Ohne diese Zeile saehe der Lauf, der eine
// bewusste Entscheidung umdreht, genauso aus wie jeder andere.
function meldeUebersteuerteAusnahmen(schreibbar) {
  const uebersteuert = schreibbar.filter((abweichung) => abweichung.ausgenommen);
  if (uebersteuert.length === 0) return;
  console.log(
    `${LOG_PREFIX} AUSNAHME UEBERSTIMMT - ${feldNamen(uebersteuert).join(LISTEN_TRENNER)}: in der Vorlage vorerst ausgenommen, aber in ${FELDER_FLAG} ausdruecklich genannt. Wird geschrieben; die Ausnahme ist ein Riegel gegen Unachtsamkeit, kein Verbot. Damit wird die festgehaltene Entscheidung umgedreht - die Vorlage sollte im selben Zug nachgezogen werden.`,
  );
}

function meldeAuswahl(auswahl) {
  if (auswahl === null) {
    console.log(
      `${LOG_PREFIX} FELDAUSWAHL - keine (${FELDER_FLAG} nicht gesetzt): jedes abweichende schreibbare Feld ist Kandidat, AUSSER den in der Vorlage ausgenommenen (s. AUSGENOMMEN).`,
    );
    return;
  }
  console.log(
    `${LOG_PREFIX} FELDAUSWAHL - nur ${auswahl.join(LISTEN_TRENNER)}. Jedes andere besessene Feld bleibt unberuehrt, auch wenn es abweicht.`,
  );
}

// Was der Lauf vorhat, bevor irgendetwas passiert - im Trockenlauf ist das das
// ganze Ergebnis, mit --ausfuehren die Ankuendigung.
function meldePlan({ agentId, befund, auswahl, felder, danach }) {
  const { schreibbar, ausgenommen, ausgelassen, rest } = felder;
  console.log(
    `${LOG_PREFIX} Agent ${agentId}: ${befund.geprueft} besessene Felder verglichen, ${befund.abweichungen.length} weichen ab (${schreibbar.length} zum Schreiben gewaehlt, ${ausgenommen.length} von der Vorlage vorerst ausgenommen, ${ausgelassen.length} durch die Feldauswahl ausgelassen, ${rest.length} nicht schreibbar).`,
  );
  meldeAuswahl(auswahl);
  for (const verletzung of befund.verletzungen) {
    console.error(`${LOG_PREFIX} ${verletzung}`);
  }
  meldeZeilen("WUERDE SCHREIBEN", schreibbar);
  meldeUebersteuerteAusnahmen(schreibbar);
  meldeAusgenommen(ausgenommen);
  meldeAusgelassen(ausgelassen);
  meldeNichtSchreibbar(rest);
  const uebrig = feldNamen(danach.abweichungen);
  const namen = uebrig.length > 0 ? `: ${uebrig.join(LISTEN_TRENNER)}` : "";
  console.log(
    `${LOG_PREFIX} VORHERSAGE - danach waeren noch ${uebrig.length} besessene Felder abweichend${namen} (trocken am gelesenen Live-Stand gerechnet, nichts gesendet).`,
  );
}

// --- Ablauf ---

// Ein fail-closed-Abbruch: erst die einzelnen Befunde, dann der Satz, der sagt,
// was daraus folgt, dann Exit-Code 1. EINE Stelle, damit die Zusage "NICHTS
// gesendet" nicht an vier Orten leicht verschieden formuliert wird.
function brichAb(befunde, schluss) {
  for (const zeile of befunde) console.error(`${LOG_PREFIX} ${zeile}`);
  console.error(`${LOG_PREFIX} Abbruch (fail-closed): ${schluss}`);
  return 1;
}

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
    console.log(
      `${LOG_PREFIX} Nichts zu schreiben - kein gewaehltes schreibbares Feld weicht ab. NICHTS gesendet.`,
    );
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

// argv als Parameter und nicht aus process gelesen: derselbe Ablauf laesst sich
// damit mit einer gestellten Kommandozeile durchspielen, ohne den Prozess zu
// verbiegen - und die Zusagen dieses Werkzeugs (Abbruch VOR dem Netz, der
// Trockenlauf schreibt nie) sind pruefbar statt behauptet.
export async function runCli(argv = process.argv) {
  const schluesselGrund = schluesselFehlt();
  if (schluesselGrund) {
    console.error(
      `${LOG_PREFIX} Abbruch (fail-closed): ${schluesselGrund} Ohne gelesenen Live-Stand wird nicht geschrieben.`,
    );
    return 1;
  }
  const { agentId, ausfuehren, auswahl, fehler } = leseArgumente(argv);
  if (fehler.length > 0) {
    return brichAb(fehler, `${fehler.length} Argumente nicht verstanden. NICHTS gesendet.`);
  }

  // Riegel 1a - so frueh wie moeglich: hier ist noch nichts geladen und nichts
  // gerufen, der Abbruch kann also gar nichts angefasst haben.
  const gesperrt = gesperrteInAuswahl(auswahl);
  if (gesperrt.length > 0) {
    return brichAb(
      [],
      `${FELDER_FLAG} nennt gesperrte Felder: ${gesperrt.join(LISTEN_TRENNER)}. Diese Felder schreibt dieses Werkzeug nie, in keine Richtung - Aufbewahrung und Mitschnitt sind eine Datenschutz-Entscheidung und keine Konfiguration (s. GESPERRTE_FELDER). NICHTS gesendet.`,
    );
  }

  const vorlage = ladeVorlage();
  const unbekannt = auswahl === null ? [] : unbekannteFelder(auswahl, vorlage);
  if (unbekannt.length > 0) {
    return brichAb(
      [],
      `${FELDER_FLAG} nennt Felder, die die Vorlage nicht besitzt: ${unbekannt.join(LISTEN_TRENNER)}. Besessen sind: ${besesseneFeldNamen(vorlage).join(LISTEN_TRENNER)}. NICHTS gesendet.`,
    );
  }

  const live = await holeLiveAgenten(agentId);
  const befund = vergleicheBesitz({ vorlage, live });
  if (befund.fehler.length > 0) {
    return brichAb(
      befund.fehler,
      `die Besitz-Erklaerung der Vorlage traegt nicht (${befund.fehler.length} Fehler). Was nicht verlaesslich verglichen werden kann, wird nicht geschrieben. NICHTS gesendet.`,
    );
  }

  const felder = teileAbweichungen({ abweichungen: befund.abweichungen, auswahl });
  const { schreibbar } = felder;
  const danach = vergleicheBesitz({ vorlage, live: simuliereSchreiben({ live, schreibbar }) });
  const koerper = bauePatchKoerper(schreibbar);
  meldePlan({ agentId, befund, auswahl, felder, danach });
  meldeKoerper(koerper);

  // Riegel 1b und 2 - am fertigen Koerper, nach der Ausgabe seiner Blatt-Pfade
  // und vor jeder Weiche: auch der Trockenlauf endet hier rot. Ein Koerper, den
  // dieses Werkzeug nicht senden darf, ist ein Befund und keine Fussnote.
  const verstoesse = koerperVerstoesse({ koerper, abweichungen: befund.abweichungen, auswahl });
  if (verstoesse.length > 0) {
    return brichAb(
      verstoesse,
      `der Patch-Koerper haelt der Pruefung nicht stand (${verstoesse.length} Befunde, oben genannt). Nicht gefiltert, nicht uebersprungen, nicht gewarnt - Halt. NICHTS gesendet.`,
    );
  }

  if (!ausfuehren) {
    console.log(
      `${LOG_PREFIX} TROCKENLAUF - nichts gesendet, der Live-Agent ist unveraendert. Zum wirklichen Schreiben: npm run elevenlabs:push -- ${FELDER_FLAG}=<feld> ${BESTAETIGUNGS_FLAG}`,
    );
    return 0;
  }
  return await fuehreAus({ agentId, vorlage, befund, schreibbar, danach, koerper });
}

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  try {
    process.exit(await runCli(process.argv));
  } catch (err) {
    console.error(`${LOG_PREFIX} Abbruch (fail-closed): ${ohneSchluessel(err.message)}`);
    process.exit(1);
  }
}
