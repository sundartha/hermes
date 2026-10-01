import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { testPrompt } from "./agenten.mjs";
import { GRUEN, ROT, belegVerzeichnis, schreibeBeleg } from "./bericht.mjs";
import { frage } from "./einsatz.mjs";
import { phasenBefunde } from "./format.mjs";
import { git } from "./git.mjs";
import { kostenDesAuftrags } from "./kosten.mjs";
import { beleg, fuehreAus } from "./pruefungen.mjs";

export const ENTWURFSPRUEFUNG = "entwurfsprüfung";
const MAX_RUNDEN = 2;
const LABEL = "entscheidung";
const JSON_OBJEKT = /\{[\s\S]*\}/;
const ISSUE = /^(?:\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)$/;
const UMBAU_FELDER = ["ziel", "bereich", "erwarteteDateien", "vorbild", "abnahme"];
const CODEBLOCK = "```";

function verwerfe(basis, root) {
  git(["reset", "-q", "--hard", basis], { cwd: root });
  git(["clean", "-q", "-fd"], { cwd: root });
}

function abschnitt(titel, zeilen) {
  return ["", `## ${titel}`, "", ...zeilen, ""].join("\n");
}

function fehlerausgabe({ runde, grund, pruefungen }) {
  const rot = pruefungen.filter(({ exitCode }) => exitCode !== 0);
  return [`Runde ${runde}: ${grund}`, ...rot.flatMap(({ name, zeilen }) => [`${name}:`, ...zeilen])].join("\n");
}

function planPrompt(phase, auftrag, satz) {
  return [
    testPrompt(phase, auftrag),
    abschnitt("Voraussetzung fehlt", [`Der Bau-Agent hat aufgehört: ${satz}`]),
    abschnitt("Deine Aufgabe", [
      "Mach aus der fehlenden Voraussetzung genau einen Umbau-Auftrag, der sie herstellt und das Verhalten nicht ändert.",
      `Antworte nur mit einem JSON-Objekt mit den Feldern ${UMBAU_FELDER.join(", ")} und entwurf.`,
      "ziel ist eine Zeile mit höchstens 72 Zeichen, abnahme ein bestehender Test, der vor und nach dem Umbau grün ist, entwurf der Entwurfsabschnitt für den Bereich in Klartext.",
    ]),
  ].join("\n");
}

function notizPrompt(phase, auftrag, fehler) {
  return [
    testPrompt(phase, auftrag),
    abschnitt("Fehlerausgabe beider Runden", [CODEBLOCK, ...fehler, CODEBLOCK]),
    abschnitt("Deine Aufgabe", [
      `Der Auftrag ist nach ${MAX_RUNDEN} roten Runden gestoppt. Schreib eine Entscheidungsnotiz für Menschen, die keinen Code lesen.`,
      "Sie hat drei Teile in Klartext ohne Code: was versucht wurde, was beobachtet wurde, und zwei bis drei nummerierte Optionen mit deiner Empfehlung.",
      "Antworte nur mit der Notiz.",
    ]),
  ].join("\n");
}

function vorschlag(antwort) {
  try {
    const wert = JSON.parse(JSON_OBJEKT.exec(antwort)?.[0] ?? "");
    return wert !== null && typeof wert === "object" ? wert : {};
  } catch {
    return {};
  }
}

function umbauPhase(phase, auftrag, antwort) {
  const felder = vorschlag(antwort);
  const gewaehlt = Object.fromEntries(UMBAU_FELDER.map((feld) => [feld, felder[feld]]));
  const umbau = { ...gewaehlt, id: `${auftrag.id}-umbau`, art: "umbau" };
  return { ...phase, entwurf: { [umbau.bereich]: felder.entwurf }, auftraege: [umbau] };
}

function veroeffentliche(issue, text, root) {
  const ziel = String(issue ?? "");
  if (!ISSUE.test(ziel)) {
    return { pruefungen: [], hinweis: "Die Phasendatei nennt kein gültiges Issue; die Notiz steht nur im Beleg." };
  }
  const gh = env.HERMES_GH ?? "gh";
  const pruefungen = [
    fuehreAus("entscheidung kommentar", [gh, "issue", "comment", ziel, "--body-file", "-"], { cwd: root, env, eingabe: text }),
    fuehreAus("entscheidung label", [gh, "issue", "edit", ziel, "--add-label", LABEL], { cwd: root, env }),
  ].map(beleg);
  const geschrieben = pruefungen.every(({ exitCode }) => exitCode === 0);
  const hinweis = geschrieben
    ? `Die Notiz steht als Kommentar im Issue ${ziel}.`
    : "Die Notiz ließ sich nicht vollständig ins Issue schreiben; sie steht im Beleg.";
  return { pruefungen, hinweis };
}

class Runden {
  constructor(kontext, starteRunde) {
    this.kontext = kontext;
    this.starteRunde = starteRunde;
    this.fehler = [];
  }

