import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { auftragsBlock, bauPrompt, testAgentPrompt } from "./agenten.mjs";
import { annahmenBefunde, designPfad } from "./annahmen.mjs";
import { nenntAltenTest } from "./ausgang.mjs";
import { EXIT_ROT, abnahmeBefehl, gueltigePhase, hatSkript } from "./befehle.mjs";
import { BELEGE, GRUEN, ROT, belegVerzeichnis, belegeDesAuftrags, druckeBeleg, fingerabdruck, hinweiseDesBaus, schreibeBeleg } from "./bericht.mjs";
import { bisektion } from "./bisektion.mjs";
import { laufe } from "./faelle.mjs";
import { freigabeProblem, phasenIssue } from "./issue-freigabe.mjs";
import { TESTUMBAU, brauchtRotenTest, istAusfuehrbarerTest, istTestdatei, ladePhase, reihenfolge } from "./format.mjs";
import { aenderungenSeit, arbeitsstand, auftragsTrailer, festhalten, gibtEsIn, git, istSauber, kopf, vormerken, weichZuruecksetzen } from "./git.mjs";
import { pruefeNachricht } from "./commitlint.mjs";
import { setzeEin } from "./einsatz.mjs";
import { sichereDiff } from "./worktrees.mjs";
import { kostenDesAuftrags } from "./kosten.mjs";
import { LISTENUMZUG, umzugGemerkt, umzugZuruecknehmen } from "./listenumzug.mjs";
import { mutationsSchritte } from "./mutation.mjs";
import { NEU_GESCHNITTEN } from "./neuschnitt.mjs";
import { issueBefunde } from "./phase.mjs";
import { OHNE_NEUEN_AUFTRAG, TEILLAUF, ciLokalAmPhasenende, ciLokalNichtGelaufen, phasenbasis } from "./phasenende.mjs";
import { beleg, fuehreAus, legeAusgabeAb, vollerBeleg } from "./pruefungen.mjs";
import { pflichtDer, roteRunde, roterAbschnitt } from "./rote-pruefungen.mjs";
import { fuehreRundenAus } from "./runden.mjs";
import { testTitel } from "./testtitel.mjs";
import { testumbauSchritte } from "./testumbau-schritte.mjs";
import { werkzeugBefunde } from "./werkzeuge.mjs";
import { zeilenDes } from "./zeilen.mjs";
import { ALTER_TEST, GRUND, MELDUNG, PRUEFUNG, ohneZweck, zweckBeleg, zweckBlock } from "./zweck.mjs";
import { geordnet } from "../soll-vergleich/vergleich.mjs";

const EINSTIEG = fileURLToPath(new URL("../auftrag.mjs", import.meta.url));
const MIGRATIONEN_PRUEFEN = fileURLToPath(new URL("../migrationen-pruefen.mjs", import.meta.url));
const FESTE_PFADE = fileURLToPath(new URL("../feste-pfade.mjs", import.meta.url));
const VORBEREITUNG = fileURLToPath(new URL("../vorbereitung-pruefen.mjs", import.meta.url));
const VORBEREITUNG_BEREICH = fileURLToPath(new URL("vorbereitung-bereich.json", import.meta.url));
const TYPPRUEFUNG = "typecheck";
const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const EINRUECKUNG = 2;
const LEERE_LISTE_WIE_ESLINT = "{\n}";
export const PIN_PRUEFUNG = "scripts/check-staged-suppressions.js";
export const PIN_HAKEN = ".githooks/pre-commit";
export const PIN_FEHLT =
  "scripts/check-staged-suppressions.js fehlt, obwohl .githooks/pre-commit existiert. Ohne das Skript prüft niemand die vorgemerkten Unterdrückungen. Lege es nicht selbst an und ersetze es nicht.";
const NUL = "\0";
const NICHT_GEKUERZT =
  "Der Umbau soll Altfunktionen aufräumen, aber eslint-suppressions.json hat danach nicht weniger Einträge als vorher. Räum die genannten Funktionen auf, statt sie stehen zu lassen.";
