import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inspect } from "node:util";

import { vorgabenAusPitch } from "../annahmen.mjs";
import { STILLSTAND } from "../verlauf.mjs";
import { MELDUNG, zweckBlock } from "../zweck.mjs";
import { werkzeugBefunde } from "../werkzeuge.mjs";
import { ABSICHT, bereichSchluessel, istTestdatei } from "../format.mjs";
import { abschnitte } from "./abschnitte.mjs";
import { CODE_AUSZUG, codeAuszug } from "./auszug.mjs";
import { altfunktionenVorab } from "./altfunktionen-vorab.mjs";
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
import { ERKUNDUNG, Kostenbuch, WEGPRUEFER, gemesseneKosten, ohneGliederung } from "./deckel.mjs";
import { aenderungsStellen, berichtsGeruest, erkundungBefunde, istObjekt, istText, liste, namenImWenn, schreibeJsonAtomar } from "./erkundung.mjs";
import { FINGERABDRUCK, GEPRUEFT, NACHFRAGEN, ausgangsstand, erkundungsDatei, fingerabdruck, geprueft, liesFortsetzung, liesGeprueft } from "./fingerabdruck.mjs";
import { issueAus } from "./issue.mjs";
import { mitNieSaetzenDerVorgaben } from "./nie-vorbelegung.mjs";
import { kettenBefunde, mitKettenBefunden, modulGraph } from "./kette.mjs";
import { EXIT_ABBRUCH, EXIT_ALTFUNKTIONEN, EXIT_AUFRUF, EXIT_BEFUNDE, EXIT_GETEILT, EXIT_GRUEN, EXIT_PASST_NICHT, PLANER_KONTEXT, abschnitt, dateiText, json, nachricht, nummernText } from "./nachricht.mjs";
import { Fortschritt, RUECKSENDUNGEN } from "./fortschritt.mjs";
import { dateiKarte, funktionsListe, nachrichtenKarte } from "./funktionsliste.mjs";
import { PITCH, nummernImOrdner } from "./nummern.mjs";
import { teilePruefliste } from "./aufteilung.mjs";
import { abgelegteListe, uebernommeneWege, verbuchteAbnahmen } from "./wegabnahme.mjs";
import { annahmeText, druckePlanBericht, planBericht, schreibePlanBericht } from "./planbericht.mjs";
import { DOKUMENTE, SCHNITT, bereichskonflikte, schnittImOrdner, umbauPitchKarten } from "./schnitt.mjs";
import { Abbruch, Team } from "./team.mjs";
import { setzeTeillisteEin } from "./teilliste.mjs";
import { ableitungsBefunde, fremdeDateienBefunde, schreibeTeile, teile, teilungsBericht } from "./teilordner.mjs";
import { gruppenMit, gruppenZahlUeber, laufeTeilung } from "./teilung.mjs";
import { GEAENDERTE_DATEIEN, dokumenteIm, umfang } from "./umfang.mjs";
import { text as wortlautDes, verdichteBerichte } from "./verdichtung.mjs";
import { eigeneAnnahmen, setzePhaseZusammen } from "./zusammensetzen.mjs";

const PLANUNG = "planung";
const SCHON_DA = "EEXIST";
const PHASE = "phase.json";
const DESIGN = "design.md";
export const VORLAGE = ".claude/skills/pitch/phase-vorlage.md";
const VORLAGE_ENTWURF = "## Entwurf je Bereich";
const ERKUNDER_KONTEXT = ["CLAUDE.md", "tools/bereiche.json"];
const GELESEN = [...new Set([...PLANER_KONTEXT, ...ERKUNDER_KONTEXT, VORLAGE])];
const NEUER_NAME = "Gibt es eine Route oder einen Namen noch nicht, meldest du ihn als Eingang mit `datei` und `ausweg` „nicht gefunden, weil `<Name>` entsteht neu in <Datei>“, der den Namen wörtlich nennt, und dazu eine Änderung in genau dieser Datei.";
const PITCH_NUR_NEUSCHNITT = "„Pitch ändern“ gibt es nur beim Neuschnitt; antworte mit der Antwort, die an dieser Stelle verlangt ist, oder mit „Zerlegung passt nicht: …“";
const KEIN_JSON = "die Antwort enthält kein JSON in der verlangten Form";
const WEG = "weg:";
const TEILLISTE_ZUGLEICH = "Regel Teilliste: schnitt und teilliste zugleich; schick eines";
const TEILLISTE_ZU_FRUEH = "Regel Teilliste: teilliste gibt es erst nach einer Schnittliste";
const KONFLIKTE = "Bereichskonflikte";
const NACHFRAGEN_ENDE = "Ende der Nachfragen";
const VOR_DER_RUECKSENDUNG = "aus dem ersten Bericht vor der Rücksendung, im zweiten nicht wiederholt: ";
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

