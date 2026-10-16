import { resolve } from "node:path";

import { istUmbau } from "../format.mjs";
import { nummernImOrdner } from "./nummern.mjs";
import { EXIT_GRUEN, EXIT_PASST_NICHT, Planung, ausgang, liste } from "./plane.mjs";
import { Team } from "./team.mjs";

export const VERLAUF = "\n## Verlauf\n";

class NeuschnittPlanung extends Planung {
  constructor(root, ordner, { ablage, eingabe, phase }) {
    super(root, ordner);
    this.ablage = ablage;
    this.eingabe = eingabe;
    this.phase = phase;
    this.alt = phase.auftraege.find(({ id }) => id === eingabe.auftragId);
    this.vorhandene = phase.auftraege.filter((auftrag) => auftrag !== this.alt);
  }

  beginne(soll, andererAusgang) {
    const eigene = istUmbau(this.alt) ? [] : liste(this.alt.prueft);
    this.soll = new Map([...soll].filter(([nummer]) => eigene.includes(nummer)));
    this.andererAusgang = andererAusgang;
    this.team = new Team(this.root, this.ordner);
    this.planer = this.team.teilnehmer("planer");
  }

  async laufe() {
    await this.einzeln(this.planer, this.eingabe.kopf);
  }

  sitzungen() {
    const andere = this.team.beteiligte.filter((wer) => wer !== this.planer);
    return [...andere, this.planer].filter(({ sitzung }) => sitzung !== undefined).map(({ rolle, sitzung }) => ({ rolle, sitzung }));
  }

  ergebnisFuer({ exit, grund, offen }) {
    const ergebnis = { exitCode: exit, sitzungen: this.sitzungen() };
    if (exit === EXIT_PASST_NICHT) ergebnis.antwort = grund;
    else if (exit !== EXIT_GRUEN) ergebnis.grund = offen.length > 0 ? offen.join("\n") : grund;
    return ergebnis;
  }

  async ergebnis() {
    try {
      await this.laufe();
      return this.ergebnisFuer({ exit: EXIT_GRUEN, offen: [] });
    } catch (fehler) {
      return this.ergebnisFuer(ausgang(fehler));
    }
  }
}

export async function neuschnitt(ablage, eingabe, phase) {
  const ordner = resolve(eingabe.root, eingabe.ordner);
  const planung = new NeuschnittPlanung(eingabe.root, ordner, { ablage, eingabe, phase });
  const { soll, andererAusgang } = nummernImOrdner(ordner);
  planung.beginn = Date.now();
  planung.beginne(soll, andererAusgang);
  return planung.ergebnis();
}
