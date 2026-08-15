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
// hat, endet der Lauf mit einer Meldung und Exit 1 - nie mit OK.
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
// verletzte Regel und jeder Fehler in der Besitz-/Regel-Erklaerung; s.
// istBlockierend. Eine UNVOLLSTAENDIGE Ausnahme (Grund oder Datum fehlt/leer)
// entschuldigt nichts - sie erreicht abweichungen[] gar nicht erst, sondern
// wird schon im Vergleichs-Kern zu einem Eintrag in fehler[]
// (ausnahmeFormFehler in scripts/lib/elevenlabs-besitz.mjs), und Fehler
// blockieren immer.
function ausnahmeZusatz(abweichungen) {
  const anzahl = abweichungen.filter((abweichung) => abweichung.ausgenommen).length;
  if (anzahl === 0) return "";
  return ` (davon ${anzahl} in der Vorlage bewusst ausgenommen, mit Grund und Datum an der Zeile - kein Defekt, sondern eine festgehaltene Entscheidung)`;
}

// Blockierend ist NICHT dasselbe wie ergebnis.ok: ok (der Vergleichs-Kern)
// heisst byte-identisch, und eine bewusst ausgenommene Abweichung ist das nie
// (s. den Kern-Test "ausgenommen heisst nicht gruen",
// test/elevenlabs-push-feldauswahl.test.js). Blockierend heisst dagegen "der
// CI-Schritt darf durchfallen" - und dafuer zaehlt eine mit Grund UND Datum
// festgehaltene Eigentuemer-Entscheidung nicht als Defekt, jede andere
// Abweichung, jede Verbots-Verletzung und jeder Erklaerungs-Fehler aber schon.
function istBlockierend({ abweichungen, verletzungen, fehler }) {
  return (
    fehler.length > 0 ||
    verletzungen.length > 0 ||
    abweichungen.some((abweichung) => !abweichung.ausgenommen)
  );
}

function regelPruefungsZeile(geprueftRegeln) {
  return `${geprueftRegeln} Verbots-Pruefungen (Regel x Eintrag) ohne Verletzung.`;
}

function melde({ ergebnis, agentId, ausserhalb }) {
  const { geprueft, geprueftRegeln, abweichungen, verletzungen, fehler } = ergebnis;
  const abweichungsZeilen = abweichungen.map((abweichung) => abweichung.zeile);
  const zeilen = [...fehler, ...verletzungen, ...abweichungsZeilen];
  for (const zeile of zeilen) {
    console.error(`${LOG_PREFIX} ${zeile}`);
  }
  if (ausserhalb.length > 0) {
    console.log(
      `${LOG_PREFIX} nicht verglichen, weil die Vorlage es nicht besitzt: ${ausserhalb.join(LISTEN_TRENNER)}`,
    );
  }
  // Beide Zahlen stehen auch im gruenen Fall da: ein Pruefkommando, das nichts
  // findet, sieht sonst aus wie eines, das nichts sucht.
  if (!istBlockierend({ abweichungen, verletzungen, fehler })) {
    if (abweichungen.length === 0) {
      console.log(
        `${LOG_PREFIX} OK - alle ${geprueft} besessenen Felder stimmen mit dem Live-Agenten ${agentId} ueberein, ${regelPruefungsZeile(geprueftRegeln)}`,
      );
      return 0;
    }
    // Gruen trotz Abweichung: ALLE gemeldeten Abweichungen sind bewusst
    // ausgenommen (Zeilen oben) - blockiert nicht, vergessen wird trotzdem
    // nichts, weil die Zeilen weiter gedruckt werden.
    console.log(
      `${LOG_PREFIX} OK - ${abweichungen.length} von ${geprueft} besessenen Feldern weichen vom Live-Agenten ${agentId} ab, ALLE mit Grund und Datum bewusst ausgenommen (Zeilen oben) und deshalb kein Blocker, ${regelPruefungsZeile(geprueftRegeln)}`,
    );
    return 0;
  }
  console.error(
    `${LOG_PREFIX} ROT - ${abweichungen.length} von ${geprueft} besessenen Feldern weichen ab${ausnahmeZusatz(abweichungen)}, ${verletzungen.length} von ${geprueftRegeln} Verbots-Pruefungen (Regel x Eintrag) verletzt, ${fehler.length} Fehler in der Besitz-/Regel-Erklaerung. Der Live-Agent wurde NICHT veraendert; das Reparieren ist eine eigene Entscheidung (npm run elevenlabs:push).`,
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