  vorgeschichte() {
    if (this.fehler.length === 0) return "";
    return abschnitt("Fehlerausgabe der vorigen Runde", [
      "Ein früherer Agent ist an diesem Auftrag gescheitert; sein Verlauf ist verworfen. Das ist seine Fehlerausgabe:",
      "",
      CODEBLOCK,
      ...this.fehler,
      CODEBLOCK,
    ]);
  }

  fuehreAus() {
    for (;;) {
      const runde = this.fehler.length + 1;
      const ergebnis = this.starteRunde({ ...this.kontext, runde, vorgeschichte: this.vorgeschichte() });
      if (ergebnis.ergebnis === GRUEN) return GRUEN;
      if (ergebnis.voraussetzung) {
        const vorlauf = this.voraussetzungFehlt(ergebnis);
        if (vorlauf !== GRUEN) return vorlauf;
        continue;
      }
      this.fehler.push(fehlerausgabe(ergebnis));
      if (this.fehler.length === MAX_RUNDEN) return this.entscheidung(ergebnis);
      verwerfe(ergebnis.basis, this.kontext.root);
    }
  }

  voraussetzungFehlt(ergebnis) {
    const { zaehler, root } = this.kontext;
    verwerfe(ergebnis.basis, root);
    zaehler.voraussetzungen += 1;
    if (zaehler.voraussetzungen > 1) {
      return this.zurueckInDenEntwurf(ergebnis, `Voraussetzung fehlt zum zweiten Mal: ${ergebnis.voraussetzung}`);
    }
    const plan = this.planeUmbau(ergebnis);
    if (plan.befunde.length > 0) {
      return this.zurueckInDenEntwurf(ergebnis, `Kein gültiger Umbau-Auftrag: ${plan.befunde.join("; ")}`);
    }
    return new Runden({ ...this.kontext, ...plan.kontext }, this.starteRunde).fuehreAus();
  }

  planeUmbau(ergebnis) {
    const { phase, auftrag, root } = this.kontext;
    const plan = frage({ rolle: "plan", phase, auftrag, root }, planPrompt(phase, auftrag, ergebnis.voraussetzung));
    const neu = umbauPhase(phase, auftrag, plan.antwort);
    const [umbau] = neu.auftraege;
    const befunde = plan.exitCode === 0 ? phasenBefunde(neu, root) : [`Der Plan-Agent endete mit Exit ${plan.exitCode}.`];
    schreibeBeleg(root, {
      phase: phase.phase,
      auftrag: `${auftrag.id}-plan`,
      ergebnis: befunde.length === 0 ? GRUEN : ROT,
      grund: `Voraussetzung fehlt: ${ergebnis.voraussetzung}`,
      befunde,
      umbau,
      agenten: plan.sitzungen,
      kosten: kostenDesAuftrags(root, plan.sitzungen),
      zeit: new Date().toISOString(),
    });
    if (befunde.length > 0) return { befunde };
    const phasendatei = join(belegVerzeichnis(root, phase.phase), `${umbau.id}.phase.json`);
    writeFileSync(phasendatei, JSON.stringify(neu));
    return { befunde, kontext: { phase: neu, auftrag: umbau, phasendatei } };
  }

  zurueckInDenEntwurf(ergebnis, grund) {
    const text = `Zurück in die Entwurfsprüfung: ${grund}`;
    schreibeBeleg(this.kontext.root, { ...ergebnis, ergebnis: ENTWURFSPRUEFUNG, grund: text });
    console.log(`Auftrag ${ergebnis.auftrag}: ${ENTWURFSPRUEFUNG} (${text})`);
    return ENTWURFSPRUEFUNG;
  }

  entscheidung(ergebnis) {
    const { phase, auftrag, root } = this.kontext;
    const notiz = frage({ rolle: "notiz", phase, auftrag, root }, notizPrompt(phase, auftrag, this.fehler));
    const kopf = `Auftrag ${auftrag.id} der Phase ${phase.phase} ist nach ${MAX_RUNDEN} roten Runden gestoppt.`;
    const text = ["## Entscheidung nötig", "", kopf, "", notiz.antwort.trim() || this.fehler.join("\n\n"), ""].join("\n");
    const veroeffentlicht = veroeffentliche(phase.issue, text, root);
    schreibeBeleg(root, { ...ergebnis, runden: this.fehler, entscheidung: { text, agenten: notiz.sitzungen, ...veroeffentlicht } });
    console.log(`Auftrag ${auftrag.id}: Entscheidung nötig. ${veroeffentlicht.hinweis}`);
    return ROT;
  }
}

export function fuehreRundenAus(kontext, starteRunde) {
  return new Runden({ ...kontext, zaehler: { voraussetzungen: 0 } }, starteRunde).fuehreAus();
}
