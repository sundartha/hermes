import { resolve } from "node:path";

import { istUmbau } from "../format.mjs";
import { STILLSTAND } from "../verlauf.mjs";
import { istObjekt } from "./erkundung.mjs";
import { nummernImOrdner } from "./nummern.mjs";
import { EXIT_BEFUNDE, EXIT_GRUEN, EXIT_PASST_NICHT, Ende, Planung, VORLAGE, abschnitt, ausgang, dateiText, json, liste, nummernText } from "./plane.mjs";
import { DOKUMENTE, schnittPruefung } from "./schnitt.mjs";
import { Team } from "./team.mjs";

export const VERLAUF = "\n## Verlauf\n";
const NACHFRAGEN = "Nachfragen gibt es beim Neuschnitt nicht";
const SKRIPTBEFUNDE = "die Skriptprüfung hat den neuen Schnitt abgelehnt";
const FUER_DEN_OWNER = "der neue Schnitt braucht den Owner";
const FUER_OWNER_FELDER = ["ownerAufgaben", "fehlendeSzenarien"];

class NeuschnittTeam extends Team {
  volleAntworten = new Map();

  async sende(wer, nachricht) {
    const lauf = await super.sende(wer, nachricht);
    this.volleAntworten.set(wer, lauf.volleAntwort);
    return lauf;
  }

  volleAntwort(wer) {
    return this.volleAntworten.get(wer);
  }
}

class NeuschnittPlanung extends Planung {
  constructor(root, ordner, { ablage, eingabe, phase }) {
    super(root, ordner);
    this.ablage = ablage;
    this.eingabe = eingabe;
    this.phase = phase;
    this.alt = phase.auftraege.find(({ id }) => id === eingabe.auftragId);
    this.vorhandene = phase.auftraege.filter((auftrag) => auftrag !== this.alt);
    this.aenderung = undefined;
  }

  beginne(soll, andererAusgang) {
    const eigene = istUmbau(this.alt) ? [] : liste(this.alt.prueft);
    this.soll = new Map([...soll].filter(([nummer]) => eigene.includes(nummer)));
    this.andererAusgang = andererAusgang;
    this.team = new NeuschnittTeam(this.root, this.ordner);
    this.planer = this.team.teilnehmer("planer");
  }

  ausstieg(antwort) {
    if (antwort.art !== STILLSTAND) throw new Ende(EXIT_PASST_NICHT, this.team.volleAntwort(this.planer));
    return super.ausstieg(antwort);
  }

  async planerStufe(text, verarbeite) {
    const antwort = await this.einzeln(this.planer, text);
    const ergebnis = antwort.art === "json" ? await verarbeite(antwort.wert) : this.ausstieg(antwort);
    if (liste(ergebnis.befunde).length > 0) throw new Ende(EXIT_BEFUNDE, SKRIPTBEFUNDE, ergebnis.befunde);
    return ergebnis.wert;
  }

  async planerNachricht() {
    const { kopf, datei } = this.eingabe;
    const stelle = kopf.indexOf(VERLAUF);
    const dokumente = DOKUMENTE.map((name) => `#### ${name}\n\n${this.dokumente[name] ?? `${name} gibt es nicht.`}`);
    return [
      kopf.slice(0, stelle),
      abschnitt("Dokumente", dokumente.join("\n\n")),
      abschnitt("Phasendatei", `${datei}\n\n${json(this.phase)}`),
      abschnitt("Nummern", nummernText(this.soll, [...this.soll.keys()])),
      abschnitt("Erkundungsbericht", json(this.berichte)),
      ...(await this.lagebild()),
      abschnitt(VORLAGE, dateiText(this.root, VORLAGE)),
      kopf.slice(stelle),
    ].join("\n");
  }

  merkeAenderung(wert) {
    if (wert.aenderung !== undefined) this.aenderung = wert.aenderung;
  }

  nimmSchnitt(wert) {
    if (Array.isArray(wert.nachfragen)) throw new Ende(EXIT_BEFUNDE, NACHFRAGEN, [NACHFRAGEN]);
    this.merkeAenderung(wert);
    const { schnitt, befunde } = this.schnittAusAntwort(wert);
    if (befunde.length > 0) return { befunde };
    const fuerOwner = FUER_OWNER_FELDER.flatMap((feld) => liste(schnitt?.[feld]).map((eintrag) => `${feld}: ${JSON.stringify(eintrag)}`));
    if (fuerOwner.length > 0) throw new Ende(EXIT_BEFUNDE, FUER_DEN_OWNER, fuerOwner);
    return this.pruefeSchnitt(schnitt);
  }

  async schneide() {
    await this.planerStufe(await this.planerNachricht(), (wert) => this.nimmSchnitt(wert));
  }

  async pruefeSchnitt(schnitt) {
    if (!istObjekt(schnitt)) return super.pruefeSchnitt(schnitt);
    this.schnitt = schnitt;
    this.lege("schnitt.json", schnitt);
    const eingaben = { berichte: this.berichte, soll: this.soll, dokumente: this.dokumente, root: this.root, vorhandene: this.vorhandene };
    const { befunde, annahmen } = await schnittPruefung(schnitt, eingaben);
    this.schnittAnnahmen = annahmen;
    return befunde.length === 0 ? { wert: schnitt } : { befunde, schnitt };
  }

  async laufe() {
    await this.schneide();
  }

  sitzungen() {
    const andere = this.team.beteiligte.filter((wer) => wer !== this.planer);
    return [...andere, this.planer].filter(({ sitzung }) => sitzung !== undefined).map(({ rolle, sitzung }) => ({ rolle, sitzung }));
  }

  ergebnisFuer({ exit, grund, offen }) {
    const ergebnis = { exitCode: exit, sitzungen: this.sitzungen() };
    if (exit === EXIT_GRUEN) ergebnis.antwort = this.aenderung;
    else if (exit === EXIT_PASST_NICHT) ergebnis.antwort = grund;
    else ergebnis.grund = offen.length > 0 ? offen.join("\n") : grund;
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
