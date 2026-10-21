import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { inspect } from "node:util";

import { STILLSTAND } from "../verlauf.mjs";
import { ABSICHT, bereichSchluessel } from "../format.mjs";
import { abschnitte } from "./abschnitte.mjs";
import { absichtAusPitch, pitchAbsichtBefunde } from "./absicht.mjs";
import {
  antwortenBefunde,
  entwurfBefunde,
  fuerDenPitch,
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
import { Kostendeckel, deckelAus, gemesseneKosten, gemesseneLaeufe } from "./deckel.mjs";
import { berichtsGeruest, erkundungBefunde, istObjekt, istText, liste, namenImWenn, schreibeJsonAtomar } from "./erkundung.mjs";
import { FINGERABDRUCK, NACHFRAGEN, ausgangsstand, erkundungsDatei, fingerabdruck, liesFortsetzung } from "./fingerabdruck.mjs";
import { issueAus } from "./issue.mjs";
import { Fortschritt } from "./fortschritt.mjs";
import { dateiKarte, funktionsListe } from "./funktionsliste.mjs";
import { PITCH, nummernImOrdner } from "./nummern.mjs";
import { teilePruefliste } from "./aufteilung.mjs";
import { annahmeText, druckePlanBericht, planBericht, schreibePlanBericht } from "./planbericht.mjs";
import { DOKUMENTE, bereichskonflikte, schnittImOrdner, umbauPitchKarten } from "./schnitt.mjs";
import { Abbruch, Team } from "./team.mjs";
import { setzeTeillisteEin } from "./teilliste.mjs";
import { verdichteBerichte } from "./verdichtung.mjs";
import { setzePhaseZusammen } from "./zusammensetzen.mjs";

export const EXIT_GRUEN = 0;
export const EXIT_ABBRUCH = 1;
export const EXIT_AUFRUF = 2;
export const EXIT_PASST_NICHT = 3;
export const EXIT_BEFUNDE = 4;
export const EXIT_DECKEL = 5;
const PLANUNG = "planung";
const SCHON_DA = "EEXIST";
const PHASE = "phase.json";
const DESIGN = "design.md";
export const VORLAGE = ".claude/skills/pitch/phase-vorlage.md";
const VORLAGE_ENTWURF = "## Entwurf je Bereich";
const PLANER_KONTEXT = ["CLAUDE.md", ".github/CODEOWNERS", "tools/bereiche.json"];
const ERKUNDER_KONTEXT = ["CLAUDE.md", "tools/bereiche.json"];
const GELESEN = [...new Set([...PLANER_KONTEXT, ...ERKUNDER_KONTEXT, VORLAGE])];
const JSON_EINRUECKUNG = 2;
const NEUER_NAME = "Gibt es eine Route oder einen Namen noch nicht, meldest du ihn als Eingang mit `datei` und `ausweg` „nicht gefunden, weil `<Name>` entsteht neu in <Datei>“, der den Namen wörtlich nennt, und dazu eine Änderung in genau dieser Datei.";
const PITCH_NUR_NEUSCHNITT = "„Pitch ändern“ gibt es nur beim Neuschnitt; antworte mit der Antwort, die an dieser Stelle verlangt ist, oder mit „Zerlegung passt nicht: …“";
const KEIN_JSON = "die Antwort enthält kein JSON in der verlangten Form";
const WEG = "weg:";
const TEILLISTE_ZUGLEICH = "Regel Teilliste: schnitt und teilliste zugleich; schick eines";
const TEILLISTE_ZU_FRUEH = "Regel Teilliste: teilliste gibt es erst nach einer Schnittliste";
const KONFLIKTE = "Bereichskonflikte";
const NACHFRAGEN_ENDE = "Ende der Nachfragen";
const WELLE_VERBRAUCHT = "Die eine Nachfrage-Welle dieses Planungslaufs ist verbraucht; es wird nicht mehr erkundet. Schneide mit einer Annahme und nenn sie unter `annahmen`, oder antworte „Zerlegung passt nicht: …“, wenn ohne die fehlende Tatsache keine Zerlegung geht. Fragst du noch einmal nach, endet die Planung mit Befunden.";

export class Ende extends Error {
  constructor(exit, grund, befunde = []) {
    super(grund);
    this.exit = exit;
    this.befunde = befunde;
  }
}

function zusammengefuegt(schluessel, ergebnisse) {
  const zeilen = new Map(ergebnisse.flatMap(({ pruefliste }) => pruefliste).map((zeile) => [zeile.schluessel, zeile]));
  return schluessel.map((eintrag) => zeilen.get(eintrag));
}

export { liste, schreibeJsonAtomar };

export function json(wert) {
  return `\`\`\`json\n${JSON.stringify(wert, null, JSON_EINRUECKUNG)}\n\`\`\``;
}

export function abschnitt(titel, inhalt) {
  return `### ${titel}\n\n${String(inhalt).trimEnd()}\n`;
}

export function nachricht(ueberschrift, teile) {
  return [`## ${ueberschrift}`, "", ...teile].join("\n");
}

function punkte(eintraege, leer = "keine") {
  return eintraege.length === 0 ? leer : eintraege.map((eintrag) => `- ${eintrag}`).join("\n");
}

export function dateiText(root, pfad) {
  const datei = join(root, pfad);
  return existsSync(datei) ? readFileSync(datei, "utf8") : `${pfad} gibt es nicht.`;
}

export function prueferZeile({ schluessel, befund, fundstelle }) {
  return `${schluessel}: ${befund} (Fundstelle: ${fundstelle})`;
}

function wegBefundZeile({ schluessel, befund, fundstelle }) {
  return `Weg ${schluessel.slice(WEG.length)}: ${befund} (Fundstelle: ${fundstelle})`;
}

function gruppenWegZeile(nummern, text) {
  const eigene = nummern.filter((nummer) => text.startsWith(`${WEG}${nummer}:`));
  return { nummern: eigene.length > 0 ? eigene : nummern, zeile: `Weg ${nummern.join(", ")}: ${text}` };
}

function offenerPrueferBefund(befund, antworten) {
  const antwort = antworten.find((eintrag) => eintrag?.schluessel === befund.schluessel)?.antwort;
  return istText(antwort) ? `${prueferZeile(befund)} | ${antwort}` : prueferZeile(befund);
}

function nachfrageAntwort({ frage, nummern, bericht, befunde }, stelle) {
  const teile = [`Frage: ${frage}`, `Nummern: ${nummern.join(", ")}`, verdichteBerichte([bericht]), `Befunde:\n${punkte(befunde)}`];
  return abschnitt(`Antwort auf deine Nachfrage ${stelle + 1}`, teile.join("\n\n"));
}

function welleTeile({ antworten, enden }) {
  const ende = enden.length > 0 ? [abschnitt(NACHFRAGEN_ENDE, `Nachfragen zu ${enden.join(", ")} enden; schneide mit einer Annahme.`)] : [];
  return [...antworten.map(nachfrageAntwort), ...ende];
}

function konfliktAusweg(nummern) {
  return `frag nur zu ${nummern} nach, schick eine Schnittliste, die ${nummern} auf mehrere Aufträge mit erlaubtem bereich verteilt oder, wenn ein bestehender Test die Dateien zwingend koppelt, ihre Produktdateien als Liste in einen bereich legt, oder antworte mit „Zerlegung passt nicht: …“`;
}

function konfliktBefunde(nachfragen, offen) {
  if (offen.length === 0) return [];
  const nummern = offen.join(", ");
  return nachfragen.flatMap((eintrag, stelle) => (eintrag.nummern.every((nummer) => offen.includes(nummer)) ? [] : [`Nachfrage ${stelle + 1}: Bereichskonflikt ${nummern} ist offen; ${konfliktAusweg(nummern)}`]));
}

function nachfragenEnde(grund, nachfragen) {
  const text = `${grund}: ${[...new Set(nachfragen.flatMap((eintrag) => eintrag.nummern))].join(", ")}`;
  return new Ende(EXIT_BEFUNDE, text, [text]);
}

function konfliktTeil(konflikte) {
  if (konflikte.length === 0) return [];
  const nummern = konflikte.map(({ nummer }) => nummer).join(", ");
  const zeilen = konflikte.map(({ nummer, dateien }) => `${nummer}: ${dateien.join(", ")}`);
  const regel = `Die Produktdateien dieser Nummern haben als engsten gemeinsamen Ordner nur die Repo-Wurzel, und die Repo-Wurzel ist nie ein bereich; zulässig ist dann nur eine Liste genau dieser Dateien mit bereichsgrund und koppelndem Test. Klär das zuerst: ${konfliktAusweg(nummern)}. Löst deine Schnittliste einen Konflikt mit einer solchen Liste, ist er nicht mehr offen. Andere Nachfragen nimmt das Skript erst an, wenn kein Konflikt mehr offen ist. Weist es, solange derselbe Konflikt offen ist, zum zweiten Mal eine Nachfrage ab, endet die Planung mit Befunden.`;
  return [abschnitt(KONFLIKTE, `${regel}\n\n${punkte(zeilen)}`)];
}

export function nummernText(soll, nummern) {
  return nummern.map((nummer) => `#### ${nummer} (${soll.get(nummer)?.quelle})\n\n${soll.get(nummer)?.text}\n`).join("\n");
}

export class Planung {
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
    this.wegpruefungen = [];
    this.wegZaehler = new Map();
    this.wegOffen = [];
    this.abgewiesenBei = null;
    this.nachfrageWellen = 0;
    this.beantworteteWellen = [];
    this.nachfragenBeendet = false;
    this.kostendeckel = null;
    this.laufInWelle = new AsyncLocalStorage();
  }

  beginne({ soll, andererAusgang, nurUmbau }) {
    this.soll = soll;
    this.andererAusgang = andererAusgang;
    this.nurUmbau = nurUmbau;
    this.team = new Team(this.root, this.ordner);
    this.planer = this.team.teilnehmer("planer");
  }

  lege(name, wert) {
    schreibeJsonAtomar(join(this.ablage, name), wert);
  }

  kontext() {
    return { root: this.root, dokumente: this.dokumente };
  }

  gemessen() {
    return gemesseneKosten(this.root, this.team.beteiligte);
  }

  wegpruefKosten() {
    const sitzungen = new Set(this.wegpruefungen.map(({ sitzung }) => sitzung));
    const pruefer = this.team.beteiligte.filter(({ rolle, sitzung }) => rolle === "pruefer-planung" && sitzungen.has(sitzung));
    return { "pruefer-planung": gemesseneLaeufe(this.root, pruefer) };
  }

  messung() {
    return { gemessen: this.gemessen(), jeRolle: this.wegpruefKosten() };
  }

  pruefeDeckel(rollen, schritt) {
    if (this.kostendeckel === null) return 0;
    const messung = this.messung();
    const grund = this.kostendeckel.ueber(messung, rollen, schritt);
    if (grund === null) return messung.gemessen;
    if (this.berichte.length > 0) this.legeFingerabdruck();
    throw new Ende(EXIT_DECKEL, grund);
  }

  pruefeSchritt(rolle, schritt) {
    if (this.kostendeckel === null) return;
    const grund = this.kostendeckel.imLauf(this.laufInWelle.getStore(), this.messung(), { rolle, schritt });
    if (grund !== null) throw new Ende(EXIT_DECKEL, grund);
  }

  inWelle({ rolle, lauf }, stelle) {
    return { rolle, lauf: () => this.laufInWelle.run(stelle, lauf).finally(() => this.kostendeckel?.endeLauf(stelle)) };
  }

  nachDeckelHalt(fehler, wegpruefungen) {
    if (fehler instanceof Ende && fehler.exit === EXIT_DECKEL && this.berichte.length > 0) {
      this.wegpruefungen = wegpruefungen;
      this.legeFingerabdruck();
    }
    throw fehler;
  }

  async welle(laeufe, schritt) {
    const rollen = laeufe.map(({ rolle }) => rolle);
    const vorher = this.pruefeDeckel(rollen, schritt);
    const wegpruefungen = [...this.wegpruefungen];
    const ergebnisse = await this.team.gruppe(laeufe.map((eintrag, stelle) => this.inWelle(eintrag, stelle))).catch((fehler) => this.nachDeckelHalt(fehler, wegpruefungen));
    if (this.kostendeckel !== null) this.kostendeckel.verbuche(rollen, this.gemessen() - vorher);
    return ergebnisse;
  }

  async einzeln(wer, text, art) {
    const [antwort] = await this.welle([{ rolle: wer.rolle, lauf: () => this.team.frage(wer, text) }], `Antwort des Planers (${art})`);
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
      const antwort = await this.einzeln(this.planer, naechste, art);
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

  gliederungsTeile() {
    const nummern = [...this.soll.keys()];
    return [
      ...DOKUMENTE.map((name) => abschnitt(name, this.dokumente[name] ?? `${name} gibt es nicht.`)),
      abschnitt("Nummern", nummernText(this.soll, nummern)),
      abschnitt("Bedrohungen mit anderem Ausgang (gehören zu keinem Auftrag)", punkte([...this.andererAusgang])),
      ...PLANER_KONTEXT.map((pfad) => abschnitt(pfad, dateiText(this.root, pfad))),
    ];
  }

  gliederungsNachricht() {
    return nachricht("Gliederung", this.gliederungsTeile());
  }

  ohneGliederung() {
    return this.nurUmbau && this.soll.size === 0;
  }

  async gliedere() {
    this.gliederung = this.ohneGliederung() ? { gruppen: [] } : await this.planerStufe(this.gliederungsNachricht(), (wert) => {
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

  designTeile(nummern) {
    const gruppen = this.gruppenVon(nummern);
    const ueberschriften = [...new Set(gruppen.flatMap((gruppe) => gruppe.ueberschriften))];
    return [abschnitt("Eingang laut Design Doc", punkte(gruppen.map((gruppe) => gruppe.eingang))), abschnitt("Abschnitte des Design Docs", this.designAbschnitte(ueberschriften))];
  }

  absichtTeil() {
    const absicht = absichtAusPitch(this.dokumente[PITCH] ?? "");
    return absicht === undefined ? [] : [abschnitt(ABSICHT, absicht)];
  }

  erkunderNachricht(ueberschrift, { nummern, fragen, kopf = [] }) {
    return nachricht(ueberschrift, [
      ...kopf,
      ...this.absichtTeil(),
      abschnitt("Deine Nummern", nummernText(this.soll, nummern)),
      ...this.designTeile(nummern),
      abschnitt("Fragen des Planers", punkte(fragen)),
      abschnitt("Gerüst deines Berichts", json(berichtsGeruest(nummern))),
      abschnitt("Namen aus dem Wenn, die in deiner Eingangsdatei stehen müssen", `${punkte(nummern.map((nummer) => this.namenZeile(nummer)))}\n\n${NEUER_NAME}`),
      ...ERKUNDER_KONTEXT.map((pfad) => abschnitt(pfad, dateiText(this.root, pfad))),
    ]);
  }

  namenZeile(nummer) {
    const szenario = this.soll.get(nummer);
    const namen = namenImWenn(szenario?.text).map((name) => `\`${name}\``);
    return `${nummer}: ${namen.join(", ") || "keine"}`;
  }

  pruefeBericht(antwort, nummern) {
    const leer = { gruppe: nummern, nummern: {}, hinweise: [] };
    if (antwort.art === STILLSTAND) return { bericht: leer, befunde: [antwort.text], annahmen: [] };
    if (antwort.art !== "json" || !istObjekt(antwort.wert.nummern)) return { bericht: leer, befunde: [`nummern fehlt: ${KEIN_JSON}`], annahmen: [] };
    const bericht = { gruppe: nummern, nummern: antwort.wert.nummern, hinweise: liste(antwort.wert.hinweise) };
    return { bericht, ...erkundungBefunde(bericht, { gruppe: nummern, soll: this.soll, root: this.root }) };
  }

  async berichtVon(wer, text, nummern) {
    const erste = this.pruefeBericht(await this.team.frage(wer, text), nummern);
    if (erste.befunde.length === 0) return erste;
    this.pruefeSchritt(wer.rolle, `Rücksendung an ${wer.rolle} (${nummern.join(", ")})`);
    const zweite = await this.team.frage(wer, this.team.ruecksenden(wer, erste.befunde));
    return this.pruefeBericht(zweite, nummern);
  }

  async erkunde(wer, text, nummern) {
    const ergebnis = await this.berichtVon(wer, text, nummern);
    return ergebnis.befunde.length === 0 ? this.wegPruefung(wer, ergebnis, nummern) : ergebnis;
  }

  wegNachricht(nummern, bericht, nachKorrektur) {
    return nachricht("Wegprüfung", [
      abschnitt("Nummern", nummernText(this.soll, nummern)),
      ...(nachKorrektur ? [] : this.designTeile(nummern)),
      abschnitt(nachKorrektur ? "Korrigierter Erkundungsbericht" : "Erkundungsbericht", json(bericht)),
      abschnitt("Zeilen deiner Prüfliste", punkte(nummern.map((nummer) => `${WEG}${nummer}`))),
    ]);
  }

  naechsteWegDatei(erste) {
    const zahl = (this.wegZaehler.get(erste) ?? 0) + 1;
    this.wegZaehler.set(erste, zahl);
    return `wegpruefung-${erste}-${zahl}.json`;
  }

  async wegRunde(weg, text) {
    const schluessel = weg.nummern.map((nummer) => `${WEG}${nummer}`);
    const lauf = await this.prueferLauf(weg.pruefer, text, schluessel);
    this.lege(this.naechsteWegDatei(weg.nummern[0]), lauf);
    const befunde = prueferBefunde(liste(lauf.pruefliste).filter(istObjekt));
    const offen = befunde.map((befund) => ({ nummern: [befund.schluessel.slice(WEG.length)], zeile: wegBefundZeile(befund) }));
    if (lauf.befunde.length > 0) return { befunde: [], offen: [...lauf.befunde.map((befund) => gruppenWegZeile(weg.nummern, befund)), ...offen] };
    return { befunde, offen, ende: befunde.length > 0 && weg.schleife.endeNachRunde(befunde, null, this.soll) !== null };
  }

  verbucheWegpruefung({ pruefer, nummern, runden }, sauber, offen) {
    this.wegpruefungen.push({ nummern, sitzung: pruefer.sitzung, runden, offen: offen.map(({ zeile }) => zeile) });
    return { ...sauber, weg: { nummern, offen } };
  }

  uebernimmWeg({ weg }) {
    this.wegOffen = [...this.wegOffen.filter((eintrag) => !eintrag.nummern.some((nummer) => weg.nummern.includes(nummer))), ...weg.offen];
  }

  async wegPruefung(wer, ergebnis, nummern) {
    const weg = { pruefer: this.team.teilnehmer("pruefer-planung"), schleife: this.schleife("weg"), nummern };
    let sauber = ergebnis;
    let text = this.wegNachricht(nummern, sauber.bericht, false);
    for (let runden = 1; ; runden += 1) {
      this.pruefeSchritt(weg.pruefer.rolle, `Wegprüfung ${nummern.join(", ")}, Runde ${runden}`);
      const runde = await this.wegRunde(weg, text);
      if (runde.befunde.length === 0 || runde.ende) return this.verbucheWegpruefung({ ...weg, runden }, sauber, runde.offen);
      this.pruefeSchritt(wer.rolle, `Korrektur nach der Wegprüfung ${nummern.join(", ")}, Runde ${runden}`);
      const neu = await this.berichtVon(wer, this.team.ruecksenden(wer, runde.befunde.map(prueferZeile)), nummern);
      if (neu.befunde.length > 0) return this.verbucheWegpruefung({ ...weg, runden }, sauber, [...runde.offen, ...neu.befunde.map((befund) => gruppenWegZeile(nummern, `Korrektur verworfen: ${befund}`))]);
      sauber = neu;
      text = this.wegNachricht(nummern, sauber.bericht, true);
    }
  }

  erkunderLauf(text, nummern) {
    const wer = this.team.teilnehmer("erkunder");
    return { rolle: wer.rolle, lauf: () => this.erkunde(wer, text, nummern) };
  }

  async erkundeGruppen() {
    const laeufe = this.gliederung.gruppen.map((gruppe) => this.erkunderLauf(this.erkunderNachricht("Erkundung", gruppe), gruppe.nummern));
    const ergebnisse = await this.welle(laeufe, "Erkundung");
    this.berichte = ergebnisse.map(({ bericht }) => bericht);
    for (const ergebnis of ergebnisse) if (ergebnis.befunde.length === 0) {
      merkeStellen(this.gesehen, ergebnis.bericht);
      this.uebernimmWeg(ergebnis);
    }
    this.legeBerichte();
  }

  legeBerichte() {
    this.berichte.forEach((bericht, stelle) => this.lege(erkundungsDatei(stelle), bericht));
  }

  ausgangsstand() {
    return ausgangsstand(this.root, this.ordner, { arbeitsbaum: this.team.anfang.baum, kontext: GELESEN });
  }

  legeFingerabdruck() {
    this.lege(NACHFRAGEN, this.beantworteteWellen);
    const zustand = { gesehen: [...this.gesehen], ausgeschoepft: [...this.ausgeschoepft], wegOffen: this.wegOffen, wegpruefungen: this.wegpruefungen, wegZaehler: [...this.wegZaehler], nachfrageWellen: this.nachfrageWellen };
    this.lege(FINGERABDRUCK, fingerabdruck(this.stand, { ablage: this.ablage, anzahl: this.berichte.length, zustand }));
  }

  pruefungDerBerichte() {
    return this.berichte.map((bericht) => ({ bericht, ...erkundungBefunde(bericht, { gruppe: bericht.gruppe, soll: this.soll, root: this.root }) }));
  }

  erkunderAnnahmen() {
    return this.pruefungDerBerichte().flatMap(({ annahmen }) => annahmen);
  }

  offenePunkte() {
    const berichte = this.pruefungDerBerichte().flatMap(({ bericht, befunde }) => befunde.map((befund) => `Bericht ${bericht.gruppe.join(", ")}: ${befund}`));
    return [...berichte, ...new Set(this.wegOffen.map(({ zeile }) => zeile))];
  }

  sauberBerichte() {
    return this.pruefungDerBerichte().filter(({ befunde }) => befunde.length === 0).map(({ bericht }) => bericht);
  }

  offeneKonflikte() {
    return bereichskonflikte(this.sauberBerichte(), { schnitt: this.schnitt, root: this.root });
  }

  async karten() {
    const sauber = this.sauberBerichte();
    return { funktionsliste: funktionsListe(this.root, sauber), dateikarte: await dateiKarte(this.root, sauber) };
  }

  async lagebild() {
    const { funktionsliste, dateikarte } = await this.karten();
    return [
      ...konfliktTeil(this.offeneKonflikte()),
      abschnitt("Annahmen der Erkunder", punkte(this.erkunderAnnahmen().map(annahmeText))),
      abschnitt("Offene Punkte", punkte(this.offenePunkte())),
      abschnitt("Funktionsliste", json(funktionsliste)),
      abschnitt("Dateikarte", json(dateikarte)),
    ];
  }

  async zuschnittTeile() {
    return [abschnitt("Erkundungsberichte (verdichtet)", verdichteBerichte(this.berichte)), ...(await this.lagebild()), abschnitt(VORLAGE, dateiText(this.root, VORLAGE))];
  }

  async zuschnittNachricht() {
    const dokumente = this.ohneGliederung() ? this.gliederungsTeile() : [];
    return nachricht("Zuschnitt", [...dokumente, ...(await this.zuschnittTeile())]);
  }

  nachfrageBefunde(nachfragen) {
    if (nachfragen.length === 0) return ["nachfragen ist leer"];
    return nachfragen.flatMap((eintrag, stelle) => {
      const nummern = liste(eintrag?.nummern);
      if (!istText(eintrag?.frage) || nummern.length === 0) return [`Nachfrage ${stelle + 1}: braucht nummern und frage`];
      return nummern.filter((nummer) => !this.soll.has(nummer)).map((nummer) => `Nachfrage ${stelle + 1}: ${nummer} ist keine Nummer der Liste`);
    });
  }

  weiseNachfragenAbOderBeende(befunde, konflikt) {
    if (this.abgewiesenBei === konflikt) throw new Ende(EXIT_BEFUNDE, `Bereichskonflikt ${konflikt}: zum zweiten Mal Nachfragen zu anderen Nummern`, befunde);
    this.abgewiesenBei = konflikt;
    return { weiter: this.team.ruecksenden(this.planer, befunde) };
  }

  ersetze(bericht, nummern) {
    this.berichte = this.berichte.map((alt) => {
      const eigene = nummern.filter((nummer) => alt.gruppe.includes(nummer) && Object.hasOwn(bericht.nummern, nummer));
      if (eigene.length === 0) return alt;
      return { ...alt, nummern: { ...alt.nummern, ...Object.fromEntries(eigene.map((nummer) => [nummer, bericht.nummern[nummer]])) } };
    });
  }

  verbucheNachfrage({ nummern }, ergebnis) {
    const { bericht, befunde } = ergebnis;
    const neu = befunde.length === 0 ? neueStellen(this.gesehen, bericht, nummern) : [];
    if (befunde.length === 0) {
      merkeStellen(this.gesehen, bericht);
      this.ersetze(bericht, nummern);
      this.uebernimmWeg(ergebnis);
    }
    const ohneNeues = nummern.filter((nummer) => !neu.some((stelle) => stelle.startsWith(`${nummer}\0`)));
    for (const nummer of ohneNeues) this.ausgeschoepft.add(nummer);
    return ohneNeues;
  }

  async beendeNachfragen(nachfragen) {
    if (this.nachfragenBeendet) throw nachfragenEnde("Nachfragen nach der ersten Welle", nachfragen);
    this.nachfragenBeendet = true;
    return { weiter: nachricht("Zuschnitt", [abschnitt(NACHFRAGEN_ENDE, WELLE_VERBRAUCHT), ...(await this.lagebild())]) };
  }

  async nachfragen(nachfragen) {
    const befunde = this.nachfrageBefunde(nachfragen);
    if (befunde.length > 0) return { befunde };
    const konflikte = this.offeneKonflikte().map(({ nummer }) => nummer);
    const gesperrt = konfliktBefunde(nachfragen, konflikte);
    if (gesperrt.length > 0) return this.weiseNachfragenAbOderBeende(gesperrt, konflikte.join(", "));
    const klaerung = konflikte.length > 0;
    if (!klaerung && this.nachfrageWellen >= 1) return this.beendeNachfragen(nachfragen);
    const offen = nachfragen.filter(({ nummern }) => nummern.some((nummer) => !this.ausgeschoepft.has(nummer)));
    if (offen.length === 0) throw nachfragenEnde("Nachfragen ausgeschöpft", nachfragen);
    const laeufe = offen.map((eintrag) => this.erkunderLauf(this.erkunderNachricht("Nachfrage", { nummern: eintrag.nummern, fragen: [eintrag.frage], kopf: [eintrag.frage, ""] }), eintrag.nummern));
    const ergebnisse = await this.welle(laeufe, "Nachfrage-Welle");
    if (!klaerung) this.nachfrageWellen += 1;
    const enden = offen.flatMap((eintrag, stelle) => this.verbucheNachfrage(eintrag, ergebnisse[stelle]));
    const welle = { antworten: offen.map(({ frage, nummern }, stelle) => ({ frage, nummern, bericht: ergebnisse[stelle].bericht, befunde: ergebnisse[stelle].befunde })), enden: [...new Set(enden)] };
    this.beantworteteWellen.push(welle);
    this.legeBerichte();
    this.legeFingerabdruck();
    return { weiter: nachricht("Zuschnitt", [...welleTeile(welle), ...(await this.lagebild())]) };
  }

  async pruefeSchnitt(schnitt) {
    if (!istObjekt(schnitt)) return { befunde: [`schnitt fehlt: ${KEIN_JSON}`] };
    this.lege("schnitt.json", schnitt);
    this.schnitt = schnitt;
    const ergebnis = await schnittImOrdner(this.ordner, { schnitt, berichte: this.berichte, root: this.root });
    this.schnittAnnahmen = ergebnis.annahmen;
    return ergebnis.befunde.length > 0 ? { befunde: ergebnis.befunde, schnitt } : { wert: schnitt };
  }

  schnittAusAntwort(wert) {
    if (wert.teilliste === undefined) return { schnitt: wert.schnitt, befunde: [] };
    if (wert.schnitt !== undefined) return { befunde: [TEILLISTE_ZUGLEICH] };
    if (!istObjekt(this.schnitt)) return { befunde: [TEILLISTE_ZU_FRUEH] };
    return setzeTeillisteEin(this.schnitt, wert.teilliste);
  }

  async schneide() {
    await this.planerStufe(await this.zuschnittNachricht(), (wert) => {
      if (Array.isArray(wert.nachfragen)) return this.nachfragen(wert.nachfragen);
      const { schnitt, befunde } = this.schnittAusAntwort(wert);
      return befunde.length > 0 ? { befunde, schnitt: this.schnitt } : this.pruefeSchnitt(schnitt);
    }, "zuschnitt");
  }

  alleAnnahmen() {
    return this.schnittAnnahmen ?? this.erkunderAnnahmen();
  }

  pruefGrundlage(schluessel, { nummern = [...this.soll.keys()], berichte = [abschnitt("Erkundungsberichte", json(this.berichte))] } = {}) {
    return [
      abschnitt("Nummern", nummernText(this.soll, nummern)),
      ...berichte,
      abschnitt("Annahmen", punkte(this.alleAnnahmen().map(annahmeText))),
      ...DOKUMENTE.map((name) => abschnitt(name, this.dokumente[name] ?? `${name} gibt es nicht.`)),
      abschnitt("Zeilen deiner Prüfliste", punkte(schluessel)),
    ];
  }

  async prueferSicht(teil) {
    if (teil.gruppe === null) {
      const dateikarte = this.nurUmbau ? (await umbauPitchKarten(this.schnitt, this.root)).dateikarte : await dateiKarte(this.root, this.sauberBerichte());
      return { berichte: [abschnitt("Dateikarte", json(dateikarte)), abschnitt("Erkundungsberichte (verdichtet)", verdichteBerichte(this.berichte))] };
    }
    const { nummern } = this.gliederung.gruppen[teil.gruppe];
    return { nummern, berichte: [abschnitt("Erkundungsbericht deiner Gruppe", json(this.berichte[teil.gruppe]))] };
  }

  async prueferNachricht(schluessel, teil) {
    return nachricht("Prüfung", [abschnitt("Schnittliste", json(this.schnitt)), ...this.pruefGrundlage(schluessel, await this.prueferSicht(teil))]);
  }

  prueflisteDer(antwort, schluessel) {
    if (antwort.art === STILLSTAND) throw new Abbruch(`pruefer-planung: ${antwort.text}`);
    const pruefliste = antwort.art === "json" ? antwort.wert.pruefliste : undefined;
    return { pruefliste, befunde: prueflisteBefunde(pruefliste, schluessel, this.kontext()) };
  }

  async prueferLauf(pruefer, text, schluessel) {
    const ergebnis = this.prueflisteDer(await this.team.frage(pruefer, text), schluessel);
    if (ergebnis.befunde.length === 0) return ergebnis;
    this.pruefeSchritt(pruefer.rolle, `Rücksendung an ${pruefer.rolle}`);
    return this.prueflisteDer(await this.team.frage(pruefer, this.team.ruecksenden(pruefer, ergebnis.befunde)), schluessel);
  }

  nimmPrueflisteAn(befunde, liefere, { datei, grund }) {
    if (befunde.length > 0) throw new Ende(EXIT_BEFUNDE, grund, befunde);
    const pruefliste = liefere();
    this.lege(datei, pruefliste);
    return prueferBefunde(pruefliste);
  }

  async pruefeMitFrischemPruefer(text, schluessel, ablage) {
    const pruefer = this.team.teilnehmer("pruefer-planung");
    const [{ befunde, pruefliste }] = await this.welle([{ rolle: pruefer.rolle, lauf: () => this.prueferLauf(pruefer, text, schluessel) }], "Nachprüfung");
    return { pruefer, befunde: this.nimmPrueflisteAn(befunde, () => pruefliste, ablage) };
  }

  async prueferTeil(teil) {
    const pruefer = this.team.teilnehmer("pruefer-planung");
    const text = await this.prueferNachricht(teil.schluessel, teil);
    return { rolle: pruefer.rolle, lauf: async () => ({ teil, pruefer, ...(await this.prueferLauf(pruefer, text, teil.schluessel)) }) };
  }

  async pruefliste() {
    const schluessel = fuerDenPitch(prueflisteSoll(this.schnitt, this.soll, this.erkunderAnnahmen()), { nurUmbau: this.nurUmbau });
    const laeufe = [];
    for (const teil of teilePruefliste(schluessel, this.schnitt, this.gliederung.gruppen)) laeufe.push(await this.prueferTeil(teil));
    const ergebnisse = await this.welle(laeufe, "Prüfliste");
    const unvollstaendig = ergebnisse.flatMap(({ befunde }) => befunde);
    const befunde = this.nimmPrueflisteAn(unvollstaendig, () => zusammengefuegt(schluessel, ergebnisse), { datei: "pruefliste.json", grund: "die Prüfliste blieb nach der Rücksendung unvollständig" });
    this.lege("pruefliste-aufteilung.json", ergebnisse.map(({ teil, pruefer }) => ({ gruppe: teil.gruppe, sitzung: pruefer.sitzung, schluessel: teil.schluessel })));
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
    const auswahl = nachpruefSchluessel({ vorher, nachher, befunde, soll: this.soll, annahmen: this.erkunderAnnahmen(), nurUmbau: this.nurUmbau });
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
    const { schnitt, befunde: einsatz } = this.schnittAusAntwort(wert);
    if (einsatz.length > 0) return { befunde: einsatz, schnitt: this.schnitt };
    if (!istObjekt(schnitt)) return { befunde: [`schnitt fehlt: ${KEIN_JSON}`] };
    const offen = antwortenBefunde(befunde, wert.antworten, { alt: vorher, neu: schnitt });
    const skript = liste((await this.pruefeSchnitt(schnitt)).befunde);
    if (offen.length > 0 || skript.length > 0) return { befunde: [...offen, ...skript], schnitt };
    return { wert: { schnitt, antworten: this.verbucheAntworten(befunde, wert.antworten) } };
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
    const auftraege = this.schnitt.auftraege.filter((auftrag) => bereichSchluessel(auftrag.bereich) === bereich);
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
      this.pruefeSchritt(wer.rolle, `Rücksendung an ${wer.rolle}`);
      entwurf = lies(await this.team.frage(wer, this.team.ruecksenden(wer, befunde)));
      befunde = entwurfBefunde(entwurf, namen);
    }
    return { entwurf, befunde };
  }

  namenDes(bereich) {
    const eigene = liste(this.schnitt.gemeinsameNamen).filter((eintrag) => bereichSchluessel(eintrag?.anbieter) === bereich || bereichSchluessel(eintrag?.nutzer) === bereich);
    return eigene.map(({ name }) => name);
  }

  async entwerfe() {
    const bereiche = [...new Set(this.schnitt.auftraege.map(({ bereich }) => bereichSchluessel(bereich)))];
    const laeufe = bereiche.map((bereich) => {
      const namen = this.namenDes(bereich);
      const wer = this.team.teilnehmer("entwurf");
      return { rolle: wer.rolle, lauf: () => this.schreibeEntwurf(wer, this.entwurfNachricht(bereich, namen), namen) };
    });
    const ergebnisse = await this.welle(laeufe, "Entwurfs-Welle");
    const offen = ergebnisse.flatMap(({ befunde }, stelle) => befunde.map((befund) => `Entwurf ${bereiche[stelle]}: ${befund}`));
    if (offen.length > 0) throw new Ende(EXIT_BEFUNDE, "Befunde zu Entwürfen blieben nach der Rücksendung offen", offen);
    const entwuerfe = Object.fromEntries(bereiche.map((bereich, stelle) => [bereich, ergebnisse[stelle].entwurf]));
    this.lege("entwuerfe.json", entwuerfe);
    const { befunde } = await setzePhaseZusammen(this.ordner, { schnitt: this.schnitt, berichte: this.berichte, entwuerfe, root: this.root, issue: this.issue });
    if (befunde.length > 0) throw new Ende(EXIT_BEFUNDE, "die Phase hat Befunde", befunde);
  }

  async laufe() {
    this.stand = this.ausgangsstand();
    await this.gliedere();
    await this.erkundeGruppen();
    this.legeFingerabdruck();
    await this.planeAbSchnitt();
  }

  async planeAbSchnitt() {
    await this.schneide();
    await this.pruefe();
    await this.entwerfe();
  }
}

class Fortsetzung extends Planung {
  uebernimmErkundung() {
    this.stand = this.ausgangsstand();
    const { gruende, erkundung } = liesFortsetzung(this.ablage, this.stand);
    if (gruende.length > 0) return gruende;
    const { gliederung, berichte: gelesen, nachfragen, zustand } = erkundung;
    this.gliederung = gliederung;
    this.berichte = gelesen;
    this.gesehen = new Set(zustand.gesehen);
    this.ausgeschoepft = new Set(zustand.ausgeschoepft);
    this.wegOffen = zustand.wegOffen;
    this.wegpruefungen = zustand.wegpruefungen;
    this.wegZaehler = new Map(zustand.wegZaehler);
    this.nachfrageWellen = zustand.nachfrageWellen;
    this.beantworteteWellen = nachfragen;
    return [];
  }

  async zuschnittNachricht() {
    return nachricht("Zuschnitt", [...this.gliederungsTeile(), abschnitt("Deine Gliederung", json(this.gliederung)), ...this.beantworteteWellen.flatMap(welleTeile), ...(await this.zuschnittTeile())]);
  }

  laufe() {
    return this.planeAbSchnitt();
  }
}

function vorhandenFehler(ordner, fortsetzen) {
  if (existsSync(join(ordner, PHASE))) return `${join(ordner, PHASE)} gibt es schon; plane überschreibt nichts`;
  if (fortsetzen && !existsSync(join(ordner, PLANUNG))) return `${join(ordner, PLANUNG)} gibt es nicht; --fortsetzen braucht die abgelegte Erkundung`;
  return null;
}

function legeAblageAn(ordner, fortsetzen) {
  if (fortsetzen) return null;
  try {
    mkdirSync(join(ordner, PLANUNG));
    return null;
  } catch (fehler) {
    if (fehler.code !== SCHON_DA) throw fehler;
    return `${join(ordner, PLANUNG)} gibt es schon; plane überschreibt nichts`;
  }
}

function aufrufFehler(ordner, fortsetzen) {
  if (!existsSync(join(ordner, "pitch.md")) || !existsSync(join(ordner, "sicherheit.md"))) return `${ordner} enthält kein pitch.md und sicherheit.md`;
  const vorhanden = vorhandenFehler(ordner, fortsetzen);
  if (vorhanden !== null) return vorhanden;
  const absichtFehlt = pitchAbsichtBefunde(readFileSync(join(ordner, PITCH), "utf8"));
  return absichtFehlt.length > 0 ? absichtFehlt.join("\n") : null;
}

function pruefeAufrufUndLegeAblageAn(ordner, fortsetzen, angaben) {
  const fehler = aufrufFehler(ordner, fortsetzen);
  if (fehler !== null) return { fehler };
  const pitch = readFileSync(join(ordner, PITCH), "utf8");
  const { deckel, fehler: deckelFehler } = deckelAus(angaben.deckel, pitch);
  const { issue, fehler: issueFehler } = issueAus(angaben.issue, pitch);
  return { deckel, issue, fehler: deckelFehler ?? issueFehler ?? legeAblageAn(ordner, fortsetzen) };
}

function ausgang(fehler) {
  if (fehler instanceof Ende) return { exit: fehler.exit, grund: fehler.message, offen: fehler.befunde };
  if (fehler instanceof Abbruch) return { exit: EXIT_ABBRUCH, grund: fehler.message, offen: [] };
  throw fehler;
}

export function ausgangOhneWurf(fehler) {
  if (fehler instanceof Ende || fehler instanceof Abbruch) return ausgang(fehler);
  return { exit: EXIT_ABBRUCH, grund: `unerwarteter Fehler: ${inspect(fehler)}`, offen: [] };
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
    wegpruefungen: planung.wegpruefungen,
  };
  const bericht = { ...planBericht(lauf, { root: planung.root, team: planung.team }), ...planung.kostendeckel?.bericht() };
  druckePlanBericht(bericht, schreibePlanBericht(planung.root, bericht));
  for (const befund of ergebnis.offen) console.error(befund);
  return ergebnis.exit;
}

function neuePlanung(root, ordner, { fortsetzen, deckel, issue }) {
  const planung = fortsetzen ? new Fortsetzung(root, ordner) : new Planung(root, ordner);
  planung.beginn = Date.now();
  planung.kostendeckel = new Kostendeckel(root, basename(ordner), deckel);
  planung.issue = issue;
  return planung;
}

export async function plane(ordnerAngabe, root, { fortsetzen = false, ...angaben } = {}) {
  const ordner = resolve(root, ordnerAngabe);
  const { deckel, issue, fehler } = pruefeAufrufUndLegeAblageAn(ordner, fortsetzen, angaben);
  if (fehler !== null) {
    console.error(fehler);
    return EXIT_AUFRUF;
  }
  const nummern = nummernImOrdner(ordner);
  const planung = neuePlanung(root, ordner, { fortsetzen, deckel, issue });
  planung.beginne(nummern);
  const abweichungen = fortsetzen ? planung.uebernimmErkundung() : [];
  if (abweichungen.length > 0) {
    console.error(`plane setzt nicht fort, voller Neulauf nötig:\n${punkte(abweichungen)}`);
    return EXIT_AUFRUF;
  }
  if (nummern.unklar.length > 0) return berichte(planung, { exit: EXIT_BEFUNDE, grund: "die Nummern der Dokumente sind nicht bestimmbar", offen: nummern.unklar });
  try {
    await planung.laufe();
    return berichte(planung, { exit: EXIT_GRUEN, grund: `grün: ${join(ordner, PHASE)} geschrieben`, offen: [] });
  } catch (abbruch) {
    return berichte(planung, ausgangOhneWurf(abbruch));
  }
}