const GRENZ_PRUEFUNG = { bau: PRUEFUNG.GRENZEN_BAU, test: PRUEFUNG.GRENZEN_TEST };
const ZITAT = "> ";
const BLOB = " blob ";
const PLAENE = "plaene/";
const ANLEITUNG = ".md";
const AUFTRAG_LAUT_PHASE = "Auftrag laut Phase, vom Skript eingefügt:";
const BEGRUENDUNG_DES = { bau: "Bau-Agenten", test: "Test-Agenten" };
const ZWECK_ZEILE = "„Zweck <ID>:“";
const ISSUE_ZWECK =
  'lauf schreibt jede Entscheidung als Kommentar an das Phasen-Issue und liest dort die Freigabe eines alten Tests. Ohne gültige Nummer liefe ein Auftrag stundenlang in eine Entscheidung, die nirgends ankommt. Ausweg: Trag die Nummer des Phasen-Issues als "issue": <Nummer> in die Phasendatei ein.';

function nurEigeneGekuerzt(vorher, nachher, eigene) {
  const dateien = new Set([...Object.keys(vorher), ...Object.keys(nachher)]);
  return Object.fromEntries([...dateien].flatMap((datei) => {
    const eintrag = eigene.has(datei) ? nachher[datei] : vorher[datei];
    return eintrag === undefined ? [] : [[datei, eintrag]];
  }));
}

function wieEslint(unterdrueckungen) {
  if (Object.keys(unterdrueckungen).length === 0) return LEERE_LISTE_WIE_ESLINT;
  return JSON.stringify(geordnet(unterdrueckungen), null, EINRUECKUNG);
}

function eintraege(text) {
  return Object.values(JSON.parse(text))
    .flatMap((regeln) => Object.values(regeln))
    .reduce((summe, { count }) => summe + count, 0);
}

function herkunftsZeilen(phase, { id, art }) {
  return [`Auftrag: ${phase.phase}/${id}`, `Art: ${art}`];
}

function nachfrage(ids) {
  return [
    "## Zweck-Absatz fehlt",
    "",
    `Deine letzte Antwort enthält keinen Absatz mit der eigenen Zeile ${ZWECK_ZEILE} für: ${ids.join(", ")}. Die Zeile beginnt am Zeilenanfang mit „Zweck“, ohne Markdown davor. Schreib den Absatz jetzt in eigenen Worten, wie in deinen Anweisungen beschrieben. Ändere dabei keine Datei.`,
    "Kannst du den Zweck nicht benennen, antworte als Letztes mit der eigenen Zeile „Auftrag passt nicht: Zweck der Prüfung <ID> unklar: <was dir fehlt>“.",
    "",
  ].join("\n");
}

function istCodeDatei(datei) {
  return !istTestdatei(datei) && !datei.toLowerCase().endsWith(ANLEITUNG) && !datei.startsWith(PLAENE);
}

function ausgefuehrteFaelle(root, pfad) {
  const { faelle } = laufe(root, pfad);
  return faelle.filter(({ name, still }) => !still && name !== pfad).map(({ name }) => name);
}

function befundOhneZweck(ergebnis) {
  return vollerBeleg({ ...ergebnis, ausgabe: ohneZweck(ergebnis.ausgabe.split("\n")).join("\n") });
}

class AuftragsLauf {
  constructor({ phase, auftrag, root, design, phasendatei, runde, vorgeschichte, vorigeRunden = [], aufraeumen = false, vorbau = null, befund = null }) {
    this.kontext = { phase, auftrag, root, design };
    this.aufraeumen = aufraeumen;
    this.vorbau = vorbau;
    this.phasendatei = phasendatei;
    this.runde = runde;
    this.vorgeschichte = vorgeschichte;
    this.vorigeRunden = vorigeRunden;
    this.gemeldet = pflichtDer(vorigeRunden);
    this.zweck = { bau: {}, test: {} };
    this.berichtet = 0;
    this.voraussetzung = null;
    this.ausstieg = null;
    this.alterTest = null;
    this.testbefund = null;
    this.befund = befund;
    this.abnahmeFaelle = [];
    this.entscheidung = null;
    this.patch = null;
    this.basis = kopf(root);
    this.beginn = Date.now();
    this.basisBau = this.basis;
    this.testausgabe = "";
    this.agenten = [];
    this.nachfragen = [];
    this.vorigeBerichtet = false;
    this.pruefungen = [];
    this.hinweise = [];
    this.zusaetze = [];
    this.berichtszeilen = [];
    this.grund = null;
    this.roteIds = [];
    this.commit = null;
  }

