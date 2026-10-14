import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pid } from "node:process";

import { STILLSTAND } from "../verlauf.mjs";
import { abschnitte } from "./abschnitte.mjs";
import {
  antwortenBefunde,
  entwurfBefunde,
  gliederungBefunde,
  istZurueckgewiesen,
  merkeStellen,
  nachpruefSchluessel,
  neueStellen,
  prueferBefunde,
  prueflisteBefunde,
  prueflisteSoll,
  zerlegungBefunde,
} from "./antworten.mjs";
import { erkundungBefunde, istObjekt, istText } from "./erkundung.mjs";
import { Fortschritt } from "./fortschritt.mjs";
import { dateiKarte, funktionsListe } from "./funktionsliste.mjs";
import { nummernImOrdner } from "./nummern.mjs";
import { annahmeText, druckePlanBericht, planBericht, schreibePlanBericht } from "./planbericht.mjs";
import { DOKUMENTE, schnittImOrdner } from "./schnitt.mjs";
import { Abbruch, Team } from "./team.mjs";
import { setzePhaseZusammen } from "./zusammensetzen.mjs";

const EXIT_GRUEN = 0;
const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const EXIT_PASST_NICHT = 3;
const EXIT_BEFUNDE = 4;
const PLANUNG = "planung";
const PHASE = "phase.json";
const DESIGN = "design.md";
const VORLAGE = ".claude/skills/pitch/phase-vorlage.md";
const VORLAGE_ENTWURF = "## Entwurf je Bereich";
const PLANER_KONTEXT = ["CLAUDE.md", ".github/CODEOWNERS", "tools/bereiche.json"];
const ERKUNDER_KONTEXT = ["CLAUDE.md", "tools/bereiche.json"];
const JSON_EINRUECKUNG = 2;
const PITCH_NUR_NEUSCHNITT = "„Pitch ändern“ gibt es nur beim Neuschnitt; antworte mit der Antwort, die an dieser Stelle verlangt ist, oder mit „Zerlegung passt nicht: …“";
const KEIN_JSON = "die Antwort enthält kein JSON in der verlangten Form";

class Ende extends Error {
  constructor(exit, grund, befunde = []) {
    super(grund);
    this.exit = exit;
    this.befunde = befunde;
  }
}

function liste(wert) {
  return Array.isArray(wert) ? wert : [];
}

function json(wert) {
  return `\`\`\`json\n${JSON.stringify(wert, null, JSON_EINRUECKUNG)}\n\`\`\``;
}

function abschnitt(titel, inhalt) {
  return `### ${titel}\n\n${String(inhalt).trimEnd()}\n`;
}

function nachricht(ueberschrift, teile) {
  return [`## ${ueberschrift}`, "", ...teile].join("\n");
}

function punkte(eintraege, leer = "keine") {
  return eintraege.length === 0 ? leer : eintraege.map((eintrag) => `- ${eintrag}`).join("\n");
}

function dateiText(root, pfad) {
  const datei = join(root, pfad);
  return existsSync(datei) ? readFileSync(datei, "utf8") : `${pfad} gibt es nicht.`;
}

function schreibeJson(datei, wert) {
  const zwischen = `${datei}.${pid}.tmp`;
  writeFileSync(zwischen, `${JSON.stringify(wert, null, JSON_EINRUECKUNG)}\n`);
  renameSync(zwischen, datei);
}

function prueferZeile({ schluessel, befund, fundstelle }) {
  return `${schluessel}: ${befund} (Fundstelle: ${fundstelle})`;
}

function offenerPrueferBefund(befund, antworten) {
  const antwort = antworten.find((eintrag) => eintrag?.schluessel === befund.schluessel)?.antwort;
  return istText(antwort) ? `${prueferZeile(befund)} | ${antwort}` : prueferZeile(befund);
}

function nummernText(soll, nummern) {
  return nummern.map((nummer) => `#### ${nummer} (${soll.get(nummer)?.quelle})\n\n${soll.get(nummer)?.text}\n`).join("\n");
}

