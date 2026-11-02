import { muster } from "../tests-ausmisten/ausnehmen.mjs";
import { SCHUTZ_ANSPRUCH } from "../auftrag/schutzkennung.mjs";
import { aufgezeichnet, schutzUrteil } from "./schutzwirkung.mjs";

const GETOETET = new Set(["Killed", "Timeout"]);
const GELAUFEN_UEBERLEBT = "Survived";

export function schutzmessung(werkzeug) {
  let faelle = null;
  return {
    faelle: () => (faelle ??= werkzeug.faelle().map(({ name, pfad }) => ({ name, pfad }))),
    async messe({ datei, bereiche }) {
      const eintraege = [];
      for (const { name, pfad } of this.faelle()) {
        const ergebnisse = werkzeug.erreicht(datei, pfad) ? await werkzeug.stryker({ datei, zeilen: bereiche, tests: [pfad], namensmuster: muster(name) }) : [];
        eintraege.push({
          datei,
          pfad,
          fall: name,
          getoetet: ergebnisse.some(({ status }) => GETOETET.has(status)),
          erreicht: ergebnisse.some(({ status }) => status === GELAUFEN_UEBERLEBT),
        });
      }
      return eintraege;
    },
  };
}

export function schutzsammler() {
  let messer = null;
  const messungen = [];
  const einheiten = [];
  return {
    einheiten,
    messgeraet: (werkzeug) => (messer ??= schutzmessung(werkzeug)),
    async nimmAuf(einheit) {
      messungen.push(...(await messer.messe(einheit)));
    },
    bericht() {
      const faelle = messer === null ? [] : messer.faelle();
      return faelle.length === 0 ? {} : { schutz: { faelle, messungen } };
    },
  };
}

export function schutzansprueche(nachrichten) {
  return [...new Set(nachrichten.flatMap((nachricht) => [...nachricht.matchAll(SCHUTZ_ANSPRUCH)].map(([, angabe]) => angabe)))];
}

export function schutzDesUrteils({ berichte, einheiten, angaben }, stryker) {
  const aufnahmen = berichte.flatMap(({ schutz }) => (schutz === undefined ? [] : [schutz]));
  const faelle = [...new Map(aufnahmen.flatMap((aufnahme) => aufnahme.faelle).map((fall) => [`${fall.pfad}\0${fall.name}`, fall])).values()];
  if (faelle.length === 0) return null;
  const werkzeug = {
    faelle: () => faelle,
    einheiten: async () => einheiten,
    freigabe: async () => {},
    fall: aufgezeichnet(aufnahmen.flatMap((aufnahme) => aufnahme.messungen)),
    stryker,
  };
  return schutzUrteil(angaben, werkzeug);
}