  scheitert(grund, id) {
    this.grund = grund;
    if (id !== undefined) this.roteIds.push(id);
    return false;
  }

  belegt(ergebnis, belegen = beleg) {
    const { phase, auftrag, root } = this.kontext;
    const stamm = `${auftrag.id}.runde-${this.runde}.${this.beginn}.pruefung-${this.pruefungen.length + 1}`;
    this.pruefungen.push(legeAusgabeAb(belegen(ergebnis), ergebnis, { ordner: belegVerzeichnis(root, phase.phase), stamm }));
    return ergebnis;
  }

  pruefung(name, befehl, belegen) {
    return this.belegt(fuehreAus(name, befehl, { cwd: this.kontext.root, env }), belegen);
  }

  gruenOderScheitert({ name, exitCode }) {
    return exitCode === 0 || this.scheitert(`${name} endete mit Exit ${exitCode}.`);
  }

  gruen(name, befehl, belegen) {
    return this.gruenOderScheitert(this.pruefung(name, befehl, belegen));
  }

  eigenerBefehl(befehl, ...argumente) {
    return [execPath, EINSTIEG, befehl, this.phasendatei, this.kontext.auftrag.id, ...argumente];
  }

  agent(rolle, prompt, fortsetzung) {
    return this.setzeAgentEinUndUebernimmAusgang(rolle, prompt, fortsetzung) !== null;
  }

  setzeAgentEinUndUebernimmAusgang(rolle, prompt, fortsetzung) {
    const vorher = arbeitsstand(this.kontext.root);
    const weg = this.eingesetzt(rolle, prompt, { fortsetzung });
    return weg !== null && this.begruendet(rolle, vorher) ? weg : null;
  }

  meldet(id, rolle) {
    this.gemeldet.push({ id, rolle });
  }

  fehlendeAbsaetze(rolle) {
    const ids = this.gemeldet.filter((eintrag) => eintrag.rolle === rolle).map(({ id }) => id);
    const absaetze = this.zweck[rolle];
    return [...new Set(ids)].filter((id) => !absaetze[id]?.trim());
  }

  begruendet(rolle, vorher) {
    const nachher = arbeitsstand(this.kontext.root);
    if (nachher === vorher) return true;
    if (this.fehlendeAbsaetze(rolle).length > 0 && !this.nachgefragt(rolle, nachher)) return false;
    this.gemeldet = this.gemeldet.filter((eintrag) => eintrag.rolle !== rolle);
    return true;
  }

  nachgefragt(rolle, nachher) {
    const arbeit = this.agenten.findLast((eintrag) => eintrag.rolle === rolle);
    const weg = this.eingesetzt(rolle, nachfrage(this.fehlendeAbsaetze(rolle)), { fortsetzung: arbeit.sitzung, sitzungen: this.nachfragen });
    if (weg === null) return false;
    if (arbeitsstand(this.kontext.root) !== nachher) return this.scheitert("Die Nachfrage zum Zweck hat Dateien geändert.", GRUND.ZWECK_ABSATZ);
    const offen = this.fehlendeAbsaetze(rolle);
    return offen.length === 0 || this.scheitert(`Begründung fehlt: Zweck ${offen.join(", ")}`, GRUND.ZWECK_ABSATZ);
  }

  eingesetzt(rolle, prompt, { fortsetzung, sitzungen = this.agenten }) {
    const vorher = fingerabdruck(this.kontext.root);
    const ergebnis = setzeEin({ rolle, ...this.kontext, fortsetzung }, `${prompt}${this.vorgeschichte}`);
    sitzungen.push(...ergebnis.sitzungen);
    return this.uebernimmAusgang(rolle, ergebnis, vorher) ? ergebnis.ausgang : null;
  }

