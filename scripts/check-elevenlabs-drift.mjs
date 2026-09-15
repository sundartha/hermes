#!/usr/bin/env node
// Drift-Gate zwischen der Repo-Vorlage und dem LIVE-Agenten bei ElevenLabs.
//
// WARUM ES DAS GIBT: Vorlage und Live-Agent sind auseinandergelaufen, und
// NICHTS hat es bemerkt - es fiel nur auf, weil ein Test in einen Timeout lief.
// Ein Vergleich, der erst durch einen Zufallsbefund entsteht, ist keiner.
//
// DIESES SKRIPT LIEST NUR (GET). Es patcht den Live-Agenten NICHT - das
// Reparieren ist ein eigenes Kommando (npm run elevenlabs:push), und dass
// dieses hier gar nicht schreiben KANN, ist am Import-Graphen ablesbar: es
// haengt ausschliesslich an lib/elevenlabs-agent-lesen.mjs, das kein PATCH
// kennt.
//
// WAS verglichen wird (nur besessene Felder), WIE (die vier Arten) und WARUM
// nicht alles: s. lib/elevenlabs-besitz.mjs und die Besitz-Erklaerung
// _besitz in der Vorlage selbst. Hier steht nur die Huelle: Argumente, Ausgabe,
// Exit-Code.
//
// FAIL-CLOSED, weil ein gruenes Pruefkommando, das nichts geprueft hat, wie ein
// bestandenes aussieht: ohne Schluessel, ohne erreichbare API, ohne
// Besitz-Erklaerung oder bei einem besessenen Pfad, den die Vorlage gar nicht
// hat, endet der Lauf mit einer Meldung und Exit 1 - nie mit OK. Seit
// 2026-08-17 zaehlt dazu auch der UMFANG selbst: der Lauf blockiert, wenn
// weniger Felder verglichen oder weniger Verbote angewandt wurden, als die
// Besitz-Erklaerung fuehrt (istUnvollstaendig), und wenn eine Ausnahme aelter
// ist als ihre Hoechstfrist (istBlockierend).
//
// istBlockierend ist exportiert, damit die Entscheidung selbst messbar ist -
// sie ist der einzige Ort, an dem "gemeldet" zu "der Lauf faellt durch" wird,
// und ohne Export waere sie nur ueber einen echten Anruf beim Anbieter zu
// pruefen.
//
// Aufruf:  npm run elevenlabs:drift            (Live-Agent, s. LIVE_AGENT_ID)
//          npm run elevenlabs:drift -- <agent_id>
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LIVE_AGENT_ID,
  holeLiveAgenten,
  ladeVorlage,
  ohneSchluessel,
  schluesselFehlt,
} from "./lib/elevenlabs-agent-lesen.mjs";
import { nichtBesessen, vergleicheBesitz } from "./lib/elevenlabs-besitz.mjs";

const ARG_INDEX_AGENT_ID = 2;
const LISTEN_TRENNER = "; ";
const LOG_PREFIX = "[check-elevenlabs-drift]";

// Ausgenommene Abweichungen bleiben SICHTBAR - sie werden oben mitgedruckt wie
// jede andere, und dass man sie sieht, ist ihr Zweck. Sie blockieren aber seit
// 2026-08-15 NICHT mehr: als blockierender CI-Schritt (Auftrag Phase 2, TEIL 2)
// waere ein Lauf, der wegen einer festgehaltenen Eigentuemer-Entscheidung
// dauerhaft rot bleibt, binnen einer Woche ignoriert - ein Waechter, den man
// ignoriert, ist keiner. Blockierend bleibt JEDE ANDERE Abweichung, jede
// verletzte Regel und jeder Fehler in der Besitz-/Regel-Erklaerung - seit
// 2026-08-17 zusaetzlich ein unvollstaendiger Lauf und eine ueberfaellige
// Ausnahme; s. istBlockierend. Eine UNVOLLSTAENDIGE Ausnahme (Grund oder Datum fehlt/leer)
// entschuldigt nichts - sie erreicht abweichungen[] gar nicht erst, sondern
// wird schon im Vergleichs-Kern zu einem Eintrag in fehler[]
// (ausnahmeFormFehler in scripts/lib/elevenlabs-besitz.mjs), und Fehler
// blockieren immer.
function ausnahmeZusatz(abweichungen) {
  const anzahl = abweichungen.filter((abweichung) => abweichung.ausgenommen).length;
  if (anzahl === 0) return "";
  return ` (davon ${anzahl} in der Vorlage bewusst ausgenommen, mit Grund und Datum an der Zeile - kein Defekt, sondern eine festgehaltene Entscheidung)`;
}

// Der Umfang des Laufs als Satz - Ist gegen Soll, in beiden Achsen. Steht an
// EINER Stelle, weil er in jede der drei Schlussmeldungen gehoert: eine
// Zahl, die nur im roten Fall gedruckt wird, belegt den gruenen nicht.
function umfangsZeile({ geprueft, felderSoll, regelnAngewandt, regelnSoll, geprueftRegeln }) {
  return `${geprueft} von ${felderSoll} besessenen Feldern wirklich verglichen, ${regelnAngewandt} von ${regelnSoll} Verboten wirklich angewandt (${geprueftRegeln} Pruefungen Regel x Eintrag)`;
}