class Planung {
  constructor(root, ordner) {
    this.root = root;
    this.ordner = ordner;
    this.ablage = join(ordner, PLANUNG);
    this.dokumente = Object.fromEntries(DOKUMENTE.filter((name) => existsSync(join(ordner, name))).map((name) => [name, readFileSync(join(ordner, name), "utf8")]));
    this.designText = this.dokumente[DESIGN];
    this.berichte = [];
    this.gesehen = new Set();
    this.ausgeschoepft = new Set();
    this.schnitt = null;
    this.schnittAnnahmen = null;
    this.befunde = { offen: [], korrigiert: [], zurueckgewiesen: [] };
    this.schleifen = [];
    this.nachpruefungen = [];
  }

  beginne(soll, andererAusgang) {
    this.soll = soll;
    this.andererAusgang = andererAusgang;
    this.team = new Team(this.root, this.ordner);
    this.planer = this.team.teilnehmer("planer");
    mkdirSync(this.ablage, { recursive: true });
  }

  lege(name, wert) {
    schreibeJson(join(this.ablage, name), wert);
  }

  kontext() {
    return { root: this.root, dokumente: this.dokumente };
  }

  async einzeln(wer, text) {
    const [antwort] = await this.team.gruppe([{ rolle: wer.rolle, lauf: () => this.team.frage(wer, text) }]);
    return antwort;
  }

  ausstieg(antwort) {
    if (antwort.art === STILLSTAND) throw new Abbruch(`${this.planer.rolle}: ${antwort.text}`);
    if (antwort.art === "pitch") return { befunde: [PITCH_NUR_NEUSCHNITT] };
    const befunde = zerlegungBefunde(antwort.text, this.kontext());
    if (befunde.length === 0) throw new Ende(EXIT_PASST_NICHT, antwort.text);
    return { befunde };
  }

  schleife(art) {
    const schleife = new Fortschritt(art);
    this.schleifen.push(schleife);
    return schleife;
  }

  async planerStufe(text, verarbeite, art) {
    const schleife = this.schleife(art);
    let naechste = text;
    for (;;) {
      const antwort = await this.einzeln(this.planer, naechste);
      const ergebnis = antwort.art === "json" ? await verarbeite(antwort.wert) : this.ausstieg(antwort);
      if (ergebnis.weiter !== undefined) naechste = ergebnis.weiter;
      else if (liste(ergebnis.befunde).length === 0) return ergebnis.wert;
      else {
        const ende = schleife.endeNachRunde(ergebnis.befunde, ergebnis.schnitt, this.soll);
        if (ende !== null) throw new Ende(EXIT_BEFUNDE, ende.grund, ergebnis.befunde);
        naechste = this.team.ruecksenden(this.planer, ergebnis.befunde);
      }
    }
  }

  gliederungsNachricht() {
    const nummern = [...this.soll.keys()];
    return nachricht("Gliederung", [
      ...DOKUMENTE.map((name) => abschnitt(name, this.dokumente[name] ?? `${name} gibt es nicht.`)),
      abschnitt("Nummern", nummernText(this.soll, nummern)),
      abschnitt("Bedrohungen mit anderem Ausgang (gehören zu keinem Auftrag)", punkte([...this.andererAusgang])),
      ...PLANER_KONTEXT.map((pfad) => abschnitt(pfad, dateiText(this.root, pfad))),
    ]);
  }

  async gliedere() {
    this.gliederung = await this.planerStufe(this.gliederungsNachricht(), (wert) => {
      const befunde = gliederungBefunde(wert, this.soll, this.designText);
      return befunde.length > 0 ? { befunde } : { wert };
    }, "gliederung");
    this.lege("gliederung.json", this.gliederung);
  }

  gruppenVon(nummern) {
    return this.gliederung.gruppen.filter((gruppe) => gruppe.nummern.some((nummer) => nummern.includes(nummer)));
  }

  designAbschnitte(ueberschriften) {
    const { abschnitte: gefunden } = abschnitte(this.designText ?? "", ueberschriften);
    return [...gefunden.values()].join("\n\n") || "keine";
  }

