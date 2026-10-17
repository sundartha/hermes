import { execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { testumbauPrompt } from "./agenten.mjs";
import { abnahmeBefehl, hatSkript } from "./befehle.mjs";
import { ENTFERNT } from "./testumbau.mjs";
import { GRUND, PRUEFUNG } from "./zweck.mjs";

const EINSTIEG = fileURLToPath(new URL("../auftrag.mjs", import.meta.url));
const MUTATION = "test:mutation";
const BEGRUENDET = /^Entfernt: (.+?), weil (\S.*)$/gm;

function umbauAntwort(lauf) {
  const { phase, auftrag, root } = lauf.kontext;
  if (!lauf.agent("test", testumbauPrompt(phase, auftrag, root))) return null;
  return lauf.agenten.at(-1).volleAntwort;
}

function pruefeUndVermerkeEntfernteFaelle(lauf, ausgabe, antwort) {
  const entfernt = ausgabe.split("\n").filter((zeile) => zeile.startsWith(ENTFERNT)).map((zeile) => zeile.slice(ENTFERNT.length));
  const gruende = new Map([...antwort.matchAll(BEGRUENDET)].map(([, fall, grund]) => [fall.trim(), grund.trim()]));
  const ohneGrund = entfernt.filter((fall) => !gruende.has(fall));
  if (ohneGrund.length > 0) {
    return lauf.scheitert(`Der Testumbau entfernt Fälle, die die Antwort nicht mit „${ENTFERNT}<Datei>: <Fall>, weil <Grund>“ nennt: ${ohneGrund.join("; ")}`, GRUND.ENTFERNT_OHNE_GRUND);
  }
  lauf.berichtszeilen.push(...entfernt.map((fall) => `${ENTFERNT}${fall}, weil ${gruende.get(fall)}`));
  return true;
}

function faelleGruen(lauf, antwort) {
  const ergebnis = lauf.pruefung(PRUEFUNG.TESTUMBAU_FAELLE, [execPath, EINSTIEG, "testumbau", "--basis", lauf.basis]);
  return lauf.gruenOderScheitert(ergebnis) && pruefeUndVermerkeEntfernteFaelle(lauf, ergebnis.ausgabe, antwort);
}

function mutationNichtSchlechter(lauf) {
  if (hatSkript(lauf.kontext.root, MUTATION)) {
    return lauf.gruen(PRUEFUNG.MUTATION_TESTUMBAU, ["npm", "--silent", "run", MUTATION, "--", "--basis", lauf.basis, "--testumbau"]);
  }
  lauf.hinweise.push(`Mutationsprüfung: package.json hat kein Skript ${MUTATION}.`);
  return true;
}

export function testumbauSchritte(lauf) {
  return [
    () => lauf.vorherGruen(),
    () => {
      const antwort = umbauAntwort(lauf);
      return antwort !== null && lauf.grenzen("test", lauf.basis) && faelleGruen(lauf, antwort);
    },
    () => lauf.allesVormerken(),
    () => lauf.gruen(PRUEFUNG.LINT, ["npm", "--silent", "run", "lint"]),
    () => lauf.pinPruefung(),
    () => lauf.gruen(PRUEFUNG.ABNAHME, abnahmeBefehl(lauf.kontext.auftrag)),
    () => mutationNichtSchlechter(lauf),
  ];
}
