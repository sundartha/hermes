import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { testPrompt } from "./agenten.mjs";
import { BELEGE, GRUEN, ROT, belegVerzeichnis, hinweiseDesBaus, hinweiseFuerNotiz, notizAuszug, schreibeBeleg } from "./bericht.mjs";
import { auswegBei, nenntAltenTest, zweckUnklar } from "./ausgang.mjs";
import { entnimmVolleAntwort, frage } from "./einsatz.mjs";
import { TESTUMBAU, UMBAU_AUSWEG, istTestbereich, istUmbau, phasenBefunde } from "./format.mjs";
import { git } from "./git.mjs";
import { kostenDesAuftrags } from "./kosten.mjs";
import { NEU_GESCHNITTEN, planbar, schneideNeu } from "./neuschnitt.mjs";
import { beleg, fuehreAus } from "./pruefungen.mjs";
import { idsDer, pflichtDer, rotePruefungen, roteRunde, zweckIdsDer } from "./rote-pruefungen.mjs";
import { testTitel, zusicherungenGleich } from "./testtitel.mjs";
import { MELDUNG, PRUEFUNG, absatzZuordnung, hatAusweg, zweckBlock } from "./zweck.mjs";

export const ENTWURFSPRUEFUNG = "entwurfsprüfung";
const MAX_RUNDEN = 2;
const LABEL = "entscheidung";
const JSON_OBJEKT = /\{[\s\S]*\}/;
const ISSUE = /^(?:\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)$/;
const UMBAU_FELDER = ["ziel", "bereich", "erwarteteDateien", "abnahme"];
const CODEBLOCK = "```";
const KEIN_VORSCHLAG = "Der Plan-Agent lieferte kein lesbares JSON-Objekt.";
const ECHTES_VERHALTEN = "Verhalten:";
const AUSWEG_SCHLUSS =
  "Hältst du eine dieser Prüfungen hier für falsch, nimm den Ausweg aus ihrem Block statt einer Umgehung. Ein Ausstieg zählt nicht als rote Runde, aber sein Grund geht wörtlich an den Planer oder an Antonio und wird dort geprüft. „Voraussetzung fehlt“ und „Alter Test hält altes Verhalten fest“ liest das Skript nur beim Bau-Agenten.";

function verwerfe(basis, root) {
  git(["reset", "-q", "--hard", basis], { cwd: root });
  git(["clean", "-q", "-fd"], { cwd: root });
}

function abschnitt(titel, zeilen) {
  return ["", `## ${titel}`, "", ...zeilen, ""].join("\n");
}

function fehlerausgabe(ergebnis) {
  const { runde, grund, pruefungen, agenten, roteIds = [] } = ergebnis;
  const gezeigt = new Set();
  const bloecke = (ids) => {
    const neu = ids.filter((id) => !gezeigt.has(id));
    for (const id of neu) gezeigt.add(id);
    return neu.flatMap(zweckBlock);
  };
  const zeilen = rotePruefungen(pruefungen).flatMap((pruefung) => [`${pruefung.name}:`, ...pruefung.zeilen, ...bloecke(zweckIdsDer(pruefung))]);
  const ohneSchritt = bloecke(roteIds);
  const schluss = [...gezeigt].some(hatAusweg) ? [AUSWEG_SCHLUSS] : [];
  const absatz = absatzZuordnung(pflichtDer([roteRunde(ergebnis)]));
  return [`Runde ${runde}: ${grund}`, ...zeilen, ...ohneSchritt, ...schluss, ...absatz, ...hinweiseDesBaus(agenten)].join("\n");
}

function voraussetzungsAnlass(satz) {
  return {
    titel: "Voraussetzung fehlt",
    zeilen: [`Der Bau-Agent hat aufgehört: ${satz}`],
    aufgabe: "Mach aus der fehlenden Voraussetzung genau einen Umbau-Auftrag, der sie herstellt und das Verhalten nicht ändert.",
    grund: `Voraussetzung fehlt: ${satz}`,
  };
}