  erkunderNachricht(ueberschrift, { nummern, fragen, kopf = [] }) {
    const gruppen = this.gruppenVon(nummern);
    const ueberschriften = [...new Set(gruppen.flatMap((gruppe) => gruppe.ueberschriften))];
    return nachricht(ueberschrift, [
      ...kopf,
      abschnitt("Deine Nummern", nummernText(this.soll, nummern)),
      abschnitt("Eingang laut Design Doc", punkte(gruppen.map((gruppe) => gruppe.eingang))),
      abschnitt("Abschnitte des Design Docs", this.designAbschnitte(ueberschriften)),
      abschnitt("Fragen des Planers", punkte(fragen)),
      ...ERKUNDER_KONTEXT.map((pfad) => abschnitt(pfad, dateiText(this.root, pfad))),
    ]);
  }

  pruefeBericht(antwort, nummern) {
    const leer = { gruppe: nummern, nummern: {}, hinweise: [] };
    if (antwort.art === STILLSTAND) return { bericht: leer, befunde: [antwort.text], annahmen: [] };
    if (antwort.art !== "json" || !istObjekt(antwort.wert.nummern)) return { bericht: leer, befunde: [`nummern fehlt: ${KEIN_JSON}`], annahmen: [] };
    const bericht = { gruppe: nummern, nummern: antwort.wert.nummern, hinweise: liste(antwort.wert.hinweise) };
    return { bericht, ...erkundungBefunde(bericht, { gruppe: nummern, soll: this.soll, root: this.root }) };
  }

  async erkunde(wer, text, nummern) {
    const erste = this.pruefeBericht(await this.team.frage(wer, text), nummern);
    if (erste.befunde.length === 0) return erste;
    const zweite = await this.team.frage(wer, this.team.ruecksenden(wer, erste.befunde));
    return this.pruefeBericht(zweite, nummern);
  }

  erkunderLauf(text, nummern) {
    const wer = this.team.teilnehmer("erkunder");
    return { rolle: wer.rolle, lauf: () => this.erkunde(wer, text, nummern) };
  }

  async erkundeGruppen() {
    const laeufe = this.gliederung.gruppen.map((gruppe) => this.erkunderLauf(this.erkunderNachricht("Erkundung", gruppe), gruppe.nummern));
    const ergebnisse = await this.team.gruppe(laeufe);
    this.berichte = ergebnisse.map(({ bericht }) => bericht);
    for (const { bericht, befunde } of ergebnisse) if (befunde.length === 0) merkeStellen(this.gesehen, bericht);
    this.legeBerichte();
  }

  legeBerichte() {
    this.berichte.forEach((bericht, stelle) => this.lege(`erkundung-g${stelle + 1}.json`, bericht));
  }

  pruefungDerBerichte() {
    return this.berichte.map((bericht) => ({ bericht, ...erkundungBefunde(bericht, { gruppe: bericht.gruppe, soll: this.soll, root: this.root }) }));
  }

  erkunderAnnahmen() {
    return this.pruefungDerBerichte().flatMap(({ annahmen }) => annahmen);
  }

  offenePunkte() {
    return this.pruefungDerBerichte().flatMap(({ bericht, befunde }) => befunde.map((befund) => `Bericht ${bericht.gruppe.join(", ")}: ${befund}`));
  }

  async karten() {
    const sauber = this.pruefungDerBerichte().filter(({ befunde }) => befunde.length === 0).map(({ bericht }) => bericht);
    return { funktionsliste: funktionsListe(this.root, sauber), dateikarte: await dateiKarte(this.root, sauber) };
  }

  async lagebild() {
    const { funktionsliste, dateikarte } = await this.karten();
    return [
      abschnitt("Annahmen der Erkunder", punkte(this.erkunderAnnahmen().map(annahmeText))),
      abschnitt("Offene Punkte", punkte(this.offenePunkte())),
      abschnitt("Funktionsliste", json(funktionsliste)),
      abschnitt("Dateikarte", json(dateikarte)),
    ];
  }

  async zuschnittNachricht() {
    return nachricht("Zuschnitt", [abschnitt("Erkundungsberichte", json(this.berichte)), ...(await this.lagebild()), abschnitt(VORLAGE, dateiText(this.root, VORLAGE))]);
  }

