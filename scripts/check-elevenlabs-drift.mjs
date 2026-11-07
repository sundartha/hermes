#!/usr/bin/env node
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

function ausnahmeZusatz(abweichungen) {
  const anzahl = abweichungen.filter((abweichung) => abweichung.ausgenommen).length;
  if (anzahl === 0) return "";
  return ` (davon ${anzahl} in der Vorlage bewusst ausgenommen, mit Grund und Datum an der Zeile - kein Defekt, sondern eine festgehaltene Entscheidung)`;
}

function umfangsZeile({ geprueft, felderSoll, regelnAngewandt, regelnSoll, geprueftRegeln }) {
  return `${geprueft} von ${felderSoll} besessenen Feldern wirklich verglichen, ${regelnAngewandt} von ${regelnSoll} Verboten wirklich angewandt (${geprueftRegeln} Pruefungen Regel x Eintrag)`;
}

function istUnvollstaendig({ geprueft, felderSoll, regelnAngewandt, regelnSoll }) {
  return geprueft < felderSoll || regelnAngewandt < regelnSoll;
}

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

function meldeGruen({ ergebnis, agentId }) {
  const { abweichungen } = ergebnis;
  if (abweichungen.length === 0) {
    console.log(
      `${LOG_PREFIX} OK - alle besessenen Felder stimmen mit dem Live-Agenten ${agentId} ueberein: ${umfangsZeile(ergebnis)}, keine Verbots-Verletzung.`,
    );
    return 0;
  }
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