function vorbauAnlass({ zeile, datei, diff = "" }) {
  return {
    titel: "Alter Test hält altes Verhalten fest",
    zeilen: [`Der Bau-Agent hat aufgehört: ${zeile}`, `Die Testdatei ${datei} ist mit seiner Änderung rot. Das ist sein verworfener Diff:`, CODEBLOCK, diff, CODEBLOCK],
    aufgabe: [
      `Prüf, ob nur der Vorbau dieses alten Tests (gemeinsame Vorbereitung, Testdaten, Testhilfe) mit dem Auftrag kollidiert und nicht seine Erwartung.`,
      `Wenn ja, mach daraus genau einen ${TESTUMBAU}, der den Vorbau so umbaut, dass jeder Fall in ${datei} vor und nach dem Umbau grün ist und keine Erwartung sich ändert; abnahme ist ${datei}.`,
      `Hält der Test genau das Verhalten fest, das der Auftrag ändert, antworte statt des JSON-Objekts nur mit einer Zeile, die mit „${ECHTES_VERHALTEN}“ beginnt und danach deinen Grund nennt; dann entscheidet Antonio.`,
    ].join(" "),
    grund: zeile,
  };
}

function planPrompt(phase, auftrag, anlass) {
  return [
    testPrompt(phase, auftrag),
    abschnitt(anlass.titel, anlass.zeilen),
    abschnitt("Deine Aufgabe", [
      anlass.aufgabe,
      `Antworte nur mit einem JSON-Objekt mit den Feldern ${UMBAU_FELDER.join(", ")} und entwurf.`,
      "ziel ist eine Zeile mit höchstens 72 Zeichen, abnahme ein bestehender Test, der vor und nach dem Umbau grün ist, entwurf der Entwurfsabschnitt für den Bereich in Klartext.",
      "bereich und jeder Eintrag in erwarteteDateien sind reine relative Pfade ohne Zusatz: keine Klammern, keine Funktionsnamen, keine Erklärung.",
      `Fehlt nur eine Änderung an bestehenden Tests oder Testhilfen, liegt bereich unter test/ und erwarteteDateien nennt nur Testdateien; das Skript legt daraus einen ${TESTUMBAU} an, den der Test-Agent ausführt, ohne Produktcode zu ändern.`,
    ]),
  ].join("\n");
}

function notizPrompt(phase, auftrag, { anlass, verlauf, zweck = [] }) {
  return [
    testPrompt(phase, auftrag),
    ...(zweck.length > 0 ? [abschnitt("Wozu der Stopp da ist", zweck)] : []),
    abschnitt("Verlauf", [CODEBLOCK, ...verlauf, CODEBLOCK]),
    abschnitt("Deine Aufgabe", [
      `${anlass} Schreib eine Entscheidungsnotiz für Menschen, die keinen Code lesen.`,
      "Sie hat drei Teile in Klartext ohne Code: was versucht wurde, was beobachtet wurde, und zwei bis drei nummerierte Optionen mit deiner Empfehlung.",
      "Antworte nur mit der Notiz.",
    ]),
  ].join("\n");
}

function vorschlag(antwort) {
  try {
    const wert = JSON.parse(JSON_OBJEKT.exec(antwort)?.[0] ?? "");
    return wert !== null && typeof wert === "object" ? wert : null;
  } catch {
    return null;
  }
}

export function umbauPhase(phase, auftrag, antwort) {
  const felder = vorschlag(antwort);
  if (felder === null) return null;
  const gewaehlt = Object.fromEntries(UMBAU_FELDER.map((feld) => [feld, felder[feld]]));
  const art = istTestbereich(gewaehlt.bereich) ? TESTUMBAU : "umbau";
  const umbau = { ...gewaehlt, id: `${auftrag.id}-umbau`, art, prueft: UMBAU_AUSWEG };
  const entwurf = typeof umbau.bereich === "string" ? { [umbau.bereich]: felder.entwurf } : {};
  return { ...phase, entwurf, auftraege: [umbau] };
}

function echtesVerhalten(antwort) {
  const zeile = String(antwort ?? "")
    .split("\n")
    .map((teil) => teil.trim())
    .find((teil) => teil.startsWith(ECHTES_VERHALTEN));
  return zeile?.slice(ECHTES_VERHALTEN.length).trim();
}