  uebernimmAusgang(rolle, ergebnis, vorher) {
    if (fingerabdruck(this.kontext.root) !== vorher) {
      return this.scheitert(`Der Agent ${ergebnis.agent} hat ${BELEGE}/ verändert.`, GRUND.BELEGE);
    }
    Object.assign(this.zweck[rolle], ergebnis.ausgang.zweck);
    if (ergebnis.alterTest) return this.pruefeUndBelegeAltenTest(ergebnis.alterTest);
    if (ergebnis.ausgang.testbefund) return this.pruefeTestbefund(ergebnis.ausgang.testbefund);
    this.voraussetzung = ergebnis.voraussetzung;
    if (this.voraussetzung) return this.scheitert(`Voraussetzung fehlt: ${this.voraussetzung}`);
    this.ausstieg = ergebnis.ausstieg;
    if (this.ausstieg) return this.scheitert(`Auftrag passt nicht: ${this.ausstieg}`);
    if (ergebnis.grund) return this.scheitert(ergebnis.grund, GRUND.STILLSTAND);
    return ergebnis.exitCode === 0 || this.scheitert(`Der Agent ${ergebnis.agent} endete mit Exit ${ergebnis.exitCode}.`, GRUND.AGENT_EXIT);
  }

  alsAusstieg({ zeile }) {
    this.ausstieg = zeile;
    return this.scheitert(`Auftrag passt nicht: ${zeile}`);
  }

  zeilenAnDerBasis(datei) {
    const { root } = this.kontext;
    if (!gibtEsIn(this.basis, datei, root)) return 0;
    const [eintrag] = git(["ls-tree", "-z", this.basis, "--", datei], { cwd: root }).split(NUL);
    const [art, pfad] = eintrag.split("\t");
    if (pfad !== datei || !art.includes(BLOB)) return 0;
    return zeilenDes(git(["show", `${this.basis}:${datei}`], { cwd: root }).trimEnd()).length;
  }

  zeigtAufBestehendenCode({ datei, nummer }) {
    if (!brauchtRotenTest(this.kontext.auftrag) || !istCodeDatei(datei)) return false;
    return nummer > 0 && nummer <= this.zeilenAnDerBasis(datei);
  }

  pruefeTestbefund(befund) {
    if (!this.zeigtAufBestehendenCode(befund) || this.abnahmeFaelle.length === 0) return this.alsAusstieg(befund);
    const { root, auftrag } = this.kontext;
    this.testbefund = { ...befund, test: git(["show", `${this.basisBau}:${auftrag.abnahme}`], { cwd: root }), faelle: this.abnahmeFaelle };
    return this.scheitert(befund.zeile);
  }

  merkeAbnahmeFaelle() {
    const { root, auftrag } = this.kontext;
    this.abnahmeFaelle = ausgefuehrteFaelle(root, auftrag.abnahme);
    return true;
  }

  faelleErhalten() {
    if (this.befund === null) return true;
    const { root, auftrag } = this.kontext;
    const ausgefuehrt = ausgefuehrteFaelle(root, auftrag.abnahme);
    const fehlen = this.befund.faelle.filter((name) => !ausgefuehrt.includes(name));
    return fehlen.length === 0 || this.scheitert(`Der neu geschriebene Abnahmetest lässt Fälle des verworfenen weg: ${fehlen.join(", ")}`);
  }

  genannterAlterTest(alterTest) {
    const { root, auftrag } = this.kontext;
    const { datei } = alterTest;
    if (!gibtEsIn(this.basis, datei, root) || datei === auftrag.abnahme) return null;
    return nenntAltenTest(alterTest, testTitel(git(["show", `${this.basis}:${datei}`], { cwd: root })));
  }

  pruefeUndBelegeAltenTest(alterTest) {
    const { root } = this.kontext;
    const genannt = this.genannterAlterTest(alterTest);
    if (genannt === null) return this.alsAusstieg(alterTest);
    if (!this.importendungen() || !this.grenzen("bau", this.basisBau)) return false;
    const lauf = this.pruefung(ALTER_TEST, ["npm", "--silent", "test", "--", genannt.datei]);
    this.alterTest = { ...genannt, rot: lauf.exitCode !== 0, diff: sichereDiff(root, this.basisBau) };
    return this.scheitert(genannt.zeile);
  }

  importendungen() {
    return this.gruen(PRUEFUNG.IMPORTENDUNGEN, [execPath, EINSTIEG, "importendungen", "--basis", this.basisBau]);
  }

