import { readFileSync } from "node:fs";

import { Instrumenter } from "@stryker-mutator/instrumenter";

import { MAX_PAKETE } from "./entscheiden.mjs";

const MAX_MUTANTEN_JE_PAKET = 3000;
export const SCHWELLE_MINUTEN = 270;
export const ANTEIL_TESTLAUF_JE_MUTANT = 0.6;
const SEKUNDEN_JE_MINUTE = 60;
const SCHWELLE_SEKUNDEN = SCHWELLE_MINUTEN * SEKUNDEN_JE_MINUTE;
const STILL = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};
const OPTIONEN = { plugins: null, ignorers: [], excludedMutations: [], noHeader: false };

async function geschaetzteMutanten(datei) {
  const content = readFileSync(datei, "utf8");
  const quelle = { name: datei, content, mutate: true };
  try {
    const { mutants } = await new Instrumenter(STILL).instrument([quelle], OPTIONEN);
    return mutants.map(({ location: { start, end } }) => [start.line + 1, end.line + 1]);
  } catch {
    const ganzeDatei = [1, content.split("\n").length];
    return Array.from({ length: MAX_MUTANTEN_JE_PAKET }, () => ganzeDatei);
  }
}

export async function zaehle(dateien) {
  const zahlen = [];
  for (const datei of dateien) {
    const orte = await geschaetzteMutanten(datei);
    zahlen.push({ datei, mutanten: orte.length, orte });
  }
  return zahlen;
}

export function geschaetzteSekunden(mutanten, sekundenJeTestlauf) {
  return sekundenJeTestlauf * (1 + ANTEIL_TESTLAUF_JE_MUTANT * mutanten);
}

function bloecke(orte) {
  const liste = [];
  for (const [von, bis] of orte.toSorted(([links], [rechts]) => links - rechts)) {
    const letzter = liste.at(-1);
    if (letzter !== undefined && von <= letzter.bis) {
      letzter.bis = Math.max(letzter.bis, bis);
      letzter.mutanten += 1;
    } else liste.push({ von, bis, mutanten: 1 });
  }
  return liste;
}

function schneide({ datei, orte }, sekundenJeTestlauf) {
  const teile = [];
  for (const block of bloecke(orte)) {
    const letzter = teile.at(-1);
    const zusammen = (letzter?.mutanten ?? Infinity) + block.mutanten;
    if (geschaetzteSekunden(zusammen, sekundenJeTestlauf) <= SCHWELLE_SEKUNDEN) {
      letzter.mutanten = zusammen;
    } else teile.push({ von: block.von, mutanten: block.mutanten });
  }
  return teile.map(({ von, mutanten }, nummer) => ({
    mutanten,
    sekunden: geschaetzteSekunden(mutanten, sekundenJeTestlauf),
    dateien: [datei],
    teil: {
      von: nummer === 0 ? 1 : von,
      bis: nummer + 1 < teile.length ? teile[nummer + 1].von - 1 : null,
    },
  }));
}

export function packe(zahlen, sekundenJeTestlauf) {
  const pakete = [];
  const geteilt = [];
  const sekunden = ({ mutanten }) => geschaetzteSekunden(mutanten, sekundenJeTestlauf);
  const absteigend = zahlen.toSorted((links, rechts) => rechts.mutanten - links.mutanten);
  for (const eintrag of absteigend) {
    if (sekunden(eintrag) > SCHWELLE_SEKUNDEN) {
      geteilt.push(...schneide(eintrag, sekundenJeTestlauf));
      continue;
    }
    const passend = pakete.find(
      (paket) =>
        paket.mutanten + eintrag.mutanten <= MAX_MUTANTEN_JE_PAKET &&
        paket.sekunden + sekunden(eintrag) <= SCHWELLE_SEKUNDEN,
    );
    if (passend === undefined)
      pakete.push({
        mutanten: eintrag.mutanten,
        sekunden: sekunden(eintrag),
        dateien: [eintrag.datei],
      });
    else {
      passend.mutanten += eintrag.mutanten;
      passend.sekunden += sekunden(eintrag);
      passend.dateien.push(eintrag.datei);
    }
  }
  const alle = [...pakete, ...geteilt];
  if (alle.length > MAX_PAKETE) {
    throw new Error(
      `Zu viel auf einmal geändert: die Messung bräuchte ${alle.length} Pakete, höchstens ${MAX_PAKETE} sind erlaubt. In kleineren Pushes ausmisten.`,
    );
  }
  return alle.map((paket) => ({
    ...paket,
    sekunden: Math.round(paket.sekunden),
    dateien: paket.dateien.toSorted(),
  }));
}
