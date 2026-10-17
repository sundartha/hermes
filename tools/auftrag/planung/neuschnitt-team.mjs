import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { istTestdatei, istUmbau, phasenBefunde } from "../format.mjs";
import { STILLSTAND } from "../verlauf.mjs";
import { istObjekt, istText } from "./erkundung.mjs";
import { dateiKarte, funktionsListe } from "./funktionsliste.mjs";
import { nummernImOrdner } from "./nummern.mjs";
import { befundeImOrdner } from "./abdeckung.mjs";
import { prueflisteSoll } from "./antworten.mjs";
import { druckePlanBericht, planBericht } from "./planbericht.mjs";
import { EXIT_BEFUNDE, EXIT_GRUEN, EXIT_PASST_NICHT, Ende, Planung, VORLAGE, abschnitt, ausgangOhneWurf, dateiText, json, liste, nachricht, nummernText, prueferZeile, schreibeJson } from "./plane.mjs";
import { DOKUMENTE, schnittBefunde, schnittPruefung } from "./schnitt.mjs";
import { Team } from "./team.mjs";
import { auftragAusSchnitt, entwurfFuer } from "./zusammensetzen.mjs";

export const VERLAUF = "\n## Verlauf\n";
const NACHFRAGEN = "Nachfragen gibt es beim Neuschnitt nicht";
const SKRIPTBEFUNDE = "die Skriptprüfung hat den neuen Schnitt abgelehnt";
const FUER_DEN_OWNER = "der neue Schnitt braucht den Owner";
const FUER_OWNER_FELDER = ["ownerAufgaben", "fehlendeSzenarien"];
const QUELLTEXT = /\.[cm]?js$/;
const ERSTE_PLANUNG = "planung";
const GLIEDERUNG = "gliederung.json";
const ERKUNDUNG = /^erkundung-.+\.json$/;
const ERKUNDUNG_OFFEN = "die Erkundung für den Neuschnitt blieb offen";
const DURCHSTICH = "a1";
const DURCHSTICH_ZEILE = `durchstich:${DURCHSTICH}`;
const PRUEFUNG_UNVOLLSTAENDIG = "die Prüfliste blieb nach der Rücksendung unvollständig";
const ERSTE_PRUEFLISTE = "pruefliste.json";
const PRUEFLISTE_NACH_KORREKTUR = "pruefliste-korrektur.json";
const ENTWURF_OFFEN = "Befunde zu Entwürfen blieben nach der Rücksendung offen";
const PHASE_MIT_BEFUNDEN = "die Phase mit dem neuen Schnitt hat Befunde";
const PLANBERICHT = "planung.json";
const PRUEFUNG_OFFEN = "der frische Prüfer hat nach der Korrektur Befunde";