  grenzen(rolle, basis) {
    if (rolle === "bau") umzugZuruecknehmen(this.kontext.root, this.listenumzug);
    return this.gruen(GRENZ_PRUEFUNG[rolle], this.eigenerBefehl("grenzen", "--rolle", rolle, "--basis", basis), zweckBeleg);
  }

  bauHatGeaendert() {
    const geaendert = aenderungenSeit(this.basisBau, this.kontext.root).length > 0;
    return geaendert || this.scheitert("Der Bau-Agent hat keine Datei geändert.", GRUND.KEINE_AENDERUNG);
  }

  rotMitErwartetemFehler() {
    const ergebnis = this.pruefung(PRUEFUNG.ROT, this.eigenerBefehl("rot"));
    this.testausgabe = ergebnis.ausgabe;
    return ergebnis.exitCode === 0 || this.scheitert("Der Abnahmetest ist nicht mit dem erwarteten Fehler rot.", PRUEFUNG.ROT);
  }

  vorherGruen() {
    const ergebnis = this.pruefung(PRUEFUNG.ABNAHME_VORHER, abnahmeBefehl(this.kontext.auftrag));
    this.testausgabe = ergebnis.ausgabe;
    return ergebnis.exitCode === 0 || this.scheitert("Der Verhaltenstest ist schon vor dem Umbau rot.", PRUEFUNG.ABNAHME_VORHER);
  }

  allesVormerken() {
    const pfade = aenderungenSeit(this.basis, this.kontext.root).map(({ pfad }) => pfad);
    vormerken(pfade, this.kontext.root);
    return true;
  }

  festhalten(name, nachricht) {
    const lauf = festhalten(nachricht, this.kontext.root);
    const ergebnis = { name, befehl: "git commit -q -F -", exitCode: lauf.status ?? EXIT_ROT, ausgabe: `${lauf.stdout}\n${lauf.stderr}` };
    this.belegt(ergebnis);
    return ergebnis.exitCode === 0 || this.scheitert(`${name}: git commit endete mit Exit ${ergebnis.exitCode}.`);
  }

  zwischenstand() {
    this.allesVormerken();
    if (!this.festhalten(PRUEFUNG.ZWISCHENSTAND, `Zwischenstand: Abnahmetest für ${this.kontext.auftrag.id}\n`)) return false;
    this.basisBau = kopf(this.kontext.root);
    return true;
  }

  commitlint(nachricht) {
    const ergebnis = pruefeNachricht(nachricht, this.kontext.root);
    return this.gruenOderScheitert(this.belegt(ergebnis));
  }

  festschreiben(name, nachricht) {
    if (!this.commitlint(nachricht) || !this.festhalten(name, nachricht)) return false;
    this.basis = kopf(this.kontext.root);
    this.basisBau = this.basis;
    return true;
  }

  gesichert(patch) {
    this.patch = patch;
    return false;
  }

  entscheidungNoetig(entscheidung) {
    this.entscheidung = entscheidung;
    return this.scheitert(entscheidung.anlass);
  }

  typpruefung() {
    if (hatSkript(this.kontext.root, TYPPRUEFUNG)) return this.gruen(PRUEFUNG.TYPPRUEFUNG, ["npm", "--silent", "run", TYPPRUEFUNG]);
    this.hinweise.push(`Typprüfung: package.json hat kein Skript ${TYPPRUEFUNG}.`);
    return true;
  }

  pinPruefung() {
    const { root } = this.kontext;
    if (!existsSync(join(root, PIN_PRUEFUNG))) {
      if (!existsSync(join(root, PIN_HAKEN))) return true;
      return this.gruenOderScheitert(this.belegt({ name: PRUEFUNG.PIN, befehl: [execPath, PIN_PRUEFUNG], exitCode: EXIT_ROT, ausgabe: PIN_FEHLT }));
    }
    const vorgemerkt = git(["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=ACM", "-z", "--", "*.js", "*.mjs", "*.ts", "*.mts", "*.cts"], { cwd: root });
    return this.gruen(PRUEFUNG.PIN, [execPath, PIN_PRUEFUNG, ...vorgemerkt.split(NUL).filter(Boolean)], vollerBeleg);
  }

  gekuerzt(pfad) {
    const vorher = git(["show", `${this.basis}:${UNTERDRUECKUNGEN}`], { cwd: this.kontext.root });
    return eintraege(readFileSync(pfad, "utf8")) < eintraege(vorher);
  }

