import { existsSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";

import { funktionenIn, regelnJeFunktion, ungefilterteMeldungen } from "../../ziele/funktionen.mjs";

const EXIT_GRUEN = 0;
const JSON_EINRUECKUNG = 2;

function jeRegel(regeln) {
  const anzahl = {};
  for (const regel of regeln.toSorted()) anzahl[regel] = (anzahl[regel] ?? 0) + 1;
  return anzahl;
}

function pruefbar(datei, meldungen) {
  const fehler = meldungen.find(({ fatal, ruleId }) => fatal === true || ruleId === null);
  if (fehler) throw new Error(`ESLint konnte ${datei} nicht prüfen: ${fehler.message}`);
}

function karteDerDatei(wurzel, { filePath, messages, source }) {
  const datei = relative(wurzel, realpathSync(filePath));
  pruefbar(datei, messages);
  const funktionen = funktionenIn(datei, source ?? readFileSync(filePath, "utf8"));
  const jeFunktion = regelnJeFunktion(funktionen, messages);
  const eintraege = funktionen.map((funktion) => {
    const { name, von, bis } = funktion;
    return { name, von, bis, zeilen: bis - von + 1, befunde: jeRegel(jeFunktion.get(funktion) ?? []) };
  });
  return { datei, funktionen: eintraege };
}

export function funktionsKarten(root, dateien) {
  const fehlend = dateien.filter((datei) => !existsSync(resolve(root, datei)));
  if (fehlend.length > 0) throw new Error(`Datei fehlt: ${fehlend.join(", ")}`);
  const wurzel = realpathSync(root);
  const karten = new Map(ungefilterteMeldungen(root, dateien).map((ergebnis) => {
    const karte = karteDerDatei(wurzel, ergebnis);
    return [karte.datei, karte];
  }));
  return dateien.map((datei) => {
    const karte = karten.get(relative(wurzel, realpathSync(resolve(root, datei))));
    if (karte === undefined) throw new Error(`ESLint lieferte kein Ergebnis für ${datei}`);
    return karte;
  });
}

function befundText(befunde) {
  const teile = Object.entries(befunde).map(([regel, anzahl]) => `${regel} ${anzahl}`);
  return teile.length > 0 ? teile.join(", ") : "keine Befunde";
}

export function karte(datei, root, { json = false } = {}) {
  const [ergebnis] = funktionsKarten(root, [datei]);
  if (json) {
    console.log(JSON.stringify(ergebnis, null, JSON_EINRUECKUNG));
    return EXIT_GRUEN;
  }
  console.log(ergebnis.datei);
  for (const { name, von, bis, zeilen, befunde } of ergebnis.funktionen) {
    console.log([name, `${von}-${bis}`, `${zeilen} Zeilen`, befundText(befunde)].join("\t"));
  }
  return EXIT_GRUEN;
}