  nachfrageBefunde(nachfragen) {
    if (nachfragen.length === 0) return ["nachfragen ist leer"];
    return nachfragen.flatMap((eintrag, stelle) => {
      const nummern = liste(eintrag?.nummern);
      if (!istText(eintrag?.frage) || nummern.length === 0) return [`Nachfrage ${stelle + 1}: braucht nummern und frage`];
      return nummern.filter((nummer) => !this.soll.has(nummer)).map((nummer) => `Nachfrage ${stelle + 1}: ${nummer} ist keine Nummer der Liste`);
    });
  }

  ersetze(bericht, nummern) {
    this.berichte = this.berichte.map((alt) => {
      const eigene = nummern.filter((nummer) => alt.gruppe.includes(nummer) && Object.hasOwn(bericht.nummern, nummer));
      if (eigene.length === 0) return alt;
      return { ...alt, nummern: { ...alt.nummern, ...Object.fromEntries(eigene.map((nummer) => [nummer, bericht.nummern[nummer]])) } };
    });
  }

  verbucheNachfrage({ nummern }, { bericht, befunde }) {
    const neu = befunde.length === 0 ? neueStellen(this.gesehen, bericht, nummern) : [];
    if (befunde.length === 0) {
      merkeStellen(this.gesehen, bericht);
      this.ersetze(bericht, nummern);
    }
    const ohneNeues = nummern.filter((nummer) => !neu.some((stelle) => stelle.startsWith(`${nummer}\0`)));
    for (const nummer of ohneNeues) this.ausgeschoepft.add(nummer);
    return ohneNeues;
  }

  async nachfragen(nachfragen) {
    const befunde = this.nachfrageBefunde(nachfragen);
    if (befunde.length > 0) return { befunde };
    const offen = nachfragen.filter(({ nummern }) => nummern.some((nummer) => !this.ausgeschoepft.has(nummer)));
    if (offen.length === 0) {
      const nummern = [...new Set(nachfragen.flatMap((eintrag) => eintrag.nummern))];
      throw new Ende(EXIT_BEFUNDE, `Nachfragen ausgeschöpft: ${nummern.join(", ")}`, [`Nachfragen ausgeschöpft: ${nummern.join(", ")}`]);
    }
    const laeufe = offen.map((eintrag) => this.erkunderLauf(this.erkunderNachricht("Nachfrage", { nummern: eintrag.nummern, fragen: [eintrag.frage], kopf: [eintrag.frage, ""] }), eintrag.nummern));
    const ergebnisse = await this.team.gruppe(laeufe);
    const enden = offen.flatMap((eintrag, stelle) => this.verbucheNachfrage(eintrag, ergebnisse[stelle]));
    this.legeBerichte();
    const antworten = offen.map((eintrag, stelle) => ({ ...eintrag, bericht: ergebnisse[stelle].bericht, befunde: ergebnisse[stelle].befunde }));
    const ende = enden.length > 0 ? [abschnitt("Ende der Nachfragen", `Nachfragen zu ${[...new Set(enden)].join(", ")} enden; schneide mit einer Annahme.`)] : [];
    return { weiter: nachricht("Zuschnitt", [abschnitt("Antworten auf deine Nachfragen", json(antworten)), ...ende, ...(await this.lagebild())]) };
  }

  async pruefeSchnitt(schnitt) {
    if (!istObjekt(schnitt)) return { befunde: [`schnitt fehlt: ${KEIN_JSON}`] };
    this.lege("schnitt.json", schnitt);
    this.schnitt = schnitt;
    const ergebnis = await schnittImOrdner(this.ordner, { schnitt, berichte: this.berichte, root: this.root });
    this.schnittAnnahmen = ergebnis.annahmen;
    return ergebnis.befunde.length > 0 ? { befunde: ergebnis.befunde, schnitt } : { wert: schnitt };
  }

  async schneide() {
    await this.planerStufe(await this.zuschnittNachricht(), (wert) => {
      if (Array.isArray(wert.nachfragen)) return this.nachfragen(wert.nachfragen);
      return this.pruefeSchnitt(wert.schnitt);
    }, "zuschnitt");
  }