  behalteFremde(pfad, vorher) {
    const eigene = new Set(aenderungenSeit(this.basis, this.kontext.root).map(({ pfad: datei }) => datei));
    const alt = JSON.parse(vorher);
    const zusammen = nurEigeneGekuerzt(alt, JSON.parse(readFileSync(pfad, "utf8")), eigene);
    writeFileSync(pfad, isDeepStrictEqual(zusammen, alt) ? vorher : wieEslint(zusammen));
  }

  unterdrueckungenKuerzen() {
    const { auftrag, root } = this.kontext;
    const pfad = join(root, UNTERDRUECKUNGEN);
    if (auftrag.art !== "umbau" || !existsSync(pfad)) return true;
    const befehl = ["npm", "--silent", "run", "lint", "--", "--prune-suppressions"];
    const vorher = readFileSync(pfad, "utf8");
    if (!this.gruen(PRUEFUNG.UNTERDRUECKUNGEN_KUERZEN, befehl)) return false;
    this.behalteFremde(pfad, vorher);
    if (this.aufraeumen && !this.gekuerzt(pfad)) {
      return this.gruenOderScheitert(this.belegt({ name: PRUEFUNG.UNTERDRUECKUNGEN_KUERZEN, befehl, exitCode: EXIT_ROT, ausgabe: NICHT_GEKUERZT }));
    }
    vormerken([UNTERDRUECKUNGEN], root);
    return true;
  }

  listenUmziehen() {
    const { gruen, umzug } = umzugGemerkt(this.kontext.root, () => this.gruen(PRUEFUNG.LISTENUMZUG, [execPath, LISTENUMZUG, "--basis", this.basisBau]));
    this.listenumzug = umzug;
    return gruen;
  }

  commitNachricht() {
    const { phase, auftrag } = this.kontext;
    const belege = this.pruefungen.map(({ name, exitCode }) => `${name}: Exit ${exitCode}`);
    const absatz = auftrag.art === "fehlerbehebung" ? "Ursache" : "Warum";
    const warum = `${absatz}: Auftrag ${auftrag.id} der Phase ${phase.phase}; tools/auftrag.mjs hat ihn gebaut und geprüft.`;
    const herkunft = herkunftsZeilen(phase, auftrag);
    const paket = phase.paket ? [`Paket: ${phase.paket}`] : [];
    const hinweise = hinweiseDesBaus(this.agenten);
    const abschnitt = hinweise.length > 0 ? [...hinweise, ""] : [];
    const begruendung = this.uebernimmBegruendung(Object.keys(this.zweck));
    const zettel = [AUFTRAG_LAUT_PHASE, "", ...auftragsBlock(phase, auftrag)];
    return [auftrag.ziel, "", warum, ...this.berichtszeilen, ...belege, "", ...begruendung, ...abschnitt, ...zettel, ...herkunft, ...paket, ""].join("\n");
  }

  uebernimmBegruendung(rollen) {
    const vorige = rollen.includes("bau") && !this.vorigeBerichtet ? this.vorigeRunden : [];
    this.vorigeBerichtet ||= vorige.length > 0;
    const rot = roterAbschnitt([...vorige, roteRunde({ runde: this.runde, pruefungen: this.pruefungen.slice(this.berichtet), agenten: this.agenten })]);
    const absaetze = rollen.flatMap((rolle) => {
      const zeilen = Object.entries(this.zweck[rolle]).flatMap(([id, text]) => `Zweck ${id}: ${text}`.split("\n").map((zeile) => `${ZITAT}${zeile}`));
      this.zweck[rolle] = {};
      return zeilen.length > 0 ? [`Zweck der Prüfungen, Begründung des ${BEGRUENDUNG_DES[rolle]}:`, ...zeilen, ""] : [];
    });
    this.berichtet = this.pruefungen.length;
    return [...rot, ...absaetze];
  }

  abschliessen() {
    const nachricht = this.commitNachricht();
    if (!this.commitlint(nachricht)) return false;
    weichZuruecksetzen(this.basis, this.kontext.root);
    if (!this.festhalten(PRUEFUNG.COMMIT, nachricht)) return false;
    this.commit = kopf(this.kontext.root);
    return true;
  }

