import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { bauPrompt, testPrompt } from "./agenten.mjs";
import { EXIT_GRUEN, EXIT_ROT, abnahmeBefehl, gueltigePhase, hatSkript } from "./befehle.mjs";
import { BELEGE, GRUEN, ROT, druckeBeleg, fingerabdruck, hinweiseDesBaus, schreibeBeleg } from "./bericht.mjs";
import { bisektion } from "./bisektion.mjs";
import { brauchtRotenTest, reihenfolge } from "./format.mjs";
import { aenderungenSeit, festhalten, istSauber, kopf, vormerken, weichZuruecksetzen } from "./git.mjs";
import { setzeEin } from "./einsatz.mjs";
import { kostenDesAuftrags } from "./kosten.mjs";
import { mutationsSchritte } from "./mutation.mjs";
import { beleg, fuehreAus } from "./pruefungen.mjs";
import { fuehreRundenAus } from "./runden.mjs";

const EINSTIEG = fileURLToPath(new URL("../auftrag.mjs", import.meta.url));
const TYPPRUEFUNG = "typecheck";

class AuftragsLauf {
  constructor({ phase, auftrag, root, phasendatei, runde, vorgeschichte }) {
    this.kontext = { phase, auftrag, root };
    this.phasendatei = phasendatei;
    this.runde = runde;
    this.vorgeschichte = vorgeschichte;
    this.voraussetzung = null;
    this.ausstieg = null;
    this.basis = kopf(root);
    this.basisBau = this.basis;
    this.testausgabe = "";
    this.agenten = [];
    this.pruefungen = [];
    this.hinweise = [];
    this.zusaetze = [];
    this.berichtszeilen = [];
    this.grund = null;
    this.commit = null;
  }

  scheitert(grund) {
    this.grund = grund;
    return false;
  }

  pruefung(name, befehl) {
    const ergebnis = fuehreAus(name, befehl, { cwd: this.kontext.root, env });
    this.pruefungen.push(beleg(ergebnis));
    return ergebnis;
  }

  gruen(name, befehl) {
    const { exitCode } = this.pruefung(name, befehl);
    return exitCode === 0 || this.scheitert(`${name} endete mit Exit ${exitCode}.`);
  }

  eigenerBefehl(befehl, ...argumente) {
    return [execPath, EINSTIEG, befehl, this.phasendatei, this.kontext.auftrag.id, ...argumente];
  }

  agent(rolle, prompt, fortsetzung) {
    const vorher = fingerabdruck(this.kontext.root);
    const ergebnis = setzeEin({ rolle, ...this.kontext, fortsetzung }, `${prompt}${this.vorgeschichte}`);
    this.agenten.push(...ergebnis.sitzungen);
    if (fingerabdruck(this.kontext.root) !== vorher) {
      return this.scheitert(`Der Agent ${ergebnis.agent} hat ${BELEGE}/ verändert.`);
    }
    this.voraussetzung = ergebnis.voraussetzung;
    if (this.voraussetzung) return this.scheitert(`Voraussetzung fehlt: ${this.voraussetzung}`);
    this.ausstieg = ergebnis.ausstieg;
    if (this.ausstieg) return this.scheitert(`Auftrag passt nicht: ${this.ausstieg}`);
    if (ergebnis.grund) return this.scheitert(ergebnis.grund);
    return ergebnis.exitCode === 0 || this.scheitert(`Der Agent ${ergebnis.agent} endete mit Exit ${ergebnis.exitCode}.`);
  }

  grenzen(rolle, basis) {
    return this.gruen(`grenzen ${rolle}`, this.eigenerBefehl("grenzen", "--rolle", rolle, "--basis", basis));
  }

  rotMitErwartetemFehler() {
    const ergebnis = this.pruefung("rot", this.eigenerBefehl("rot"));
    this.testausgabe = ergebnis.ausgabe;
    return ergebnis.exitCode === 0 || this.scheitert("Der Abnahmetest ist nicht mit dem erwarteten Fehler rot.");
  }

  vorherGruen() {
    const ergebnis = this.pruefung("abnahme vorher", abnahmeBefehl(this.kontext.auftrag));
    this.testausgabe = ergebnis.ausgabe;
    return ergebnis.exitCode === 0 || this.scheitert("Der Verhaltenstest ist schon vor dem Umbau rot.");
  }

  allesVormerken() {
    const pfade = aenderungenSeit(this.basis, this.kontext.root).map(({ pfad }) => pfad);
    vormerken(pfade, this.kontext.root);
    return true;
  }