  alleAnnahmen() {
    return this.schnittAnnahmen ?? this.erkunderAnnahmen();
  }

  pruefGrundlage(schluessel) {
    return [
      abschnitt("Nummern", nummernText(this.soll, [...this.soll.keys()])),
      abschnitt("Erkundungsberichte", json(this.berichte)),
      abschnitt("Annahmen", punkte(this.alleAnnahmen().map(annahmeText))),
      ...DOKUMENTE.map((name) => abschnitt(name, this.dokumente[name] ?? `${name} gibt es nicht.`)),
      abschnitt("Zeilen deiner Prüfliste", punkte(schluessel)),
    ];
  }

  prueferNachricht(schluessel) {
    return nachricht("Prüfung", [abschnitt("Schnittliste", json(this.schnitt)), ...this.pruefGrundlage(schluessel)]);
  }

  prueflisteDer(antwort, schluessel) {
    if (antwort.art === STILLSTAND) throw new Abbruch(`pruefer-planung: ${antwort.text}`);
    const pruefliste = antwort.art === "json" ? antwort.wert.pruefliste : undefined;
    return { pruefliste, befunde: prueflisteBefunde(pruefliste, schluessel, this.kontext()) };
  }

  async prueferLauf(pruefer, text, schluessel) {
    const ergebnis = this.prueflisteDer(await this.einzeln(pruefer, text), schluessel);
    if (ergebnis.befunde.length === 0) return ergebnis;
    return this.prueflisteDer(await this.einzeln(pruefer, this.team.ruecksenden(pruefer, ergebnis.befunde)), schluessel);
  }

  async pruefeMitFrischemPruefer(text, schluessel, { datei, grund }) {
    const pruefer = this.team.teilnehmer("pruefer-planung");
    const ergebnis = await this.prueferLauf(pruefer, text, schluessel);
    if (ergebnis.befunde.length > 0) throw new Ende(EXIT_BEFUNDE, grund, ergebnis.befunde);
    this.lege(datei, ergebnis.pruefliste);
    return { pruefer, befunde: prueferBefunde(ergebnis.pruefliste) };
  }

  async pruefliste() {
    const schluessel = prueflisteSoll(this.schnitt, this.soll, this.erkunderAnnahmen());
    const { befunde } = await this.pruefeMitFrischemPruefer(this.prueferNachricht(schluessel), schluessel, { datei: "pruefliste.json", grund: "die Prüfliste blieb nach der Rücksendung unvollständig" });
    return befunde;
  }

  nachpruefNachricht({ schluessel, geaendert, neu, entfernt }, { nachher, antworten }) {
    const zeilen = antworten.map(({ schluessel: eigener, befund, antwort }) => `${eigener}: ${befund} | ${antwort}`);
    return nachricht("Nachprüfung", [
      abschnitt("Schnittliste", json(nachher)),
      abschnitt("Geänderte Aufträge", punkte([`geändert: ${geaendert.join(", ") || "keiner"}`, `neu: ${neu.join(", ") || "keiner"}`, `entfernt: ${entfernt.join(", ") || "keiner"}`])),
      abschnitt("Befunde der vorigen Prüfung und Antworten des Planers", punkte(zeilen)),
      ...this.pruefGrundlage(schluessel),
    ]);
  }

  async nachpruefung({ befunde, vorher, nachher, antworten }) {
    const auswahl = nachpruefSchluessel({ vorher, nachher, befunde, soll: this.soll, annahmen: this.erkunderAnnahmen() });
    const runde = this.nachpruefungen.length + 1;
    const grund = "die Prüfliste der Nachprüfung blieb nach der Rücksendung unvollständig";
    const { pruefer, befunde: neue } = await this.pruefeMitFrischemPruefer(this.nachpruefNachricht(auswahl, { nachher, antworten }), auswahl.schluessel, { datei: `nachpruefung-${runde}.json`, grund });
    this.nachpruefungen.push({ runde, sitzung: pruefer.sitzung, schluessel: auswahl.schluessel, befunde: neue.length, entfallen: auswahl.entfallen });
    return neue;
  }

