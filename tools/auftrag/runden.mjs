import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { testPrompt } from "./agenten.mjs";
import { BELEGE, GRUEN, ROT, belegVerzeichnis, hinweiseDesBaus, hinweiseFuerNotiz, notizAuszug, schreibeBeleg } from "./bericht.mjs";
import { auswegBei, nenntAltenTest, zweckUnklar } from "./ausgang.mjs";
import { frage } from "./einsatz.mjs";
import { TESTUMBAU, UMBAU_AUSWEG, istTestbereich, istUmbau, istVertraulich, phasenBefunde } from "./format.mjs";
import { git, hartZuruecksetzen } from "./git.mjs";
import { kostenDesAuftrags } from "./kosten.mjs";
import { NEU_GESCHNITTEN, planbar, schneideNeu } from "./neuschnitt.mjs";
import { issueBefunde } from "./phase.mjs";
import { beleg, fuehreAus } from "./pruefungen.mjs";
import { idsDer, pflichtDer, rotePruefungen, roteRunde, zweckIdsDer } from "./rote-pruefungen.mjs";
import { testTitel, zusicherungenGleich } from "./testtitel.mjs";
import { GRUND, MELDUNG, PRUEFUNG, absatzZuordnung, hatAusweg, zweckBlock } from "./zweck.mjs";
import { listHint } from "../testschutz/freigabe.mjs";

export const ENTWURFSPRUEFUNG = "entwurfsprüfung";
const MAX_RUNDEN = 2;
const MAX_WIEDERHOLUNGEN = 1;
const WERKZEUGABBRUCH = new Set([GRUND.MUTATION_ABBRUCH, GRUND.AGENT_EXIT]);
const FORMPRUEFUNGEN = new Set([PRUEFUNG.GRENZEN_BAU, PRUEFUNG.GRENZEN_TEST, PRUEFUNG.IMPORTENDUNGEN, PRUEFUNG.ABHAENGIGKEITEN, PRUEFUNG.LINT, PRUEFUNG.LINT_NEUE_FUNKTIONEN, PRUEFUNG.PIN]);
const FORMGRUENDE = new Set([GRUND.ZWECK_ABSATZ]);
const LABEL = "entscheidung";
const JSON_BLOCK = /```json[^\S\n]*\n((?:(?!```)[\s\S])*)```\s*$/;
const UMBAU_FELDER = ["ziel", "bereich", "erwarteteDateien", "abnahme"];
const CODEBLOCK = "```";
const KEIN_VORSCHLAG = "Der Plan-Agent lieferte kein lesbares JSON-Objekt in einem abschließenden ```json-Block.";
const ECHTES_VERHALTEN = "Verhalten:";
const MEHRDEUTIG = "Die Antwort des Plan-Agenten ist mehrdeutig: Sie hat eine Zeile „Verhalten:“ und einen abschließenden ```json-Block; das Skript liest daraus keinen Umbau.";
const AUSWEG_SCHLUSS =
  "Hältst du eine dieser Prüfungen hier für falsch, nimm den Ausweg aus ihrem Block statt einer Umgehung. Ein Ausstieg zählt nicht als rote Runde, aber sein Grund geht wörtlich an den Planer oder an Antonio und wird dort geprüft. „Voraussetzung fehlt“ und „Alter Test hält altes Verhalten fest“ liest das Skript nur beim Bau-Agenten.";

function abschnitt(titel, zeilen) {
  return ["", `## ${titel}`, "", ...zeilen, ""].join("\n");
}

