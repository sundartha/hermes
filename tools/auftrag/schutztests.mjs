import { existsSync } from "node:fs";
import { join } from "node:path";

import { EXIT_GRUEN, EXIT_ROT, gueltigerAuftrag, meldeBefunde } from "./befehle.mjs";
import { neueFaelle } from "./faelle.mjs";
import { istAusfuehrbarerTest } from "./format.mjs";
import { aenderungenSeit } from "./git.mjs";
import { satzNummer, schutzSaetze, traegtKennung } from "./schutzkennung.mjs";

const NIE_ABNAHME = "Ein Schutztest zählt nie als Abnahme.";

function neueFaelleMitDatei(basis, root) {
  const pfade = aenderungenSeit(basis, root).map(({ pfad }) => pfad).filter((pfad) => istAusfuehrbarerTest(pfad) && existsSync(join(root, pfad)));
  return pfade.flatMap((pfad) => neueFaelle(basis, root, pfad).map((fall) => ({ ...fall, pfad })));
}

function kennungBefunde(faelle, { saetze, erwarteterFehler }) {
  return faelle.filter(({ name }) => traegtKennung(name)).flatMap(({ name, pfad, fehler }) => {
    if (satzNummer(name, saetze.length) === null) {
      return [`${pfad}: Der Fall „${name}“ trägt keine Kennung eines Satzes aus wasDarfNiePassieren (es gibt ${saetze.length} Sätze).`];
    }
    return fehler.includes(erwarteterFehler) ? [`${pfad}: Der Schutztest „${name}“ ist mit dem erwarteten Fehler rot. ${NIE_ABNAHME}`] : [];
  });
}

function pflichtBefunde(faelle, { saetze, rolle }) {
  const zaehlt = (fall, nummer) => !fall.still && satzNummer(fall.name, saetze.length) === nummer && (rolle === "test" || !fall.rot);
  const zustand = rolle === "test" ? "" : ", der nach dem Bau grün ist";
  return saetze.flatMap((satz, index) => {
    const nummer = index + 1;
    if (faelle.some((fall) => zaehlt(fall, nummer))) return [];
    return [`Der Satz [NIE${nummer}] „${satz}“ hat keinen neuen Testfall mit der Kennung [NIE${nummer}] am Namensanfang${zustand}.`];
  });
}

export function schutztests(phasendatei, kennung, { rolle, basis, root }) {
  const { auftrag, befunde: aufruf } = gueltigerAuftrag(phasendatei, kennung, root);
  if (aufruf.length > 0) return meldeBefunde(aufruf);
  const saetze = schutzSaetze(auftrag);
  const faelle = neueFaelleMitDatei(basis, root);
  const befunde = [...kennungBefunde(faelle, { saetze, erwarteterFehler: auftrag.erwarteterFehler }), ...pflichtBefunde(faelle, { saetze, rolle })];
  for (const befund of befunde) console.log(`Verstoß: ${befund}`);
  console.log(`${befunde.length === 0 ? "grün" : "rot"}: ${saetze.length} Sätze in wasDarfNiePassieren, ${befunde.length} Befunde, Rolle ${rolle}.`);
  return befunde.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}