  schritte() {
    const { auftrag } = this.kontext;
    if (auftrag.art === TESTUMBAU) return [...testumbauSchritte(this), () => this.abschliessen()];
    const vorBau = brauchtRotenTest(auftrag)
      ? [
          () => this.agent("test", testAgentPrompt(this.kontext)),
          () => this.grenzen("test", this.basis),
          () => this.faelleErhalten(),
          () => this.gruen(PRUEFUNG.GEAENDERTE_FAELLE, [execPath, EINSTIEG, "faelle", "--basis", this.basis]),
          () => this.rotMitErwartetemFehler(),
          () => this.zwischenstand(),
          () => this.merkeAbnahmeFaelle(),
          () => bisektion(this),
        ]
      : [() => this.vorherGruen()];
    return [...vorBau, ...this.bauSchritte(), ...mutationsSchritte(this), () => this.unterdrueckungenKuerzen(), () => this.abschliessen()];
  }

  bauSchritte() {
    const { auftrag } = this.kontext;
    return [
      () => this.agent("bau", [bauPrompt(this.kontext, this.testausgabe), ...this.zusaetze].join("\n")),
      () => this.importendungen(),
      () => this.grenzen("bau", this.basisBau),
      () => this.bauHatGeaendert(),
      () => this.listenUmziehen(),
      () => this.allesVormerken(),
      () => this.gruen(PRUEFUNG.GENUTZT, this.eigenerBefehl("genutzt", "--basis", this.basisBau)),
      () => this.gruen(MELDUNG.MIGRATIONEN, [execPath, MIGRATIONEN_PRUEFEN, "--basis", this.basis], befundOhneZweck),
      () => this.gruen(MELDUNG.FESTE_PFADE, [execPath, FESTE_PFADE, "--basis", this.basis, "--nur-neue"], befundOhneZweck),
      () => auftrag.art !== "umbau" || this.gruen(MELDUNG.VORBEREITUNG, [execPath, VORBEREITUNG, "--basis", this.basis, "--bereich", VORBEREITUNG_BEREICH], befundOhneZweck),
      () => this.typpruefung(),
      () => this.gruen(PRUEFUNG.LINT, ["npm", "--silent", "run", "lint"]),
      () => this.pinPruefung(),
      () => this.gruen(PRUEFUNG.ABNAHME, abnahmeBefehl(auftrag)),
      () => this.gruen(PRUEFUNG.BETROFFENE_TESTS, ["npm", "--silent", "run", "test:betroffen", "--", "--basis", this.basis, "--ohne-volle-suite"]),
    ];
  }

  fuehreAus() {
    const gruen = this.schritte().every((schritt) => schritt());
    const { phase, auftrag, root } = this.kontext;
    const ergebnis = {
      phase: phase.phase,
      auftrag: auftrag.id,
      runde: this.runde,
      art: auftrag.art,
      bereich: auftrag.bereich,
      basis: this.basis,
      ergebnis: gruen ? GRUEN : ROT,
      grund: this.grund,
      roteIds: this.roteIds,
      voraussetzung: this.voraussetzung,
      ausstieg: this.ausstieg,
      alterTest: this.alterTest,
      testbefund: this.testbefund,
      entscheidung: this.entscheidung,
      patch: this.patch,
      commit: this.commit,
      agenten: this.agenten,
      nachfragen: this.nachfragen,
      pruefungen: this.pruefungen,
      hinweise: this.hinweise,
      kosten: kostenDesAuftrags(root, [...this.agenten, ...this.nachfragen]),
      zeit: new Date().toISOString(),
    };
    druckeBeleg(ergebnis, schreibeBeleg(root, ergebnis));
    return ergebnis;
  }
}

function gebauteAuftraege(phase, root) {
  const commits = auftragsTrailer(root);
  const gebaut = (auftrag) => commits.some((trailer) => herkunftsZeilen(phase, auftrag).every((zeile) => trailer.has(zeile)));
  return new Set(phase.auftraege.filter(gebaut).map(({ id }) => id));
}