function leseJson(pfad) {
  return JSON.parse(readFileSync(pfad, "utf8"));
}

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
  constructor(root, ordner, { ablage, eingabe, phase, alt }) {
    super(root, ordner);
    this.ablage = ablage;
    this.eingabe = eingabe;
    this.phase = phase;
    this.alt = alt;
    this.vorhandene = phase.auftraege.filter((auftrag) => auftrag !== this.alt);
  }

  eigeneNummern() {
    return liste(this.alt.prueft);
  }

  beginne(soll) {
    const eigene = this.eigeneNummern();
    this.soll = new Map([...soll].filter(([nummer]) => eigene.includes(nummer)));
    this.team = new NeuschnittTeam(this.root, this.ordner);
    this.planer = this.team.teilnehmer("planer");
    const gliederung = join(this.ordner, ERSTE_PLANUNG, GLIEDERUNG);
    this.gliederung = existsSync(gliederung) ? leseJson(gliederung) : { gruppen: [] };
  }

  designAbschnitte(ueberschriften) {
    return ueberschriften.length === 0 ? (this.designText ?? "keine") : super.designAbschnitte(ueberschriften);
  }

  async erkundeNummern() {
    if (this.soll.size === 0) return;
    const { auftragId, anlass, verlauf, hinweise } = this.eingabe;
    const nummern = [...this.soll.keys()];
    const kopf = [abschnitt("Anlass", anlass), abschnitt("Verlauf", verlauf.join("\n")), abschnitt("Hinweise", hinweise.join("\n"))];
    const fragen = [`Woran ist ${auftragId} gescheitert, und welche Stellen müssen sich für diese Nummern ändern?`];
    const [ergebnis] = await this.team.gruppe([this.erkunderLauf(this.erkunderNachricht("Nachfrage", { nummern, fragen, kopf }), nummern)]);
    this.berichte = [ergebnis.bericht];
    if (ergebnis.befunde.length === 0) this.uebernimmWeg(ergebnis);
    this.legeBerichte();
    const offen = this.offenePunkte();
    if (offen.length > 0) throw new Ende(EXIT_BEFUNDE, ERKUNDUNG_OFFEN, offen);
  }

  ersteBerichte() {
    const ablage = join(this.ordner, ERSTE_PLANUNG);
    if (!existsSync(ablage)) return [];
    const berichte = readdirSync(ablage).filter((name) => ERKUNDUNG.test(name)).toSorted().map((name) => leseJson(join(ablage, name)));
    return berichte.filter(({ gruppe }) => liste(gruppe).some((nummer) => this.soll.has(nummer)));
  }




  erkundungsbericht() {
    return this.berichte;
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
      abschnitt("Erkundungsbericht", json(this.erkundungsbericht())),
      abschnitt("Berichte der ersten Planung", json(this.ersteBerichte())),
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
    return this.planerStufe(await this.planerNachricht(), (wert) => this.nimmSchnitt(wert));
  }

  skriptPruefung(schnitt, eingaben) {
    return schnittPruefung(schnitt, eingaben);
  }

  durchstich(schnitt) {
    if (this.alt.id !== DURCHSTICH) return undefined;
    const neue = liste(schnitt.auftraege).filter(istObjekt);
    return (neue.find(({ art }) => art === "funktion") ?? neue[0])?.id;
  }

  async pruefeSchnitt(schnitt) {
    if (!istObjekt(schnitt)) return super.pruefeSchnitt(schnitt);
    this.schnitt = schnitt;
    this.lege("schnitt.json", schnitt);
    const eingaben = { berichte: this.berichte, soll: this.soll, dokumente: this.dokumente, root: this.root, vorhandene: this.vorhandene, durchstich: this.durchstich(schnitt) };
    const { befunde, annahmen } = await this.skriptPruefung(schnitt, eingaben);
    this.schnittAnnahmen = annahmen;
    return befunde.length === 0 ? { wert: schnitt } : { befunde, schnitt };
  }

  prueflisteSchluessel(schnitt) {
    const durchstich = this.durchstich(schnitt);
    const schluessel = prueflisteSoll(schnitt, this.soll, this.erkunderAnnahmen());
    if (durchstich === undefined) return schluessel.filter((zeile) => zeile !== DURCHSTICH_ZEILE);
    return schluessel.map((zeile) => (zeile === DURCHSTICH_ZEILE ? `durchstich:${durchstich}` : zeile));
  }

  neuschnittKopf() {
    const { auftragId, anlass, datei } = this.eingabe;
    const regeln = [
      `Die Schnittliste enthält nur die neuen Aufträge, die ${auftragId} ersetzen. Alle anderen Aufträge stehen in der Phasendatei und bleiben, wie sie sind.`,
      "Bei gegenfrage:alle zählt ein Satz als abgedeckt, wenn er bei einem Auftrag der Phasendatei oder der Schnittliste steht.",
      `Eine Zeile durchstich: mit der Kennung eines Auftrags prüfst du für diesen Auftrag wie ${DURCHSTICH_ZEILE}.`,
    ];
    return abschnitt("Neuschnitt", [anlass, regeln.join(" "), `Phasendatei ${datei}:`, json(this.phase)].join("\n\n"));
  }

  kartenAbschnitte() {
    return [];
  }

  async neuschnittPrueferNachricht(schnitt, schluessel) {
    const grundlage = this.pruefGrundlage(schluessel, await this.prueferSicht({ gruppe: null, schluessel }));
    return nachricht("Prüfung", [this.neuschnittKopf(), ...(await this.kartenAbschnitte(schnitt)), abschnitt("Schnittliste", json(schnitt)), ...grundlage]);
  }

  async pruefliste(datei, schnitt) {
    const schluessel = this.prueflisteSchluessel(schnitt);
    const text = await this.neuschnittPrueferNachricht(schnitt, schluessel);
    const { befunde } = await this.pruefeMitFrischemPruefer(text, schluessel, { datei, grund: PRUEFUNG_UNVOLLSTAENDIG });
    return befunde;
  }

  beantworte(befunde, wert, vorher) {
    this.merkeAenderung(wert);
    return super.beantworte(befunde, wert, vorher);
  }

  async pruefe(schnitt) {
    const befunde = await this.pruefliste(ERSTE_PRUEFLISTE, schnitt);
    if (befunde.length === 0) return;
    const korrektur = await this.korrigiere(befunde, schnitt);
    const danach = await this.pruefliste(PRUEFLISTE_NACH_KORREKTUR, korrektur.schnitt);
    if (danach.length > 0) throw new Ende(EXIT_BEFUNDE, PRUEFUNG_OFFEN, danach.map(prueferZeile));
  }

  eigeneBereiche() {
    const fremde = new Set(this.vorhandene.map(({ bereich }) => bereich));
    const bereiche = new Set(this.schnitt.auftraege.map(({ bereich }) => bereich));
    return [...bereiche].filter((bereich) => !fremde.has(bereich));
  }

  entwurfLauf(bereich) {
    const namen = this.namenDes(bereich);
    const schreiber = this.team.teilnehmer("entwurf");
    return { rolle: schreiber.rolle, lauf: () => this.schreibeEntwurf(schreiber, this.entwurfNachricht(bereich, namen), namen) };
  }

  async entwerfe() {
    const bereiche = this.eigeneBereiche();
    const ergebnisse = await this.team.gruppe(bereiche.map((bereich) => this.entwurfLauf(bereich)));
    const offen = bereiche.flatMap((bereich, stelle) => ergebnisse[stelle].befunde.map((befund) => `Entwurf ${bereich}: ${befund}`));
    if (offen.length > 0) throw new Ende(EXIT_BEFUNDE, ENTWURF_OFFEN, offen);
    const eigene = (bereich) => this.schnitt.auftraege.filter((eintrag) => eintrag.bereich === bereich);
    return Object.fromEntries(bereiche.map((bereich, stelle) => [bereich, entwurfFuer(ergebnisse[stelle].entwurf, eigene(bereich))]));
  }

  ohneAlten(auftrag, neue) {
    const vorher = liste(auftrag.abhaengigVon);
    if (!vorher.includes(this.alt.id)) return auftrag;
    return { ...auftrag, abhaengigVon: vorher.flatMap((id) => (id === this.alt.id ? neue : [id])) };
  }

  setzeEin(entwuerfe) {
    const neue = this.schnitt.auftraege.map((eintrag) => auftragAusSchnitt(eintrag, this.soll));
    const kennungen = neue.map(({ id }) => id);
    const auftraege = this.phase.auftraege.flatMap((auftrag) => (auftrag === this.alt ? neue : [this.ohneAlten(auftrag, kennungen)]));
    const phase = { ...this.phase, entwurf: { ...this.phase.entwurf, ...entwuerfe }, auftraege };
    const befunde = [...phasenBefunde(phase, this.root), ...befundeImOrdner(this.ordner, phase).befunde];
    if (befunde.length > 0) throw new Ende(EXIT_BEFUNDE, PHASE_MIT_BEFUNDEN, befunde);
    schreibeJson(join(this.root, this.eingabe.datei), phase);
  }

  async laufe() {
    await this.erkundeNummern();
    await this.pruefe(await this.schneide());
    this.setzeEin(await this.entwerfe());
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

  bericht({ exit, grund, offen }) {
    const { beginn, schnitt, nachpruefungen, wegpruefungen } = this;
    const schleifen = this.schleifen.map((schleife) => schleife.bericht());
    const lauf = { exit, grund, beginn, schnitt, nachpruefungen, wegpruefungen, schleifen, annahmen: this.alleAnnahmen(), befunde: { ...this.befunde, offen } };
    return planBericht(lauf, { root: this.root, team: this.team });
  }

  schreibeUndDruckePlanBericht(bericht) {
    const pfad = join(this.ablage, PLANBERICHT);
    schreibeJson(pfad, bericht);
    druckePlanBericht(bericht, pfad);
  }

  async ende() {
    try {
      await this.laufe();
      return { exit: EXIT_GRUEN, grund: `grün: ${this.eingabe.datei} geschrieben`, offen: [] };
    } catch (fehler) {
      return ausgangOhneWurf(fehler);
    }
  }

  async ergebnis() {
    const ende = await this.ende();
    const bericht = this.bericht(ende);
    this.schreibeUndDruckePlanBericht(bericht);
    return { ...this.ergebnisFuer(ende), planung: bericht };
  }
}