function befundAbschnitt(abnahme, { zeile, test }) {
  return abschnitt("Befund des Bau-Agenten zum Abnahmetest", [
    `Eine Runde ist verworfen; sie zählt nicht als rote Runde. Der Bau-Agent behauptet zum Abnahmetest ${abnahme}: ${zeile}`,
    "",
    "Für den Test-Agenten: Prüf die genannte Stelle. Stimmt sie, schreib den Abnahmetest neu und passe nur die Testdaten an. Jedes Szenario bleibt mit Gegeben, Wenn und Dann, und jeder Fall des verworfenen Tests läuft mit demselben Namen wieder, nicht als todo oder skip; fehlt einer, ist die Runde rot. Stimmt sie nicht, steig mit „Auftrag passt nicht: <Grund>“ aus.",
    "",
    "Das ist der verworfene Abnahmetest:",
    "",
    CODEBLOCK,
    test,
    CODEBLOCK,
  ]);
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

function nurAbgebrochen({ roteIds = [] }) {
  return roteIds.length > 0 && roteIds.every((id) => WERKZEUGABBRUCH.has(id));
}

function formRot({ schritte, ohneSchritt }) {
  return [...schritte.map(({ name }) => name), ...ohneSchritt.map(({ id }) => id)];
}

function nurFormRot(runde) {
  const rot = formRot(runde);
  return rot.length > 0 && rot.every((name) => FORMPRUEFUNGEN.has(name) || FORMGRUENDE.has(name));
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
      `Hält der Test genau das Verhalten fest, das der Auftrag ändert, antworte ohne ${CODEBLOCK}json-Block nur mit einer Zeile, die mit „${ECHTES_VERHALTEN}“ beginnt und danach deinen Grund nennt; dann entscheidet Antonio.`,
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
      `Antworte mit einem abschließenden ${CODEBLOCK}json-Block, der ein JSON-Objekt mit den Feldern ${UMBAU_FELDER.join(", ")} und entwurf enthält; nach dem Block steht nichts mehr.`,
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

function echtesVerhalten(antwort) {
  const zeile = String(antwort ?? "")
    .split("\n")
    .map((teil) => teil.trim())
    .find((teil) => teil.startsWith(ECHTES_VERHALTEN));
  return zeile?.slice(ECHTES_VERHALTEN.length).trim();
}

function jsonBlock(antwort) {
  return JSON_BLOCK.exec(String(antwort ?? ""))?.[1];
}

function vorschlag(antwort) {
  const block = jsonBlock(antwort);
  if (block === undefined || echtesVerhalten(antwort) !== undefined) return null;
  try {
    const wert = JSON.parse(block);
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

function planBefunde(plan, neu, root) {
  if (plan.exitCode !== 0) return [`Der Plan-Agent endete mit Exit ${plan.exitCode}.`];
  if (neu !== null) return phasenBefunde(neu, root);
  const verhalten = echtesVerhalten(plan.volleAntwort);
  if (verhalten === undefined) return [KEIN_VORSCHLAG];
  return [jsonBlock(plan.volleAntwort) === undefined ? `Der Plan-Agent sieht echtes Verhalten: ${verhalten}` : MEHRDEUTIG];
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

function veroeffentliche(phase, text, root) {
  if (istVertraulich(phase)) return { pruefungen: [], hinweis: "Die Phase ist vertraulich; die Notiz steht nur im Beleg." };
  const { issue } = phase;
  const ziel = String(issue);
  if (issueBefunde({ issue }).length > 0) {
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

function freigabeWeg(phase, auftrag, { datei, test }) {
  const diff = `Der Diff des Agenten steht im Beleg ${BELEGE}/${phase.phase}/${auftrag.id}.json, Feld alterTest.diff.`;
  if (istVertraulich(phase)) {
    return [`Die Phase ist vertraulich; lauf gibt hier keinen alten Test frei. Der Auftrag bleibt stehen, und der Stand geht als Text ins Advisory. ${diff}`];
  }
  return [
    `Für eine Freigabe: Label verhalten-geaendert am Issue mit ${datei}:${test}. ${diff}`,
    `So wirkt die Freigabe im nächsten lauf: je ein Listenpunkt \`${datei}\` (für lauf) und \`${test}\` (für die CI) ${listHint()}, hier Issue #${phase.issue}; das Label kommt nach der letzten Textänderung, eine spätere Textänderung hebt die Freigabe auf. Dann ändert nur der Test-Agent genau diese Datei, und jeder geänderte Fall muss gegen den alten Code rot sein.`,
  ];
}

class Runden {
  constructor(kontext, starteRunde) {
    this.kontext = kontext;
    this.starteRunde = starteRunde;
    this.fehler = [];
    this.roteRunden = [];
    this.abbrueche = [];
    this.befund = null;
  }

  vorgeschichte() {
    const befund = this.befund === null ? "" : befundAbschnitt(this.kontext.auftrag.abnahme, this.befund);
    if (this.fehler.length === 0) return befund;
    return befund + abschnitt("Fehlerausgabe der vorigen Runde", [
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
      const ergebnis = this.starteRunde({ ...this.kontext, runde, vorgeschichte: this.vorgeschichte(), vorigeRunden: this.roteRunden, befund: this.befund });
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
      const halt = this.rot(ergebnis);
      if (halt !== null) return halt;
    }
  }

  rot(ergebnis) {
    if (ergebnis.testbefund) return this.testNeuSchreiben(ergebnis);
    if (nurAbgebrochen(ergebnis)) {
      hartZuruecksetzen(ergebnis.basis, this.kontext.root);
      const imSchritt = ergebnis.roteIds.includes(GRUND.MUTATION_ABBRUCH) ? [`Runde ${ergebnis.runde}: Die Mutationsprüfung ist abgebrochen und lief auf demselben Stand noch einmal.`] : [];
      this.abbrueche.push(...imSchritt, `Runde ${ergebnis.runde}: ${ergebnis.grund}`);
      return this.abbrueche.length > MAX_WIEDERHOLUNGEN ? this.entscheidung(ergebnis, this.abgebrochen()) : null;
    }
    this.fehler.push(fehlerausgabe(ergebnis));
    this.roteRunden = [...this.roteRunden, roteRunde(ergebnis)];
    if (this.fehler.length === MAX_RUNDEN) return this.roteRunden.every(nurFormRot) ? this.entscheidung(ergebnis, this.nurFormGestoppt()) : this.zurueckAnDiePlanung(ergebnis, this.gestoppt());
    hartZuruecksetzen(ergebnis.basis, this.kontext.root);
    return null;
  }

  testNeuSchreiben(ergebnis) {
    const { zaehler, root } = this.kontext;
    if (zaehler.testbefunde > 0) return this.ausgestiegen({ ...ergebnis, ausstieg: ergebnis.testbefund.zeile });
    zaehler.testbefunde += 1;
    hartZuruecksetzen(ergebnis.basis, root);
    this.befund = ergebnis.testbefund;
    return null;
  }

  zuletztRot() {
    const letzte = this.roteRunden.at(-1);
    return letzte === undefined ? [] : idsDer(letzte);
  }

  voraussetzungFehlt(ergebnis) {
    const { zaehler, root } = this.kontext;
    hartZuruecksetzen(ergebnis.basis, root);
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
    hartZuruecksetzen(ergebnis.basis, root);
    const plan = this.planeUmbau(vorbauAnlass(alterTest));
    const abgelehnt = vorbauBefund(plan, alterTest.datei);
    if (abgelehnt !== null) return this.legeAltenTestAntonioVor(ergebnis, `Kein ${TESTUMBAU} vorweg: ${abgelehnt}. Der Plan steht im Beleg ${auftrag.id}-plan.`);
    const umbau = plan.kontext.auftrag;
    const vorlauf = new VorbauRunden({ ...this.kontext, ...plan.kontext, vorbau: alterTest.datei }, this.starteRunde).fuehreAus();
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
    const neu = umbauPhase(phase, auftrag, plan.volleAntwort);
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

  abgebrochen() {
    const { phase, auftrag } = this.kontext;
    const kopf = [`Auftrag ${auftrag.id} der Phase ${phase.phase} ist angehalten: Ein Werkzeug ist ${this.abbrueche.length}-mal abgebrochen, ohne etwas zu messen.`, "", ...this.abbrueche].join("\n");
    const anlass = `Ein Werkzeug ist ${this.abbrueche.length}-mal abgebrochen; das zählt nicht als rote Runde und geht nicht zurück an die Planung.`;
    return { kopf, anlass, verlauf: [...this.fehler, ...this.abbrueche], zweck: zweckBlock(MELDUNG.WERKZEUGABBRUCH) };
  }

  gestoppt() {
    const { phase, auftrag } = this.kontext;
    const kopf = `Auftrag ${auftrag.id} der Phase ${phase.phase} ist nach ${MAX_RUNDEN} roten Runden gestoppt.`;
    return { kopf, anlass: `Der Auftrag ist nach ${MAX_RUNDEN} roten Runden gestoppt.`, verlauf: this.fehler, zweck: zweckBlock(MELDUNG.STOPP) };
  }

  nurFormGestoppt() {
    const gestoppt = this.gestoppt();
    const namen = [...new Set(this.roteRunden.flatMap(formRot))];
    const satz = `Alle ${MAX_RUNDEN} roten Runden waren nur an Formprüfungen der Agenten rot (${namen.join(", ")}). Das belegt keinen Fehler im Zuschnitt; deshalb lief kein Neuschnitt.`;
    return { ...gestoppt, kopf: `${gestoppt.kopf}\n\n${satz}`, anlass: `${gestoppt.anlass} ${satz}` };
  }

  zurueckInDenEntwurf(ergebnis, grund, zweck = []) {
    const { phase, root } = this.kontext;
    const text = `Zurück in die Entwurfsprüfung: ${grund}`;
    const kommentar = [
      "## Zurück in die Entwurfsprüfung",
      `Auftrag ${ergebnis.auftrag} der Phase ${phase.phase} ist angehalten: ${grund}`,
      `Der Beleg steht in ${BELEGE}/${phase.phase}/${ergebnis.auftrag}.json.`,
      ...zweck,
    ].join("\n\n");
    const veroeffentlicht = veroeffentliche(phase, kommentar, root);
    schreibeBeleg(root, { ...ergebnis, ergebnis: ENTWURFSPRUEFUNG, grund: text, ...(zweck.length > 0 ? { zweck } : {}), notiz: { text: kommentar, ...veroeffentlicht } });
    console.log([`Auftrag ${ergebnis.auftrag}: ${ENTWURFSPRUEFUNG} (${text})`, ...zweck, veroeffentlicht.hinweis].join("\n"));
    return ENTWURFSPRUEFUNG;
  }

  ausgestiegen(ergebnis) {
    hartZuruecksetzen(ergebnis.basis, this.kontext.root);
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
    hartZuruecksetzen(ergebnis.basis, this.kontext.root);
    const { phase, auftrag } = this.kontext;
    const { zeile, datei, rot } = ergebnis.alterTest;
    const kopf = [
      `Der Bau-Agent hat den Auftrag ${auftrag.id} der Phase ${phase.phase} angehalten: Ein alter Test hält das Verhalten fest, das der Auftrag ändert.`,
      "",
      zeile,
      auswegBei([PRUEFUNG.BETROFFENE_TESTS]),
      "",
      `Die Testdatei ${datei} ist mit der Änderung des Agenten rot: ${rot ? "ja" : "nein"}. Den Testnamen gibt es in der Datei; ob genau dieser Fall rot ist, prüft das Skript nicht.`,
      ...freigabeWeg(phase, auftrag, ergebnis.alterTest),
      vorbau,
    ].join("\n");
    const hinweise = hinweiseDesBaus(ergebnis.agenten);
    return this.entscheidung(ergebnis, { kopf, anlass: `Der Bau-Agent meldet: ${zeile}`, verlauf: [...this.fehler, zeile], hinweise });
  }

  zurueckAnDiePlanung(ergebnis, gestoppt) {
    if (!planbar(this.kontext)) return this.entscheidung(ergebnis, gestoppt);
    hartZuruecksetzen(ergebnis.basis, this.kontext.root);
    const neuschnitt = schneideNeu(this.kontext, gestoppt);
    return neuschnitt.neu ? NEU_GESCHNITTEN : this.entscheidung(ergebnis, neuschnitt.gestoppt);
  }

  notiz(gestoppt) {
    if (gestoppt.notiz !== undefined) return { text: gestoppt.notiz, sitzungen: gestoppt.sitzungen };
    const { phase, auftrag, root } = this.kontext;
    const lauf = frage({ rolle: "notiz", phase, auftrag, root }, notizPrompt(phase, auftrag, gestoppt));
    return { text: notizAuszug(lauf.volleAntwort, lauf.sitzung), sitzungen: lauf.sitzungen };
  }

  entscheidung(ergebnis, gestoppt) {
    const { phase, auftrag, root } = this.kontext;
    const notiz = this.notiz(gestoppt);
    const hinweise = hinweiseFuerNotiz(ergebnis.agenten);
    const notizText = notiz.text.trim() || gestoppt.verlauf.join("\n\n");
    const text = ["## Entscheidung nötig", "", gestoppt.kopf, "", notizText, "", ...hinweise, ...(hinweise.length > 0 ? [""] : [])].join("\n");
    const veroeffentlicht = veroeffentliche(phase, text, root);
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
  return new Runden({ ...kontext, zaehler: { voraussetzungen: 0, vorbauten: 0, testbefunde: 0 } }, starteRunde).fuehreAus();
}