// Unvollstaendig heisst: die Besitz-Erklaerung fuehrt mehr Felder oder mehr
// Verbote, als gegen den Live-Agenten gehalten werden konnten. Der Sollwert ist
// nicht geraten und steht nicht hier - er ist die Laenge der Listen in der
// Erklaerung selbst. "> 0" wuerde NICHT genuegen: 28 von 29 verglichenen Feldern
// oder ein Verbot, das auf einen leeren Live-Bereich trifft, saehen sonst aus
// wie ein vollstaendiger Lauf. Warum das blockiert: ein Waechter, der meldet
// "geprueft" und dabei eine Stelle gar nicht angesehen hat, ist genau der
// Ausfall, gegen den dieses Kommando gebaut ist.
function istUnvollstaendig({ geprueft, felderSoll, regelnAngewandt, regelnSoll }) {
  return geprueft < felderSoll || regelnAngewandt < regelnSoll;
}

// Blockierend ist NICHT dasselbe wie ergebnis.ok: ok (der Vergleichs-Kern)
// heisst byte-identisch, und eine bewusst ausgenommene Abweichung ist das nie
// (s. den Kern-Test "ausgenommen heisst nicht gruen",
// test/elevenlabs-push-feldauswahl.test.js). Blockierend heisst dagegen "der
// CI-Schritt darf durchfallen" - und dafuer zaehlt eine mit Grund UND Datum
// festgehaltene Eigentuemer-Entscheidung nicht als Defekt, jede andere
// Abweichung, jede Verbots-Verletzung und jeder Erklaerungs-Fehler aber schon.
//
// Eine UEBERFAELLIGE Ausnahme blockiert - im Unterschied zur gueltigen, die
// bewusst nur gemeldet wird: sie deckt einen Zustand, den der Eigentuemer will
// und deshalb dauerhaft rot liesse, waehrend die ueberfaellige zwei Ausgaenge
// hat, die beide Minuten kosten (Feld zurueckdrehen ODER Ausnahme mit neuem
// Datum und Grund erneuern) und damit rot bis zu einer Entscheidung ist statt
// Dauerrot. Was hier verfaellt, sind Entscheidungen ueber die Gespraeche
// fremder Menschen (heute: die Aufbewahrung).
//
// Eine NICHT PRUEFBARE Stelle blockiert ebenfalls und ist ausdruecklich NICHT
// dasselbe wie eine ausgenommene Abweichung: ausgenommen heisst "gemessen und
// bewusst so", nicht pruefbar heisst "gar nicht gemessen".
export function istBlockierend(ergebnis) {
  const { abweichungen, verletzungen, fehler, veralteteAusnahmen } = ergebnis;
  return (
    fehler.length > 0 ||
    verletzungen.length > 0 ||
    veralteteAusnahmen.length > 0 ||
    istUnvollstaendig(ergebnis) ||
    abweichungen.some((abweichung) => !abweichung.ausgenommen)
  );
}

// Der gruene Ausgang. Beide Umfangs-Zahlen stehen auch hier: ein Pruefkommando,
// das nichts findet, sieht sonst aus wie eines, das nichts sucht.
function meldeGruen({ ergebnis, agentId }) {
  const { abweichungen } = ergebnis;
  if (abweichungen.length === 0) {
    console.log(
      `${LOG_PREFIX} OK - alle besessenen Felder stimmen mit dem Live-Agenten ${agentId} ueberein: ${umfangsZeile(ergebnis)}, keine Verbots-Verletzung.`,
    );
    return 0;
  }
  // Gruen trotz Abweichung: ALLE gemeldeten Abweichungen sind bewusst
  // ausgenommen (Zeilen oben) - blockiert nicht, vergessen wird trotzdem
  // nichts, weil die Zeilen weiter gedruckt werden.
  console.log(
    `${LOG_PREFIX} OK - ${abweichungen.length} besessene Felder weichen vom Live-Agenten ${agentId} ab, ALLE mit Grund und Datum bewusst ausgenommen (Zeilen oben) und deshalb kein Blocker: ${umfangsZeile(ergebnis)}, keine Verbots-Verletzung.`,
  );
  return 0;
}

function melde({ ergebnis, agentId, ausserhalb }) {
  const { abweichungen, verletzungen, fehler, nichtPruefbar, veralteteAusnahmen } = ergebnis;
  const zeilen = [
    ...fehler,
    ...verletzungen,
    ...nichtPruefbar,
    ...veralteteAusnahmen,
    ...abweichungen.map((abweichung) => abweichung.zeile),
  ];
  for (const zeile of zeilen) {
    console.error(`${LOG_PREFIX} ${zeile}`);
  }
  if (ausserhalb.length > 0) {
    console.log(
      `${LOG_PREFIX} nicht verglichen, weil die Vorlage es nicht besitzt: ${ausserhalb.join(LISTEN_TRENNER)}`,
    );
  }
  if (!istBlockierend(ergebnis)) return meldeGruen({ ergebnis, agentId });
  console.error(
    `${LOG_PREFIX} ROT - ${abweichungen.length} besessene Felder weichen ab${ausnahmeZusatz(abweichungen)}, ${verletzungen.length} Verbots-Verletzungen, ${nichtPruefbar.length} nicht pruefbare Stellen, ${veralteteAusnahmen.length} ueberfaellige Ausnahmen, ${fehler.length} Fehler in der Besitz-/Regel-Erklaerung | ${umfangsZeile(ergebnis)}. Der Live-Agent wurde NICHT veraendert; das Reparieren ist eine eigene Entscheidung (npm run elevenlabs:push).`,
  );
  return 1;
}

async function runCli() {
  const schluesselGrund = schluesselFehlt();
  if (schluesselGrund) {
    console.error(
      `${LOG_PREFIX} Fehler (fail-closed): ${schluesselGrund} Ungelesen wird nichts als gruen gemeldet.`,
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