function startBefunde(phasendatei, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  const ohneIssue = befunde.length === 0 ? issueBefunde(phase) : [];
  const form = ohneIssue.length > 0 ? [...ohneIssue, ISSUE_ZWECK] : befunde;
  const zweck = form.length > 0 ? zweckBlock(MELDUNG.PHASENDATEI) : [];
  const annahmen = form.length > 0 ? [] : annahmenBefunde(phase, root);
  const sauber = istSauber(root) ? [] : ["Der Arbeitsbaum hat Änderungen; lauf startet nur auf einem sauberen Stand."];
  const werkzeug = form.length > 0 ? [] : werkzeugBefunde(root);
  return { phase, befunde: [...form, ...annahmen, ...sauber, ...zweck, ...werkzeug] };
}

function entschiedenerAlterTest(pfad) {
  try {
    const { entscheidung, alterTest } = JSON.parse(readFileSync(pfad, "utf8"));
    const datei = entscheidung ? alterTest?.datei : undefined;
    return typeof datei === "string" && istAusfuehrbarerTest(datei) ? datei : null;
  } catch {
    return null;
  }
}

function entschiedeneAlteTests({ phase, auftrag, root }) {
  const dateien = belegeDesAuftrags(root, phase.phase, auftrag.id).map(entschiedenerAlterTest);
  return [...new Set(dateien.filter((datei) => datei !== null))].sort();
}

function freigabe(kontext) {
  const { phase, auftrag, root } = kontext;
  const dateien = entschiedeneAlteTests(kontext);
  if (dateien.length === 0) return {};
  const issue = phasenIssue(phase.issue, root);
  const freie = dateien.filter((datei) => {
    const problem = freigabeProblem(issue, datei);
    if (problem !== null) console.log(`Auftrag ${auftrag.id}: keine Freigabe für ${datei}: ${problem}`);
    return problem === null;
  });
  if (freie.length === 0) return {};
  const frei = { ...auftrag, erwarteteDateien: [...new Set([...auftrag.erwarteteDateien, ...freie])] };
  const abgeleitet = { ...phase, auftraege: phase.auftraege.map((eintrag) => (eintrag.id === auftrag.id ? frei : eintrag)) };
  const ordner = belegVerzeichnis(root, phase.phase);
  mkdirSync(ordner, { recursive: true });
  const freigabedatei = join(ordner, `${auftrag.id}.freigabe.phase.json`);
  writeFileSync(freigabedatei, JSON.stringify(abgeleitet));
  for (const datei of freie) console.log(`Auftrag ${auftrag.id}: Issue #${phase.issue} gibt ${datei} frei; nur der Test-Agent darf die Datei in diesem Auftrag ändern.`);
  return { phase: abgeleitet, auftrag: frei, phasendatei: freigabedatei };
}

function phasenende({ fertig, vorher, amPhasenende }, root) {
  if (!amPhasenende) return ciLokalNichtGelaufen(root, TEILLAUF);
  return fertig.size > vorher ? ciLokalAmPhasenende(root, phasenbasis(root)) : ciLokalNichtGelaufen(root, OHNE_NEUEN_AUFTRAG);
}

export function lauf(phasendatei, root, { amPhasenende = true } = {}) {
  const { phase, befunde } = startBefunde(phasendatei, root);
  if (befunde.length > 0) {
    for (const befund of befunde) console.error(befund);
    return EXIT_ROT;
  }
  const fertig = gebauteAuftraege(phase, root);
  const plan = { phase, fertig, vorher: fertig.size, amPhasenende };
  for (const kennung of plan.fertig) console.log(`Auftrag ${kennung}: schon gebaut, übersprungen.`);
  for (;;) {
    const { ordnung } = reihenfolge(plan.phase.auftraege);
    const auftrag = ordnung.find(({ id }) => !plan.fertig.has(id));
    if (auftrag === undefined) return phasenende(plan, root);
    const kontext = { phase: plan.phase, auftrag, root, design: designPfad(plan.phase), phasendatei, plan };
    const frei = freigabe(kontext);
    const ergebnis = fuehreRundenAus(kontext, (runde) => new AuftragsLauf(runde.auftrag.id === auftrag.id ? { ...runde, ...frei } : runde).fuehreAus());
    if (ergebnis === GRUEN) plan.fertig.add(auftrag.id);
    else if (ergebnis === NEU_GESCHNITTEN) plan.phase = ladePhase(phasendatei);
    else return EXIT_ROT;
  }
}
