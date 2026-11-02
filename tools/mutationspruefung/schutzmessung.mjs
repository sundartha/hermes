import { nurSchutzRot, SCHUTZ_ANSPRUCH } from "../auftrag/schutzkennung.mjs";
import { aufgezeichnet, messeFall, schutzUrteil } from "./schutzwirkung.mjs";

export function schutzmessung(werkzeug) {
  let faelle = null;
  return {
    faelle: () => (faelle ??= werkzeug.faelle().map(({ name, pfad }) => ({ name, pfad }))),
    async messe(ziel) {
      const eintraege = [];
      for (const fall of this.faelle()) {
        const gemessen = werkzeug.erreicht(ziel.datei, fall.pfad) ? await messeFall(fall, ziel, werkzeug) : { getoetet: false, erreicht: false };
        eintraege.push({ datei: ziel.datei, pfad: fall.pfad, fall: fall.name, ...gemessen });
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

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

export function ohneReinenSchutzbefund(exitCode, ausgabe) {
  return exitCode === EXIT_ROT && nurSchutzRot(ausgabe) ? EXIT_GRUEN : exitCode;
}