  verbucheAntworten(befunde, antworten) {
    return befunde.map(({ schluessel, befund }) => {
      const { antwort } = antworten.find((eintrag) => eintrag.schluessel === schluessel);
      const ziel = istZurueckgewiesen(antwort) ? this.befunde.zurueckgewiesen : this.befunde.korrigiert;
      const eintrag = { schluessel, befund, antwort };
      ziel.push(eintrag);
      return eintrag;
    });
  }

  async beantworte(befunde, wert, vorher) {
    if (!istObjekt(wert.schnitt)) return { befunde: [`schnitt fehlt: ${KEIN_JSON}`] };
    const offen = antwortenBefunde(befunde, wert.antworten, { alt: vorher, neu: wert.schnitt });
    const skript = liste((await this.pruefeSchnitt(wert.schnitt)).befunde);
    if (offen.length > 0 || skript.length > 0) return { befunde: [...offen, ...skript], schnitt: wert.schnitt };
    return { wert: { schnitt: wert.schnitt, antworten: this.verbucheAntworten(befunde, wert.antworten) } };
  }

  async korrigiere(befunde, vorher) {
    let letzte = [];
    const verarbeite = (wert) => {
      letzte = liste(wert.antworten);
      return this.beantworte(befunde, wert, vorher);
    };
    try {
      return await this.planerStufe(this.team.ruecksenden(this.planer, befunde.map(prueferZeile)), verarbeite, "korrektur");
    } catch (fehler) {
      if (fehler instanceof Ende) fehler.befunde.push(...befunde.map((befund) => offenerPrueferBefund(befund, letzte)));
      throw fehler;
    }
  }

  async pruefe() {
    let befunde = await this.pruefliste();
    let schnitt = this.schnitt;
    const schleife = this.schleife("pruefung");
    while (befunde.length > 0) {
      const ende = schleife.endeNachRunde(befunde, schnitt, this.soll);
      if (ende !== null) throw new Ende(EXIT_BEFUNDE, ende.grund, befunde.map(prueferZeile));
      const vorher = schnitt;
      const korrektur = await this.korrigiere(befunde, vorher);
      schnitt = korrektur.schnitt;
      befunde = await this.nachpruefung({ befunde, vorher, nachher: schnitt, antworten: korrektur.antworten });
    }
  }

  entwurfNachricht(bereich, namen) {
    const auftraege = this.schnitt.auftraege.filter((auftrag) => auftrag.bereich === bereich);
    const nummern = auftraege.flatMap(({ prueft }) => liste(prueft));
    const berichte = this.berichte.map((bericht) => ({ ...bericht, nummern: Object.fromEntries(Object.entries(bericht.nummern).filter(([nummer]) => nummern.includes(nummer))) }));
    const ueberschriften = [...new Set(this.gruppenVon(nummern).flatMap((gruppe) => gruppe.ueberschriften))];
    const vorlage = abschnitte(dateiText(this.root, VORLAGE), [VORLAGE_ENTWURF]).abschnitte.get(VORLAGE_ENTWURF) ?? "";
    return nachricht("Entwurf", [
      abschnitt("Bereich", bereich),
      abschnitt("Aufträge", json(auftraege)),
      abschnitt("Erkundungsberichte", json(berichte.filter((bericht) => Object.keys(bericht.nummern).length > 0))),
      abschnitt("Abschnitte des Design Docs", this.designAbschnitte(ueberschriften)),
      abschnitt("Gemeinsame Namen", punkte(namen)),
      abschnitt("Entwurf je Bereich (phase-vorlage.md)", vorlage),
    ]);
  }

  async schreibeEntwurf(wer, text, namen) {
    const lies = (antwort) => (antwort.art === "json" ? antwort.wert.entwurf : undefined);
    let entwurf = lies(await this.team.frage(wer, text));
    let befunde = entwurfBefunde(entwurf, namen);
    if (befunde.length > 0) {
      entwurf = lies(await this.team.frage(wer, this.team.ruecksenden(wer, befunde)));
      befunde = entwurfBefunde(entwurf, namen);
    }
    return { entwurf, befunde };
  }