function planBefunde(plan, neu, root) {
  if (plan.exitCode !== 0) return [`Der Plan-Agent endete mit Exit ${plan.exitCode}.`];
  if (neu !== null) return phasenBefunde(neu, root);
  const verhalten = echtesVerhalten(plan.volleAntwort ?? plan.antwort);
  return [verhalten === undefined ? KEIN_VORSCHLAG : `Der Plan-Agent sieht echtes Verhalten: ${verhalten}`];
}

function ohneTestumbau(auftrag, alterTest, zaehler) {
  if (istUmbau(auftrag)) return "der Auftrag ist selbst ein Umbau";
  if (!alterTest.rot) return `die Testdatei ${alterTest.datei} ist mit der Änderung nicht rot`;
  return zaehler.vorbauten > 0 ? `der eine ${TESTUMBAU} dieses Auftrags ist schon gelaufen` : null;
}

function vorbauBefund(plan, datei) {
  if (plan.befunde.length > 0) return plan.befunde.join("; ");
  const { art, abnahme } = plan.kontext.auftrag;
  return art === TESTUMBAU && abnahme === datei ? null : `kein ${TESTUMBAU} mit abnahme ${datei}`;
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
    this.roteRunden = [];
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
      const ergebnis = this.starteRunde({ ...this.kontext, runde, vorgeschichte: this.vorgeschichte(), vorigeRunden: this.roteRunden });
      if (ergebnis.ergebnis === GRUEN) return GRUEN;
      if (ergebnis.entscheidung) return this.entscheidung(ergebnis, ergebnis.entscheidung);
      if (ergebnis.alterTest) {
        const vorlauf = this.vorbauUmbauen(ergebnis);
        if (vorlauf !== GRUEN) return vorlauf;
        continue;
      }
      if (ergebnis.ausstieg) return this.ausgestiegen(ergebnis);
      if (ergebnis.voraussetzung) {
        const vorlauf = this.voraussetzungFehlt(ergebnis);
        if (vorlauf !== GRUEN) return vorlauf;
        continue;
      }
      this.fehler.push(fehlerausgabe(ergebnis));
      this.roteRunden = [...this.roteRunden, roteRunde(ergebnis)];
      if (this.fehler.length === MAX_RUNDEN) return this.zurueckAnDiePlanung(ergebnis, this.gestoppt());
      verwerfe(ergebnis.basis, this.kontext.root);
    }
  }

  zuletztRot() {
    const letzte = this.roteRunden.at(-1);
    return letzte === undefined ? [] : idsDer(letzte);
  }

  voraussetzungFehlt(ergebnis) {
    const { zaehler, root } = this.kontext;
    verwerfe(ergebnis.basis, root);
    if (istUmbau(this.kontext.auftrag)) {
      return this.zurueckInDenEntwurf(ergebnis, `Umbau meldet fehlende Voraussetzung: ${ergebnis.voraussetzung}`);
    }
    zaehler.voraussetzungen += 1;
    if (zaehler.voraussetzungen > 1) {
      return this.zurueckInDenEntwurf(ergebnis, `Voraussetzung fehlt zum zweiten Mal: ${ergebnis.voraussetzung}`);
    }
    const plan = this.planeUmbau(voraussetzungsAnlass(ergebnis.voraussetzung));
    if (plan.befunde.length > 0) {
      return this.zurueckInDenEntwurf(ergebnis, `Kein gültiger Umbau-Auftrag: ${plan.befunde.join("; ")}`, zweckBlock(MELDUNG.UMBAU_PLAN));
    }
    return new this.constructor({ ...this.kontext, ...plan.kontext, aufraeumen: ergebnis.voraussetzung.startsWith("Altfunktionen aufräumen:") }, this.starteRunde).fuehreAus();
  }

  vorbauUmbauen(ergebnis) {
    const { auftrag, zaehler, root } = this.kontext;
    const { alterTest } = ergebnis;
    const ohne = ohneTestumbau(auftrag, alterTest, zaehler);
    if (ohne !== null) return this.legeAltenTestAntonioVor(ergebnis, `Kein ${TESTUMBAU} vorweg: ${ohne}.`);
    zaehler.vorbauten += 1;
    verwerfe(ergebnis.basis, root);
    const plan = this.planeUmbau(vorbauAnlass(alterTest));
    const abgelehnt = vorbauBefund(plan, alterTest.datei);
    if (abgelehnt !== null) return this.legeAltenTestAntonioVor(ergebnis, `Kein ${TESTUMBAU} vorweg: ${abgelehnt}. Der Plan steht im Beleg ${auftrag.id}-plan.`);
    const umbau = plan.kontext.auftrag;
    const vorlauf = new VorbauRunden({ ...this.kontext, ...plan.kontext }, this.starteRunde).fuehreAus();
    if (vorlauf !== GRUEN) return this.legeAltenTestAntonioVor(ergebnis, `Der ${TESTUMBAU} ${umbau.id} vorweg ist gescheitert (${vorlauf}); sein Beleg heißt ${umbau.id}.`);
    if (nenntAltenTest(alterTest, testTitel(readFileSync(join(root, alterTest.datei), "utf8"))) === null) {
      return this.legeAltenTestAntonioVor(ergebnis, `Der ${TESTUMBAU} ${umbau.id} hat den Fall ${alterTest.test} entfernt oder umbenannt; er ist verworfen.`);
    }
    if (!zusicherungenGleich(git(["show", `${ergebnis.basis}:${alterTest.datei}`], { cwd: root }), readFileSync(join(root, alterTest.datei), "utf8"))) {
      return this.legeAltenTestAntonioVor(ergebnis, `Der ${TESTUMBAU} ${umbau.id} ändert Fälle oder Zusicherungen in ${alterTest.datei}; er ist verworfen.`);
    }
    return GRUEN;
  }

  planeUmbau(anlass) {
    const { phase, auftrag, root } = this.kontext;
    const plan = frage({ rolle: "plan", phase, auftrag, root }, planPrompt(phase, auftrag, anlass), { vollstaendig: true });
    const neu = umbauPhase(phase, auftrag, plan.volleAntwort ?? plan.antwort);
    const umbau = neu?.auftraege[0];
    const befunde = planBefunde(plan, neu, root);
    schreibeBeleg(root, {
      phase: phase.phase,
      auftrag: `${auftrag.id}-plan`,
      ergebnis: befunde.length === 0 ? GRUEN : ROT,
      grund: anlass.grund,
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

  gestoppt() {
    const { phase, auftrag } = this.kontext;
    const kopf = `Auftrag ${auftrag.id} der Phase ${phase.phase} ist nach ${MAX_RUNDEN} roten Runden gestoppt.`;
    return { kopf, anlass: `Der Auftrag ist nach ${MAX_RUNDEN} roten Runden gestoppt.`, verlauf: this.fehler, zweck: zweckBlock(MELDUNG.STOPP) };
  }

  zurueckInDenEntwurf(ergebnis, grund, zweck = []) {
    const text = `Zurück in die Entwurfsprüfung: ${grund}`;
    schreibeBeleg(this.kontext.root, { ...ergebnis, ergebnis: ENTWURFSPRUEFUNG, grund: text, ...(zweck.length > 0 ? { zweck } : {}) });
    console.log([`Auftrag ${ergebnis.auftrag}: ${ENTWURFSPRUEFUNG} (${text})`, ...zweck].join("\n"));
    return ENTWURFSPRUEFUNG;
  }

  ausgestiegen(ergebnis) {
    verwerfe(ergebnis.basis, this.kontext.root);
    const { phase, auftrag } = this.kontext;
    const zeile = `Auftrag passt nicht: ${ergebnis.ausstieg}`;
    const unklar = zweckUnklar(ergebnis.ausstieg);
    const kopf = `Der Agent ist aus dem Auftrag ${auftrag.id} der Phase ${phase.phase} ausgestiegen.\n\n${zeile}\n${auswegBei(unklar === null ? this.zuletztRot() : [unklar])}`;
    const hinweise = hinweiseDesBaus(ergebnis.agenten);
    const gestoppt = { kopf, anlass: `Der Agent ist ausgestiegen: ${zeile}`, verlauf: [...this.fehler, zeile], hinweise };
    if (unklar !== null) return this.entscheidung(ergebnis, gestoppt);
    return this.zurueckAnDiePlanung(ergebnis, gestoppt);
  }

  legeAltenTestAntonioVor(ergebnis, vorbau) {
    verwerfe(ergebnis.basis, this.kontext.root);
    const { phase, auftrag } = this.kontext;
    const { zeile, datei, test, rot } = ergebnis.alterTest;
    const kopf = [
      `Der Bau-Agent hat den Auftrag ${auftrag.id} der Phase ${phase.phase} angehalten: Ein alter Test hält das Verhalten fest, das der Auftrag ändert.`,
      "",
      zeile,
      auswegBei([PRUEFUNG.BETROFFENE_TESTS]),
      "",
      `Die Testdatei ${datei} ist mit der Änderung des Agenten rot: ${rot ? "ja" : "nein"}. Den Testnamen gibt es in der Datei; ob genau dieser Fall rot ist, prüft das Skript nicht.`,
      `Für eine Freigabe: Label verhalten-geaendert am Issue mit ${datei}:${test}. Der Diff des Agenten steht im Beleg ${BELEGE}/${phase.phase}/${auftrag.id}.json, Feld alterTest.diff.`,
      vorbau,
    ].join("\n");
    const hinweise = hinweiseDesBaus(ergebnis.agenten);
    return this.entscheidung(ergebnis, { kopf, anlass: `Der Bau-Agent meldet: ${zeile}`, verlauf: [...this.fehler, zeile], hinweise });
  }

  zurueckAnDiePlanung(ergebnis, gestoppt) {
    if (!planbar(this.kontext)) return this.entscheidung(ergebnis, gestoppt);
    verwerfe(ergebnis.basis, this.kontext.root);
    const neuschnitt = schneideNeu(this.kontext, gestoppt);
    return neuschnitt.neu ? NEU_GESCHNITTEN : this.entscheidung(ergebnis, neuschnitt.gestoppt);
  }

  notiz(gestoppt) {
    if (gestoppt.notiz !== undefined) return { text: gestoppt.notiz, sitzungen: gestoppt.sitzungen };
    const { phase, auftrag, root } = this.kontext;
    const lauf = frage({ rolle: "notiz", phase, auftrag, root }, notizPrompt(phase, auftrag, gestoppt));
    return { text: notizAuszug(entnimmVolleAntwort(lauf), lauf.sitzung), sitzungen: lauf.sitzungen };
  }

  entscheidung(ergebnis, gestoppt) {
    const { phase, auftrag, root } = this.kontext;
    const notiz = this.notiz(gestoppt);
    const hinweise = hinweiseFuerNotiz(ergebnis.agenten, entnimmVolleAntwort);
    const notizText = notiz.text.trim() || gestoppt.verlauf.join("\n\n");
    const text = ["## Entscheidung nötig", "", gestoppt.kopf, "", notizText, "", ...hinweise, ...(hinweise.length > 0 ? [""] : [])].join("\n");
    const veroeffentlicht = veroeffentliche(phase.issue, text, root);
    schreibeBeleg(root, { ...ergebnis, runden: this.fehler, entscheidung: { text, agenten: notiz.sitzungen, ...veroeffentlicht } });
    console.log(`Auftrag ${auftrag.id}: Entscheidung nötig. ${veroeffentlicht.hinweis}`);
    return ROT;
  }
}

class VorbauRunden extends Runden {
  entscheidung(ergebnis, gestoppt) {
    schreibeBeleg(this.kontext.root, { ...ergebnis, runden: this.fehler, grund: gestoppt.anlass });
    return ROT;
  }
}

export function fuehreRundenAus(kontext, starteRunde) {
  return new Runden({ ...kontext, zaehler: { voraussetzungen: 0, vorbauten: 0 } }, starteRunde).fuehreAus();
}
