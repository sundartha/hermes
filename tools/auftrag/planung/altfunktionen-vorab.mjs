import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { pfadIstSauber } from "../format.mjs";
import { gemergteUmbauten } from "../teil-vorgaenger.mjs";
import { abschnitte } from "./abschnitte.mjs";
import { vonEslintGeprueft } from "./eslint-prueft.mjs";
import { funktionsListe } from "./funktionsliste.mjs";
import { befundText, funktionsKarten, ignorierteDateien } from "./karte.mjs";
import { teilVon } from "./kopfzeile.mjs";
import { istAltfunktion } from "./schnitt.mjs";

export const ALTFUNKTIONEN = "## Altfunktionen";
const ZEILENUMBRUCH = /\r?\n/;
export const STELLE = /(?<![\w./-])((?:[\w.-]+\/)*[\w.-]+\.[cm]?[jt]sx?):(\d+)(?:-(\d+))?/g;
const FOLGE = /^`?\s*(?:,|und)\s*`?:(\d+)(?:-(\d+))?/;
const EINTRAG = /^-\s+(Umbau|nicht berührt):\s+`([^`:]+):([^`]+)`(?:,\s+weil\s+(\S.*))?$/u;
const KEINE = /^keine, weil\s+\S/u;
const NICHT_BERUEHRT = "nicht berührt";
const UMBAU = "Umbau";
const EIGENES_VERZEICHNIS = "./";
export const FORM = `„- Umbau: \`<Datei>:<Funktion>\`“, „- ${NICHT_BERUEHRT}: \`<Datei>:<Funktion>\`, weil <wo die Änderung stattdessen liegt>“ oder genau eine Zeile „keine, weil <Grund>“; Datei und Funktion schreibst du so, wie node tools/auftrag.mjs karte <Datei> sie ausgibt`;

function zeilen(von, bis) {
  const anfang = Number(von);
  const ende = Number(bis ?? von);
  return { von: Math.min(anfang, ende), bis: Math.max(anfang, ende) };
}

function folgeStellen(text, ab) {
  const gefunden = [];
  let rest = text.slice(ab);
  for (let treffer = FOLGE.exec(rest); treffer !== null; treffer = FOLGE.exec(rest)) {
    gefunden.push(zeilen(treffer[1], treffer[2]));
    rest = rest.slice(treffer[0].length);
  }
  return gefunden;
}

function ohneEigenesVerzeichnis(datei) {
  return datei.startsWith(EIGENES_VERZEICHNIS) ? datei.slice(EIGENES_VERZEICHNIS.length) : datei;
}

export function genannteStellen(dokumente) {
  return Object.entries(dokumente).flatMap(([quelle, text]) =>
    [...text.matchAll(STELLE)].flatMap((treffer) => {
      const [ganz, datei, von, bis] = treffer;
      const bereiche = [zeilen(von, bis), ...folgeStellen(text, treffer.index + ganz.length)];
      return bereiche.map((bereich) => ({ datei: ohneEigenesVerzeichnis(datei), ...bereich, quelle }));
    }),
  );
}

function eintragAus(zeile) {
  const treffer = EINTRAG.exec(zeile);
  if (treffer === null) return { fehler: `pitch.md, ${ALTFUNKTIONEN}: die Zeile „${zeile}“ hat nicht die Form ${FORM}` };
  const [, art, datei, funktion, grund] = treffer;
  if (art === NICHT_BERUEHRT && grund === undefined) return { fehler: `pitch.md, ${ALTFUNKTIONEN}: „${zeile}“ braucht „, weil <wo die Änderung stattdessen liegt>“` };
  return { eintrag: { art, datei, funktion: funktion.trim() } };
}

function inhalt(text) {
  const { abschnitte: gefunden } = abschnitte(text, [ALTFUNKTIONEN]);
  const ausschnitt = gefunden.get(ALTFUNKTIONEN);
  if (ausschnitt === undefined) return undefined;
  const [, ...rest] = ausschnitt.split(ZEILENUMBRUCH);
  return rest.map((zeile) => zeile.trim()).filter((zeile) => zeile !== "");
}

export function altfunktionenAusPitch(text) {
  const zeilenDesAbschnitts = inhalt(text);
  if (zeilenDesAbschnitts === undefined) return { eintraege: [], fehler: [`pitch.md hat keinen Abschnitt „${ALTFUNKTIONEN}“ oder hat ihn mehrfach; Form: ${FORM}`] };
  if (zeilenDesAbschnitts.length === 1 && KEINE.test(zeilenDesAbschnitts[0])) return { eintraege: [], fehler: [] };
  if (zeilenDesAbschnitts.length === 0) return { eintraege: [], fehler: [`pitch.md, ${ALTFUNKTIONEN}: der Abschnitt ist leer; Form: ${FORM}`] };
  const gelesen = zeilenDesAbschnitts.map(eintragAus);
  return { eintraege: gelesen.flatMap(({ eintrag }) => eintrag ?? []), fehler: gelesen.flatMap(({ fehler }) => fehler ?? []) };
}

function istDatei(root, datei) {
  return pfadIstSauber(datei) && existsSync(join(root, datei)) && statSync(join(root, datei)).isFile();
}

export function pruefbareDateien(root, dateien) {
  const vorhanden = [...new Set(dateien)].filter((datei) => istDatei(root, datei)).toSorted();
  if (vorhanden.length === 0) return [];
  const ignoriert = new Set(ignorierteDateien(root, vorhanden));
  return vorhanden.filter((datei) => !ignoriert.has(datei));
}

export function genannteFunktionen(root, stellen) {
  const dateien = new Set(pruefbareDateien(root, stellen.map(({ datei }) => datei)));
  const aenderungen = Object.groupBy(stellen.filter(({ datei }) => dateien.has(datei)), ({ quelle }) => quelle);
  const bericht = { nummern: Object.fromEntries(Object.entries(aenderungen).map(([quelle, eigene]) => [quelle, { aenderungen: eigene }])) };
  return funktionsListe(root, [bericht]);
}

function gleich(eintrag, funktion) {
  return eintrag.datei === funktion.datei && eintrag.funktion === funktion.name;
}

function fundstellen(funktion, stellen) {
  const eigene = stellen.filter(({ datei, von, bis }) => datei === funktion.datei && funktion.von <= bis && von <= funktion.bis);
  return [...new Set(eigene.map(({ quelle, von, bis }) => `${quelle}:${von === bis ? von : `${von}-${bis}`}`))].join(", ");
}

function altfunktionZeile(funktion) {
  return `${funktion.datei}:${funktion.name} (${funktion.von}-${funktion.bis}, ${befundText(funktion.befunde)})`;
}

function unbenannte(alt, eintraege, stellen) {
  return alt
    .filter((funktion) => !eintraege.some((eintrag) => gleich(eintrag, funktion)))
    .map((funktion) => `Altfunktion ${altfunktionZeile(funktion)}, genannt in ${fundstellen(funktion, stellen)}, steht nicht unter „${ALTFUNKTIONEN}“ im Pitch`);
}

function funktionenDerEintraege(root, eintraege) {
  const dateien = pruefbareDateien(root, eintraege.map(({ datei }) => datei));
  const geprueft = dateien.length === 0 ? [] : vonEslintGeprueft(root, dateien);
  if (geprueft.length === 0) return [];
  return funktionsKarten(root, geprueft).flatMap(({ datei, funktionen }) => funktionen.map((funktion) => ({ datei, ...funktion })));
}

function gemergterUmbau(eintrag, { ohneBefunde, umbauten }) {
  if (eintrag.art !== UMBAU || !ohneBefunde.some((funktion) => gleich(eintrag, funktion))) return undefined;
  return umbauten.find(({ datei, funktion }) => datei === eintrag.datei && funktion === eintrag.funktion);
}

function vorgaengerAus(pitch) {
  return teilVon(pitch)?.nach ?? [];
}

function pruefeEintraege(root, eintraege, pitch) {
  const funktionen = funktionenDerEintraege(root, eintraege);
  const alt = funktionen.filter(istAltfunktion);
  const ohneAlt = eintraege.filter((eintrag) => !alt.some((funktion) => gleich(eintrag, funktion)));
  const umbauten = ohneAlt.some(({ art }) => art === UMBAU) ? gemergteUmbauten(root, vorgaengerAus(pitch)) : [];
  const kontext = { ohneBefunde: funktionen.filter((funktion) => !istAltfunktion(funktion)), umbauten };
  const geprueft = ohneAlt.map((eintrag) => ({ eintrag, umbau: gemergterUmbau(eintrag, kontext) }));
  return {
    falsch: geprueft.filter(({ umbau }) => umbau === undefined).map(({ eintrag: { art, datei, funktion } }) => `„${art}: ${datei}:${funktion}“ unter „${ALTFUNKTIONEN}“ ist laut karte keine Funktion mit Lint-Befunden in ${datei}`),
    erledigt: geprueft.filter(({ umbau }) => umbau !== undefined).map(({ umbau: { datei, funktion, vorgaenger, sha } }) => `Umbau von ${datei}:${funktion} durch ${vorgaenger} gemergt, ${sha}`),
  };
}

export function altfunktionenVorab(root, dokumente) {
  const pitch = dokumente["pitch.md"] ?? "";
  const { eintraege, fehler } = altfunktionenAusPitch(pitch);
  if (fehler.length > 0) return { form: fehler, offen: [], erledigt: [] };
  const stellen = genannteStellen(dokumente);
  const { falsch, erledigt } = pruefeEintraege(root, eintraege, pitch);
  return { form: [], offen: [...unbenannte(genannteFunktionen(root, stellen).filter(istAltfunktion), eintraege, stellen), ...falsch], erledigt };
}