function punkte(eintraege, leer = "keine") {
  return eintraege.length === 0 ? leer : eintraege.map((eintrag) => `- ${eintrag}`).join("\n");
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

function offeneBefundeDesPruefers(befunde) {
  return abschnitt("Befunde des Prüfers, die du weiter beantwortest", `Zu jedem dieser Befunde gehört in deiner Antwort wieder genau eine Antwort unter \`antworten\`, auch wenn du ihn schon beantwortet hast.\n\n${punkte(befunde.map(prueferZeile))}`);
}

function offenerPrueferBefund(befund, antworten) {
  const antwort = antworten.find((eintrag) => eintrag?.schluessel === befund.schluessel)?.antwort;
  return istText(antwort) ? `${prueferZeile(befund)} | ${antwort}` : prueferZeile(befund);
}

function nachfrageAntwort({ frage, nummern, bericht, befunde }, stelle) {
  const teile = [`Frage: ${frage}`, `Nummern: ${nummern.join(", ")}`, verdichteBerichte([bericht]), `Befunde:\n${punkte(befunde)}`];
  return abschnitt(`Antwort auf deine Nachfrage ${stelle + 1}`, teile.join("\n\n"));
}

function frueherHinweis(wortlaut) {
  return wortlaut.startsWith(VOR_DER_RUECKSENDUNG) ? wortlaut : `${VOR_DER_RUECKSENDUNG}${wortlaut}`;
}

function mitFruehenHinweisen(bericht, frueher) {
  const wiederholt = new Set(bericht.hinweise.map(wortlautDes));
  const neue = liste(frueher).map(wortlautDes).filter((wortlaut) => !wiederholt.has(wortlaut));
  return { ...bericht, hinweise: [...bericht.hinweise, ...neue.map(frueherHinweis)] };
}

function berichtZu(bericht, nummern) {
  const eigene = nummern.filter((nummer) => Object.hasOwn(bericht.nummern, nummer));
  return { ...bericht, gruppe: nummern, nummern: Object.fromEntries(eigene.map((nummer) => [nummer, bericht.nummern[nummer]])) };
}

function nummernVon(offen) {
  return [...new Set(offen.flatMap((eintrag) => eintrag.nummern))];
}

function befundeZu(befunde, nummern, alle) {
  return befunde.filter((befund) => {
    const zu = alle.find((nummer) => befund.startsWith(`${nummer}:`) || befund.startsWith(`${nummer} `));
    return zu === undefined || nummern.includes(zu);
  });
}

function buchbar(eintrag, { bericht, befunde }, alle) {
  return befundeZu(befunde, eintrag.nummern, alle).length === 0 && eintrag.nummern.every((nummer) => Object.hasOwn(bericht.nummern, nummer));
}

function nachfrageAntworten(offen, ergebnis) {
  return offen.map(({ frage, nummern }) => {
    const bericht = nummern.every((nummer) => ergebnis.gebucht.includes(nummer)) ? ergebnis.bericht : ergebnis.roh;
    return { frage, nummern, bericht: berichtZu(bericht, nummern), befunde: befundeZu(ergebnis.befunde, nummern, nummernVon(offen)) };
  });
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

export class Planung {
  constructor(root, ordner) {
    this.root = root;
    this.ordner = ordner;
    this.ablage = join(ordner, PLANUNG);
    this.dokumente = dokumenteIm(ordner);
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
    this.ruecksendeBefunde = [];
    this.abgewiesenBei = null;
    this.nachfrageWellen = 0;
    this.beantworteteWellen = [];
    this.nachfragenBeendet = false;
    this.kostenbuch = null;
    this.teil = false;
    this.fremd = [];
    this.wegpruefer = new Set();
  }

  beginne({ soll, andererAusgang, nurUmbau }) {
    this.soll = soll;
    this.andererAusgang = andererAusgang;
    this.nurUmbau = nurUmbau;
    this.team = this.neuesTeam();
    this.planer = this.team.teilnehmer("planer");
  }

  neuesTeam() {
    return new Team(this.root, this.ordner);
  }

  gezaehlt(schritt, arbeit) {
    if (this.kostenbuch === null) return arbeit();
    return this.kostenbuch.gezaehlt({ gemessen: () => this.gemessen(), schritt }, arbeit);
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

  kostenrolle(wer) {
    return this.wegpruefer.has(wer) ? WEGPRUEFER : wer.rolle;
  }

  kostenJeRolle() {
    const gruppen = Map.groupBy(this.team.beteiligte, (wer) => this.kostenrolle(wer));
    return Object.fromEntries([...gruppen].map(([rolle, beteiligte]) => [rolle, gemesseneKosten(this.root, beteiligte)]));
  }

  verbucheWelle(schritte, vorher, geworfen = false) {
    if (this.kostenbuch === null) return;
    const nachher = this.kostenJeRolle();
    this.kostenbuch.verbuche(schritte, Object.fromEntries(Object.entries(nachher).map(([rolle, token]) => [rolle, token - (vorher[rolle] ?? 0)])), { geworfen });
  }

  async welle(laeufe, schritt) {
    const schritte = laeufe.map(({ rolle, kosten = [rolle] }) => kosten);
    const vorher = this.kostenbuch === null ? {} : this.kostenJeRolle();
    const ergebnisse = await this.gezaehlt(schritt, () => this.team.gruppe(laeufe)).catch((fehler) => {
      this.verbucheWelle(schritte, vorher, true);
      throw fehler;
    });
    this.verbucheWelle(schritte, vorher);
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
    const schleife = new Fortschritt(art, RUECKSENDUNGEN, DOKUMENTE.map((name) => this.dokumente[name] ?? ""));
    this.schleifen.push(schleife);
    return schleife;
  }

  async planerStufe(text, verarbeite, { art, anhang = [] } = {}) {
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
        naechste = this.team.ruecksenden(this.planer, ergebnis.befunde, anhang);
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
    return ohneGliederung(this);
  }

  async gliedere() {
    this.gliederung = this.ohneGliederung() ? { gruppen: [] } : await this.planerStufe(this.gliederungsNachricht(), (wert) => {
      const befunde = gliederungBefunde(wert, this.soll, this.designText);
      return befunde.length > 0 ? { befunde } : { wert };
    }, { art: "gliederung" });
    this.lege("gliederung.json", this.gliederung);
  }

  gruppenVon(nummern) {
    return gruppenMit(this.gliederung.gruppen, nummern);
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

  erkunderNachricht(ueberschrift, { nummern, fragen, kopf = [], mitBericht = false }) {
    const berichte = this.berichte.filter(({ gruppe }) => gruppe.some((nummer) => nummern.includes(nummer))).map((bericht) => berichtZu(bericht, nummern));
    const bisher = "Diese Angaben hat die Erkundung bereits mit Fundstellen belegt. Deine Nachfrage klärt nur die Fragen des Planers und wiederholt die Erkundung nicht. Fundstellen aus diesem Bericht übernimmst du, statt die Stelle neu zu lesen; neu liest du eine Stelle nur, wenn die Frage des Planers mehr verlangt, als hier steht. Jede neue Aussage in deinem Bericht belegst du mit Fundstelle.";
    return nachricht(ueberschrift, [
      ...kopf,
      ...this.absichtTeil(),
      abschnitt("Deine Nummern", nummernText(this.soll, nummern)),
      ...(mitBericht ? [abschnitt("Bisheriger Bericht der Erkundung zu deinen Nummern", `${bisher}\n\n${verdichteBerichte(berichte)}`)] : []),
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
    const erste = await mitKettenBefunden(this.root, this.pruefeBericht(await this.team.frage(wer, text), nummern));
    if (erste.befunde.length === 0) return erste;
    this.merkeRuecksendung(wer.rolle, nummern, erste.befunde);
    return this.berichtNachRuecksendung(wer, { befunde: erste.befunde, nummern, frueher: erste.bericht.hinweise });
  }

  async berichtNachRuecksendung(wer, { befunde, nummern, frueher = [] }) {
    const zweite = this.pruefeBericht(await this.team.frage(wer, this.team.ruecksenden(wer, befunde)), nummern);
    return { ...zweite, bericht: mitFruehenHinweisen(zweite.bericht, frueher) };
  }

  async erkunde(wer, text, nummern) {
    const ergebnis = await this.berichtVon(wer, text, nummern);
    return ergebnis.befunde.length === 0 ? this.wegPruefung(wer, ergebnis, nummern) : ergebnis;
  }

  merkeRuecksendung(rolle, nummern, befunde) {
    this.ruecksendeBefunde.push({ rolle, nummern, befunde });
    console.log(`Rücksendung an ${rolle} (${nummern.join(", ")}) wegen:\n${punkte(befunde)}`);
  }

  wegNachricht(nummern, bericht, nachKorrektur) {
    return nachricht("Wegprüfung", [
      abschnitt("Nummern", nummernText(this.soll, nummern)),
      ...(nachKorrektur ? [] : this.designTeile(nummern)),
      abschnitt(nachKorrektur ? "Korrigierter Erkundungsbericht" : "Erkundungsbericht", json(bericht)),
      abschnitt(CODE_AUSZUG, codeAuszug(this.root, [bericht])),
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
    this.wegAbnahmen = verbuchteAbnahmen(this, { nummern, bericht: sauber.bericht, offen });
    return { ...sauber, weg: { nummern, offen } };
  }

  uebernimmWeg({ weg }) {
    this.wegOffen = [...this.wegOffen.filter((eintrag) => !eintrag.nummern.some((nummer) => weg.nummern.includes(nummer))), ...weg.offen];
  }

  neuerWegpruefer() {
    const pruefer = this.team.teilnehmer("pruefer-planung");
    this.wegpruefer.add(pruefer);
    return pruefer;
  }

  async wegPruefung(wer, ergebnis, nummern) {
    const weg = { pruefer: this.neuerWegpruefer(), schleife: this.schleife("weg"), nummern };
    let sauber = ergebnis;
    let text = this.wegNachricht(nummern, sauber.bericht, false);
    for (let runden = 1; ; runden += 1) {
      const runde = await this.wegRunde(weg, text);
      if (runde.befunde.length === 0 || runde.ende) return this.verbucheWegpruefung({ ...weg, runden }, sauber, runde.offen);
      const neu = await this.berichtVon(wer, this.team.ruecksenden(wer, runde.befunde.map(prueferZeile)), nummern);
      if (neu.befunde.length > 0) return this.verbucheWegpruefung({ ...weg, runden }, sauber, [...runde.offen, ...neu.befunde.map((befund) => gruppenWegZeile(nummern, `Korrektur verworfen: ${befund}`))]);
      sauber = neu;
      text = this.wegNachricht(nummern, sauber.bericht, true);
    }
  }

  erkunderLauf(text, nummern, erkunde = (wer) => this.erkunde(wer, text, nummern)) {
    const wer = this.team.teilnehmer("erkunder");
    return { rolle: wer.rolle, kosten: ERKUNDUNG, lauf: () => erkunde(wer) };
  }

  async erkundeNachfragen(wer, text, offen) {
    return this.bucheNachfrageBericht(wer, await this.berichtVon(wer, text, nummernVon(offen)), offen);
  }

  async bucheNachfrageBericht(wer, ergebnis, offen) {
    const nummern = nummernVon(offen);
    const gebucht = nummern.filter((nummer) => offen.some((eintrag) => eintrag.nummern.includes(nummer) && buchbar(eintrag, ergebnis, nummern)));
    const roh = { ...ergebnis, roh: ergebnis.bericht, gebucht };
    if (gebucht.length === 0) return roh;
    const sauber = await this.wegPruefung(wer, { ...ergebnis, bericht: berichtZu(ergebnis.bericht, gebucht), befunde: [] }, gebucht);
    return { ...roh, ...sauber, befunde: ergebnis.befunde };
  }

  async erkundeGruppen() {
    const laeufe = this.gliederung.gruppen.map((gruppe) => this.erkunderLauf(this.erkunderNachricht("Erkundung", gruppe), gruppe.nummern));
    this.nimmErkundungAn(this.gliederung.gruppen.map((_gruppe, stelle) => stelle), await this.welle(laeufe, "Erkundung"));
  }

  nimmErkundungAn(stellen, ergebnisse) {
    ergebnisse.forEach(({ bericht }, stelle) => {
      this.berichte[stellen[stelle]] = bericht;
    });
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
    const zustand = { gesehen: [...this.gesehen], ausgeschoepft: [...this.ausgeschoepft], wegOffen: this.wegOffen, wegpruefungen: this.wegpruefungen, wegZaehler: [...this.wegZaehler], nachfrageWellen: this.nachfrageWellen, wegAbnahmen: liste(this.wegAbnahmen) };
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
      abschnitt("Dateikarte", json(await nachrichtenKarte(this.root, dateikarte))),
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

  verbucheNachfrage(offen, { bericht, gebucht, weg }) {
    const nummern = nummernVon(offen);
    const neu = neueStellen(this.gesehen, bericht, gebucht);
    if (gebucht.length > 0) {
      merkeStellen(this.gesehen, bericht);
      this.ersetze(bericht, gebucht);
      this.uebernimmWeg({ weg });
    }
    const mitBefund = offen.filter((eintrag) => !eintrag.nummern.every((nummer) => gebucht.includes(nummer))).flatMap((eintrag) => eintrag.nummern);
    const ohneNeues = nummern.filter((nummer) => mitBefund.includes(nummer) || !neu.some((stelle) => stelle.startsWith(`${nummer}\0`)));
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
    const nachfrage = { offen, klaerung };
    const text = this.nachfrageNachricht(offen);
    const [ergebnis] = await this.welle([this.erkunderLauf(text, nummernVon(offen), (wer) => this.erkundeNachfragen(wer, text, offen))], "Nachfrage-Welle");
    const welle = this.nimmNachfrageAn(nachfrage, ergebnis);
    return { weiter: nachricht("Zuschnitt", [...welleTeile(welle), ...(await this.lagebild())]) };
  }

  nachfrageNachricht(offen) {
    const fragen = offen.map((eintrag) => `${eintrag.nummern.join(", ")}: ${eintrag.frage}`);
    return this.erkunderNachricht("Nachfrage", { nummern: nummernVon(offen), fragen, kopf: [...fragen, ""], mitBericht: true });
  }

  nimmNachfrageAn({ offen, klaerung }, ergebnis) {
    if (!klaerung) this.nachfrageWellen += 1;
    const enden = this.verbucheNachfrage(offen, ergebnis);
    const welle = { antworten: nachfrageAntworten(offen, ergebnis), enden };
    this.beantworteteWellen.push(welle);
    this.legeBerichte();
    this.pruefeGeaenderteDateien();
    this.legeFingerabdruck();
    return welle;
  }

  async pruefeSchnitt(antwort) {
    if (!istObjekt(antwort)) return { befunde: [`schnitt fehlt: ${KEIN_JSON}`] };
    const schnitt = mitNieSaetzenDerVorgaben(antwort, this.dokumente[PITCH], this.soll);
    this.lege(SCHNITT, schnitt);
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
    }, { art: "zuschnitt" });
  }

  alleAnnahmen() {
    return this.schnittAnnahmen ?? this.erkunderAnnahmen();
  }

  pruefGrundlage(schluessel, { nummern = [...this.soll.keys()], berichte = [abschnitt("Erkundungsberichte", json(this.berichte))], auszug = this.berichte } = {}) {
    return [
      abschnitt("Nummern", nummernText(this.soll, nummern)),
      ...berichte,
      abschnitt(CODE_AUSZUG, codeAuszug(this.root, auszug)),
      abschnitt("Annahmen", punkte(this.alleAnnahmen().map(annahmeText))),
      ...DOKUMENTE.map((name) => abschnitt(name, this.dokumente[name] ?? `${name} gibt es nicht.`)),
      abschnitt("Zeilen deiner Prüfliste", punkte(schluessel)),
    ];
  }

  async prueferSicht(teil) {
    if (teil.gruppe === null) {
      const dateikarte = this.nurUmbau ? (await umbauPitchKarten(this.schnitt, this.root)).dateikarte : await dateiKarte(this.root, this.sauberBerichte());
      return { berichte: [abschnitt("Dateikarte", json(await nachrichtenKarte(this.root, dateikarte))), abschnitt("Erkundungsberichte (verdichtet)", verdichteBerichte(this.berichte))] };
    }
    const { nummern } = this.gliederung.gruppen[teil.gruppe];
    return { nummern, berichte: [abschnitt("Erkundungsbericht deiner Gruppe", json(this.berichte[teil.gruppe]))], auszug: [this.berichte[teil.gruppe]] };
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
    const { rest, zeilen } = uebernommeneWege(this, schluessel);
    const laeufe = [];
    for (const teil of teilePruefliste(rest, this.schnitt, this.gliederung.gruppen)) laeufe.push(await this.prueferTeil(teil));
    const ergebnisse = await this.welle(laeufe, "Prüfliste");
    const unvollstaendig = ergebnisse.flatMap(({ befunde }) => befunde);
    const befunde = this.nimmPrueflisteAn(unvollstaendig, () => zusammengefuegt(schluessel, [...ergebnisse, { pruefliste: zeilen }]), { datei: "pruefliste.json", grund: "die Prüfliste blieb nach der Rücksendung unvollständig" });
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
    const datei = `nachpruefung-${runde}.json`;
    const { rest, zeilen } = uebernommeneWege(this, auswahl.schluessel);
    const { pruefer, befunde: neue } = await this.pruefeMitFrischemPruefer(this.nachpruefNachricht({ ...auswahl, schluessel: rest }, { nachher, antworten }), rest, { datei, grund });
    if (zeilen.length > 0) this.lege(datei, zusammengefuegt(auswahl.schluessel, [{ pruefliste: abgelegteListe(this, datei) }, { pruefliste: zeilen }]));
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
      return await this.planerStufe(this.team.ruecksenden(this.planer, befunde.map(prueferZeile)), verarbeite, { art: "korrektur", anhang: [offeneBefundeDesPruefers(befunde)] });
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
      abschnitt("Annahmen der Planung zu diesen Aufträgen", punkte(eigeneAnnahmen(this.alleAnnahmen(), auftraege).map(annahmeText))),
      abschnitt("Fallen, Nicht-Ziele und neue Begriffe des Pitches", vorgabenAusPitch(this.dokumente[PITCH] ?? "") || "keine"),
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

  pruefeFremdeDateien() {
    if (!this.teil) return;
    const gruppen = this.gliederung.gruppen.map(({ nummern, ueberschriften }) => ({ nummern, text: this.designAbschnitte(ueberschriften) }));
    const befunde = fremdeDateienBefunde(this.fremd, gruppen);
    if (befunde.length > 0) throw new Ende(EXIT_BEFUNDE, "der Schnitt der Teilung ist unvollständig: das Design Doc nennt für eine Gruppe Dateien eines anderen Teils; plane startet keinen Erkunder und teilt nicht", befunde);
  }

  pruefeGeaenderteDateien() {
    const { geaenderteDateien, loeschmenge } = this.umfang;
    if (geaenderteDateien === undefined) return;
    const erklaert = new Set([...geaenderteDateien, ...(loeschmenge?.dateien ?? [])]);
    const fremd = Object.groupBy(aenderungsStellen(this.berichte).filter(({ datei }) => !istTestdatei(datei) && !erklaert.has(datei)), ({ datei }) => datei);
    const befunde = Object.entries(fremd).map(([datei, stellen]) => {
      const nummern = [...new Set(stellen.map(({ nummer }) => nummer))].join(", ");
      return `${datei} ändert die Erkundung (${nummern}), die Datei steht aber nicht unter „${GEAENDERTE_DATEIEN}“ im Pitch`;
    });
    if (befunde.length > 0) throw new Ende(EXIT_BEFUNDE, `die Erkundung ändert Dateien, die der Pitch nicht unter „${GEAENDERTE_DATEIEN}“ nennt; plane schneidet nicht. Nimm sie in den Abschnitt auf und plane neu`, befunde);
  }

  async nachsteuern() {
    const ueber = gruppenZahlUeber(this.gliederung.gruppen.length);
    if (ueber.length === 0) return;
    const angaben = { soll: this.soll, umfang: this.umfang, ueber, ableitung: ableitungsBefunde(this.ordner), team: this.team, planer: this.planer, gliederung: this.gliederung, umbau: this.umbau };
    const geteilt = await this.gezaehlt("Teilung nach der Gliederung", () => laufeTeilung(this.root, this.ordner, angaben));
    const ergebnis = geteilt.exit === EXIT_GETEILT ? schreibeTeile(this.root, this.ordner, geteilt) : geteilt;
    throw new Ende(ergebnis.exit, ergebnis.fehler);
  }

  async laufe() {
    this.stand = this.ausgangsstand();
    await this.gliedere();
    this.pruefeFremdeDateien();
    await this.nachsteuern();
    await this.erkundeGruppen();
    this.legeFingerabdruck();
    await this.planeAbSchnitt();
  }

  async planeAbSchnitt() {
    this.pruefeGeaenderteDateien();
    await this.schneide();
    await this.pruefe();
    const { korrigiert, zurueckgewiesen } = this.befunde;
    this.lege(GEPRUEFT, geprueft(this.ablage, { befunde: { korrigiert, zurueckgewiesen }, nachpruefungen: this.nachpruefungen }));
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
    this.wegAbnahmen = liste(zustand.wegAbnahmen);
    this.werkzeugGeaendert = erkundung.werkzeugGeaendert === true;
    return [];
  }

  async zuschnittNachricht() {
    return nachricht("Zuschnitt", [...this.gliederungsTeile(), abschnitt("Deine Gliederung", json(this.gliederung)), ...this.beantworteteWellen.flatMap(welleTeile), ...(await this.zuschnittTeile())]);
  }

  async laufe() {
    await this.pruefeKetteNachWerkzeug();
    await this.planeAbSchnitt();
  }

  async pruefeKetteNachWerkzeug() {
    if (!this.werkzeugGeaendert) return;
    const graph = await modulGraph(this.root);
    const befunde = this.sauberBerichte().flatMap((bericht) => kettenBefunde(this.root, graph, bericht));
    if (befunde.length > 0) throw new Ende(EXIT_AUFRUF, "plane setzt nicht fort, voller Neulauf nötig: das Werkzeug unter tools/ ist geändert, und die Kettenprüfung über die gespeicherten Berichte hat Befunde", befunde);
  }

  async planeAbSchnitt() {
    const vorher = liesGeprueft(this.ablage);
    const ergebnis = vorher === undefined ? undefined : await schnittImOrdner(this.ordner, { schnitt: vorher.schnitt, berichte: this.berichte, root: this.root });
    if (ergebnis === undefined || ergebnis.befunde.length > 0) return super.planeAbSchnitt();
    this.schnitt = vorher.schnitt;
    this.schnittAnnahmen = ergebnis.annahmen;
    this.befunde = { ...this.befunde, ...vorher.befunde };
    this.nachpruefungen = vorher.nachpruefungen;
    return this.entwerfe();
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

function altfunktionenHalt(root, ordner) {
  const { form, offen, erledigt } = altfunktionenVorab(root, dokumenteIm(ordner));
  const zweck = zweckBlock(MELDUNG.ALTFUNKTIONEN_VORAB).join("\n");
  if (form.length > 0) return { exit: EXIT_AUFRUF, fehler: [...form, zweck].join("\n") };
  for (const hinweis of erledigt) console.log(hinweis);
  if (offen.length === 0) return null;
  const kopf = `plane hält vor dem ersten Agenten: ${offen.length} Altfunktion(en) ohne Entscheidung unter „## Altfunktionen“ im Pitch`;
  return { exit: EXIT_ALTFUNKTIONEN, fehler: [kopf, ...offen, zweck].join("\n") };
}

async function pruefeAufrufUndLegeAblageAn(root, ordner, { fortsetzen, angaben }) {
  const fehler = aufrufFehler(ordner, fortsetzen);
  if (fehler !== null) return { fehler };
  const pitch = readFileSync(join(ordner, PITCH), "utf8");
  const { issue, fehler: issueFehler } = issueAus(angaben.issue, pitch);
  if (issueFehler !== undefined) return { fehler: issueFehler };
  const halt = fortsetzen ? null : altfunktionenHalt(root, ordner);
  if (halt !== null) return halt;
  const ablage = legeAblageAn(ordner, fortsetzen);
  const messe = (dateien) => umfang(root, ordner, { dateien });
  const teilung = ablage === null ? await teile(root, ordner, { fortsetzen, messe }) : null;
  return { issue, fehler: ablage, ...teilung };
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
    umfang: planung.umfang,
    schnitt: planung.schnitt,
    annahmen: planung.alleAnnahmen(),
    befunde: { ...planung.befunde, offen: ergebnis.offen },
    schleifen: planung.schleifen.map((schleife) => schleife.bericht()),
    nachpruefungen: planung.nachpruefungen,
    wegpruefungen: planung.wegpruefungen,
    ruecksendeBefunde: planung.ruecksendeBefunde,
  };
  const geteilt = ergebnis.exit === EXIT_GETEILT ? teilungsBericht(planung.ordner) : {};
  const bericht = { ...planBericht(lauf, { root: planung.root, team: planung.team }), ...planung.kostenbuch?.bericht(), ...geteilt };
  druckePlanBericht(bericht, schreibePlanBericht(planung.root, bericht));
  for (const befund of ergebnis.offen) console.error(befund);
  return ergebnis.exit;
}

function neuePlanung(root, ordner, { fortsetzen, issue, umfang: gemessen, teil, fremd = [], umbau }) {
  const planung = fortsetzen ? new Fortsetzung(root, ordner) : new Planung(root, ordner);
  planung.beginn = Date.now();
  planung.umfang = gemessen;
  planung.kostenbuch = new Kostenbuch();
  planung.issue = issue;
  planung.teil = teil === true;
  planung.fremd = fremd;
  planung.umbau = umbau;
  return planung;
}

function endeVorDerPlanung(root, ordner, { vorab, beginn }) {
  const { team, kostenbuch, fehler, exit = EXIT_AUFRUF, issue, umfang: gemessen } = vorab;
  console.error(fehler);
  if (team === undefined) return exit;
  const planung = neuePlanung(root, ordner, { fortsetzen: false, issue, umfang: gemessen });
  planung.team = team;
  planung.kostenbuch = kostenbuch;
  planung.beginn = beginn;
  return berichte(planung, { exit, grund: fehler, offen: [] });
}

export async function plane(ordnerAngabe, root, { fortsetzen = false, ...angaben } = {}) {
  const ordner = resolve(root, ordnerAngabe);
  const werkzeug = werkzeugBefunde(root);
  if (werkzeug.length > 0) {
    console.error(werkzeug.join("\n"));
    return EXIT_AUFRUF;
  }
  const beginn = Date.now();
  const vorab = await pruefeAufrufUndLegeAblageAn(root, ordner, { fortsetzen, angaben });
  if (vorab.fehler !== null) return endeVorDerPlanung(root, ordner, { vorab, beginn });
  const { issue, umfang: gemessen, teil, fremd, umbau } = vorab;
  const nummern = nummernImOrdner(ordner);
  const planung = neuePlanung(root, ordner, { fortsetzen, issue, umfang: gemessen, teil, fremd, umbau });
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