class UmbauNeuschnittPlanung extends NeuschnittPlanung {
  eigeneNummern() {
    return [];
  }

  produktDateien(auftraege) {
    const dateien = auftraege.flatMap((auftrag) => liste(auftrag.erwarteteDateien));
    return [...new Set(dateien)].filter((datei) => istText(datei) && !istTestdatei(datei) && existsSync(join(this.root, datei)));
  }

  ersatzbericht(dateien) {
    const aenderungen = dateien.map((datei) => ({ datei, von: 1, bis: readFileSync(join(this.root, datei), "utf8").split("\n").length }));
    return { gruppe: [], nummern: { [this.alt.id]: { aenderungen } } };
  }

  async ersatzKarten(auftraege) {
    const dateien = this.produktDateien(auftraege);
    const funktionsliste = funktionsListe(this.root, [this.ersatzbericht(dateien.filter((datei) => QUELLTEXT.test(datei)))]);
    return { funktionsliste, dateikarte: await dateiKarte(this.root, [this.ersatzbericht(dateien)]) };
  }

  karten() {
    return this.ersatzKarten([this.alt]);
  }

  kartenMitNeuenUmbauten(schnitt) {
    const umbauten = liste(schnitt.auftraege).filter(istObjekt).filter(istUmbau);
    return this.ersatzKarten([this.alt, ...umbauten]);
  }

  erkundungsbericht() {
    return this.ersatzbericht(this.produktDateien([this.alt]));
  }

  async skriptPruefung(schnitt, eingaben) {
    return schnittBefunde(schnitt, { ...eingaben, berichte: [], ...(await this.kartenMitNeuenUmbauten(schnitt)) });
  }

  async kartenAbschnitte(schnitt) {
    const { funktionsliste, dateikarte } = await this.kartenMitNeuenUmbauten(schnitt);
    return [abschnitt("Funktionsliste", json(funktionsliste)), abschnitt("Dateikarte", json(dateikarte))];
  }
}

export async function neuschnitt(ablage, eingabe, phase) {
  const ordner = resolve(eingabe.root, eingabe.ordner);
  const alt = phase.auftraege.find(({ id }) => id === eingabe.auftragId);
  const Art = istUmbau(alt) ? UmbauNeuschnittPlanung : NeuschnittPlanung;
  const planung = new Art(eingabe.root, ordner, { ablage, eingabe, phase, alt });
  const { soll } = nummernImOrdner(ordner);
  planung.beginn = Date.now();
  planung.beginne(soll);
  return planung.ergebnis();
}