  festhalten(name, nachricht) {
    const lauf = festhalten(nachricht, this.kontext.root);
    const ergebnis = { name, befehl: "git commit -q -F -", exitCode: lauf.status ?? EXIT_ROT, ausgabe: `${lauf.stdout}\n${lauf.stderr}` };
    this.pruefungen.push(beleg(ergebnis));
    return ergebnis.exitCode === 0 || this.scheitert(`${name}: git commit endete mit Exit ${ergebnis.exitCode}.`);
  }

  zwischenstand() {
    this.allesVormerken();
    if (!this.festhalten("zwischenstand", `Zwischenstand: Abnahmetest für ${this.kontext.auftrag.id}\n`)) return false;
    this.basisBau = kopf(this.kontext.root);
    return true;
  }

  typpruefung() {
    if (hatSkript(this.kontext.root, TYPPRUEFUNG)) return this.gruen("typprüfung", ["npm", "--silent", "run", TYPPRUEFUNG]);
    this.hinweise.push(`Typprüfung: package.json hat kein Skript ${TYPPRUEFUNG}.`);
    return true;
  }

  commitNachricht() {
    const { phase, auftrag } = this.kontext;
    const belege = this.pruefungen.map(({ name, exitCode }) => `${name}: Exit ${exitCode}`);
    const absatz = auftrag.art === "fehlerbehebung" ? "Ursache" : "Warum";
    const warum = `${absatz}: Auftrag ${auftrag.id} der Phase ${phase.phase}; tools/auftrag.mjs hat ihn gebaut und geprüft.`;
    const herkunft = [`Auftrag: ${phase.phase}/${auftrag.id}`, `Art: ${auftrag.art}`];
    const paket = phase.paket ? [`Paket: ${phase.paket}`] : [];
    const hinweise = hinweiseDesBaus(this.agenten);
    const abschnitt = hinweise.length > 0 ? [...hinweise, ""] : [];
    return [auftrag.ziel, "", warum, ...this.berichtszeilen, ...belege, "", ...abschnitt, ...herkunft, ...paket, ""].join("\n");
  }

  abschliessen() {
    weichZuruecksetzen(this.basis, this.kontext.root);
    if (!this.festhalten("commit", this.commitNachricht())) return false;
    this.commit = kopf(this.kontext.root);
    return true;
  }

  schritte() {
    const { auftrag } = this.kontext;
    const vorBau = brauchtRotenTest(auftrag)
      ? [
          () => this.agent("test", testPrompt(this.kontext.phase, auftrag)),
          () => this.grenzen("test", this.basis),
          () => this.rotMitErwartetemFehler(),
          () => this.zwischenstand(),
          () => bisektion(this),
        ]
      : [() => this.vorherGruen()];
    return [...vorBau, ...this.bauSchritte(), ...mutationsSchritte(this), () => this.abschliessen()];
  }

  bauSchritte() {
    const { auftrag } = this.kontext;
    return [
      () => this.agent("bau", [bauPrompt(this.kontext, this.testausgabe), ...this.zusaetze].join("\n")),
      () => this.grenzen("bau", this.basisBau),
      () => this.allesVormerken(),
      () => this.typpruefung(),
      () => this.gruen("lint", ["npm", "--silent", "run", "lint"]),
      () => this.gruen("abnahme", abnahmeBefehl(auftrag)),
      () => this.gruen("betroffene tests", ["npm", "--silent", "run", "test:betroffen", "--", "--basis", this.basis, "--ohne-volle-suite"]),
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
      voraussetzung: this.voraussetzung,
      ausstieg: this.ausstieg,
      commit: this.commit,
      agenten: this.agenten,
      pruefungen: this.pruefungen,
      hinweise: this.hinweise,
      kosten: kostenDesAuftrags(root, this.agenten),
      zeit: new Date().toISOString(),
    };
    druckeBeleg(ergebnis, schreibeBeleg(root, ergebnis));
    return ergebnis;
  }
}

export function lauf(phasendatei, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  if (!istSauber(root)) befunde.push("Der Arbeitsbaum hat Änderungen; lauf startet nur auf einem sauberen Stand.");
  if (befunde.length > 0) {
    for (const befund of befunde) console.error(befund);
    return EXIT_ROT;
  }
  for (const auftrag of reihenfolge(phase.auftraege).ordnung) {
    const ergebnis = fuehreRundenAus({ phase, auftrag, root, phasendatei }, (runde) => new AuftragsLauf(runde).fuehreAus());
    if (ergebnis !== GRUEN) return EXIT_ROT;
  }
  return EXIT_GRUEN;
}