  namenDes(bereich) {
    const eigene = liste(this.schnitt.gemeinsameNamen).filter((eintrag) => eintrag?.anbieter === bereich || eintrag?.nutzer === bereich);
    return eigene.map(({ name }) => name);
  }

  async entwerfe() {
    const bereiche = [...new Set(this.schnitt.auftraege.map(({ bereich }) => bereich))];
    const laeufe = bereiche.map((bereich) => {
      const namen = this.namenDes(bereich);
      const wer = this.team.teilnehmer("entwurf");
      return { rolle: wer.rolle, lauf: () => this.schreibeEntwurf(wer, this.entwurfNachricht(bereich, namen), namen) };
    });
    const ergebnisse = await this.team.gruppe(laeufe);
    const offen = ergebnisse.flatMap(({ befunde }, stelle) => befunde.map((befund) => `Entwurf ${bereiche[stelle]}: ${befund}`));
    if (offen.length > 0) throw new Ende(EXIT_BEFUNDE, "Befunde zu Entwürfen blieben nach der Rücksendung offen", offen);
    const entwuerfe = Object.fromEntries(bereiche.map((bereich, stelle) => [bereich, ergebnisse[stelle].entwurf]));
    this.lege("entwuerfe.json", entwuerfe);
    const { befunde } = await setzePhaseZusammen(this.ordner, { schnitt: this.schnitt, berichte: this.berichte, entwuerfe, root: this.root });
    if (befunde.length > 0) throw new Ende(EXIT_BEFUNDE, "die Phase hat Befunde", befunde);
  }

  async laufe() {
    await this.gliedere();
    await this.erkundeGruppen();
    await this.schneide();
    await this.pruefe();
    await this.entwerfe();
  }
}

function aufrufFehler(ordner) {
  if (!existsSync(join(ordner, "pitch.md")) || !existsSync(join(ordner, "sicherheit.md"))) return `${ordner} enthält kein pitch.md und sicherheit.md`;
  if (existsSync(join(ordner, PHASE))) return `${join(ordner, PHASE)} gibt es schon; plane überschreibt nichts`;
  return existsSync(join(ordner, PLANUNG)) ? `${join(ordner, PLANUNG)} gibt es schon; plane überschreibt nichts` : null;
}

function ausgang(fehler) {
  if (fehler instanceof Ende) return { exit: fehler.exit, grund: fehler.message, offen: fehler.befunde };
  if (fehler instanceof Abbruch) return { exit: EXIT_ABBRUCH, grund: fehler.message, offen: [] };
  throw fehler;
}

function berichte(planung, ergebnis) {
  const lauf = {
    ...ergebnis,
    beginn: planung.beginn,
    schnitt: planung.schnitt,
    annahmen: planung.alleAnnahmen(),
    befunde: { ...planung.befunde, offen: ergebnis.offen },
    schleifen: planung.schleifen.map((schleife) => schleife.bericht()),
    nachpruefungen: planung.nachpruefungen,
  };
  const bericht = planBericht(lauf, { root: planung.root, team: planung.team });
  druckePlanBericht(bericht, schreibePlanBericht(planung.root, bericht));
  for (const befund of ergebnis.offen) console.error(befund);
  return ergebnis.exit;
}

export async function plane(ordnerAngabe, root) {
  const ordner = resolve(root, ordnerAngabe);
  const fehler = aufrufFehler(ordner);
  if (fehler !== null) {
    console.error(fehler);
    return EXIT_AUFRUF;
  }
  const { soll, andererAusgang, unklar } = nummernImOrdner(ordner);
  const planung = new Planung(root, ordner);
  planung.beginn = Date.now();
  planung.beginne(soll, andererAusgang);
  if (unklar.length > 0) return berichte(planung, { exit: EXIT_BEFUNDE, grund: "die Nummern der Dokumente sind nicht bestimmbar", offen: unklar });
  try {
    await planung.laufe();
    return berichte(planung, { exit: EXIT_GRUEN, grund: `grün: ${join(ordner, PHASE)} geschrieben`, offen: [] });
  } catch (abbruch) {
    return berichte(planung, ausgang(abbruch));
  }
}

