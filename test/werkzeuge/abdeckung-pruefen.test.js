import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const PRUEFER = join(REPO_ROOT, "tools/abdeckung-pruefen.mjs");
const ORDNER = "P-001-probe";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";

const S1 = "Gegeben ein Kunde ohne Nummer\nWenn er über `POST /api/x` die Nummer \"+4915100000001\" hinterlegt\nDann enthält die Antwort den Status `unbestaetigt`";
const S2 = "Gegeben ein Kunde hat 5 falsche Codes gesendet\nWenn er über `POST /api/x/confirm` den richtigen Code sendet\nDann enthält die Antwort den Fehler `zu_viele_versuche`\nUnd die Antwort enthält den Status `unbestaetigt`";
const B1 = "Gegeben ein Kunde mit bestätigter Nummer\nWenn sein Agent mit `place_call` eine fremde Nummer anruft\nDann beginnt das Transkript mit dem Hinweis";
const T1 = "S2 im Pitch, dazu nach der Gegenprüfung (G1):\nGegeben ein Kunde hat 5 falsche Codes für verschiedene Nummern gesendet\nWenn er über `POST /api/x/confirm` den richtigen Code sendet\nDann enthält die Antwort den Fehler `zu_viele_versuche`";
const T2 = "Gegeben ein Kunde hat 3 Codes angefordert\nWenn er über `POST /api/x` eine weitere Nummer hinterlegt\nDann enthält die Antwort den Fehler `zu_viele_codes`";

const PITCH = [
  "# P-001 Probe",
  "",
  "## Anforderungen",
  "",
  "### Regel R1: Eine Nummer gilt erst nach dem Code als bestätigt.",
  "",
  "#### Szenario S1: Code wird verschickt",
  S1,
  "",
  "#### Szenario S2: Zu viele falsche Codes",
  S2,
  "",
  "## Bleibt unverändert",
  "",
  "### Szenario B1: Anruf an eine fremde Nummer",
  B1,
  "",
  "## Nicht-Ziele",
  "",
].join("\n");

function angriffsweg(nummer, ausgang, szenario) {
  const kopf = [`### ${nummer}: Ein Kunde erreicht etwas`, "Wer: angemeldeter Kunde", "Weg: über die Route", "Schaden: SMS-Kosten", `Ausgang: ${ausgang}, weil es sonst passiert`];
  return [...kopf, ...(szenario === undefined ? [] : szenario.split("\n")), ""].join("\n");
}

function sicherheit(...wege) {
  return ["# P-001 Probe: Sicherheitsprüfung", "", "## 1. Woran arbeiten wir", "", "## 2. Angriffswege", ...wege, "## 3. Lückenprüfung", "", "## 6. Gegenprüfung", ""].join("\n");
}

const SICHERHEIT = sicherheit(
  angriffsweg("T1", "verhindern", `Szenario: ${T1}`),
  angriffsweg("T2", "verhindern", `Szenario (nur bei „verhindern“):\n${T2}`),
  angriffsweg("T3", "hinnehmen (Vorschlag)"),
);

function funktion(id, texte) {
  return {
    id,
    art: "funktion",
    ziel: "Antworte auf POST /api/x",
    bereich: "src/x.js",
    erwarteteDateien: ["src/x.js"],
    vorbild: "src/x.js",
    abnahme: `test/${id}.test.js`,
    erwarteterFehler: "Expected values to be strictly equal",
    wasDarfNiePassieren: [],
    prueft: Object.keys(texte),
    szenarien: texte,
  };
}

const UMBAU = { id: "a0", art: "umbau", ziel: "Ziehe die Prüfung heraus", prueft: AUSWEG };

function vollstaendig() {
  return [UMBAU, funktion("a1", { S1, B1 }), funktion("a2", { S2, T1 }), funktion("a3", { T2 })];
}

function pruefe(context, { auftraege = vollstaendig(), pitchtext = PITCH, sicherheitstext = SICHERHEIT, phase = { phase: ORDNER, auftraege } } = {}) {
  const wurzel = probeDirectory(context, {
    [`${ORDNER}/pitch.md`]: pitchtext,
    [`${ORDNER}/sicherheit.md`]: sicherheitstext,
    [`${ORDNER}/phase.json`]: typeof phase === "string" ? phase : JSON.stringify(phase),
  });
  return runIn(wurzel, process.execPath, [PRUEFER, ORDNER]);
}

test("abdeckung-pruefen: jede Nummer gehört genau einem Auftrag, ein Umbau zählt nicht mit", (context) => {
  const lauf = pruefe(context);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.equal(lauf.stderr, "");
  assert.match(lauf.stdout, /^grün: 5 Nummern in P-001-probe gehören je genau einem Auftrag\.$/m);
  const mitLeerem = pruefe(context, { auftraege: [null, ...vollstaendig()] });
  assert.equal(mitLeerem.status, EXIT_GRUEN, mitLeerem.stderr);
  assert.equal(mitLeerem.stdout, lauf.stdout);
});

test("abdeckung-pruefen: eine Bedrohung mit Ausgang verhindern ohne Auftrag ist rot", (context) => {
  const lauf = pruefe(context, { auftraege: [funktion("a1", { S1, B1 }), funktion("a2", { S2, T1 })] });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, "T2 gehört keinem Auftrag\n");
  assert.match(lauf.stdout, /^rot: 1 Befunde in P-001-probe\.$/m);
});

test("abdeckung-pruefen: ein Szenario in zwei Aufträgen ist rot", (context) => {
  const lauf = pruefe(context, { auftraege: [funktion("a1", { S1, B1 }), funktion("a2", { S1, S2, T1 }), funktion("a3", { T2 })] });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, "S1 gehört mehreren Aufträgen: a1, a2\n");
});

test("abdeckung-pruefen: ein Szenario aus dem Pitch ohne Auftrag ist rot, auch ein B-n", (context) => {
  const lauf = pruefe(context, { auftraege: [funktion("a1", { S1 }), funktion("a2", { S2, T1, T2 })] });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, "B1 gehört keinem Auftrag\n");
});

test("abdeckung-pruefen: eine Bedrohung mit anderem Ausgang braucht keinen Auftrag und darf keinem gehören", (context) => {
  const ohne = pruefe(context);
  assert.equal(ohne.status, EXIT_GRUEN, ohne.stderr);
  const mit = pruefe(context, { auftraege: [...vollstaendig(), funktion("a4", { T3: "Gegeben\nWenn\nDann" })] });
  assert.equal(mit.status, EXIT_ROT);
  assert.equal(mit.stderr, "a4: T3 hat in sicherheit.md nicht den Ausgang „verhindern“ und gehört keinem Auftrag\n");
});

test("abdeckung-pruefen: eine Nummer, die es in den Dokumenten nicht gibt, ist rot", (context) => {
  const lauf = pruefe(context, { auftraege: [...vollstaendig(), funktion("a4", { S9: S1 })] });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, "a4: S9 steht weder in pitch.md noch unter „2. Angriffswege“ in sicherheit.md\n");
});

test("abdeckung-pruefen: nur Angriffswege aus Abschnitt 2 zählen", (context) => {
  const spaeter = SICHERHEIT.replace("## 6. Gegenprüfung", `## 6. Gegenprüfung\n${angriffsweg("T4", "verhindern", `Szenario: ${T2}`)}`);
  const lauf = pruefe(context, { sicherheitstext: spaeter });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  const ohneAbschnitt = pruefe(context, { sicherheitstext: SICHERHEIT.replace("## 2. Angriffswege", "## 2. Wege") });
  assert.equal(ohneAbschnitt.status, EXIT_ROT);
  assert.match(ohneAbschnitt.stderr, /^a2: T1 steht weder in pitch\.md noch/m);
  assert.match(ohneAbschnitt.stderr, /^a3: T2 steht weder in pitch\.md noch/m);
  assert.match(ohneAbschnitt.stderr, /^Abdeckung nicht bestimmbar: sicherheit\.md hat keinen Abschnitt „## 2\. Angriffswege“$/m);
});

test("abdeckung-pruefen: erkennt sie die Nummern nicht sicher, ist die Abdeckung nicht bestimmbar und rot", (context) => {
  const ohneSzenario = pruefe(context, { pitchtext: PITCH.replaceAll("Szenario S", "Fall S") });
  assert.equal(ohneSzenario.status, EXIT_ROT);
  assert.match(ohneSzenario.stderr, /^Abdeckung nicht bestimmbar: pitch\.md hat kein Szenario „Szenario S<n>:“$/m);
  const ohneAusgang = pruefe(context, { sicherheitstext: SICHERHEIT.replace("Ausgang: hinnehmen (Vorschlag)", "Ausgang: offen") });
  assert.equal(ohneAusgang.status, EXIT_ROT);
  assert.equal(ohneAusgang.stderr, "Abdeckung nicht bestimmbar: T3 in sicherheit.md nennt keinen Ausgang verhindern, weglassen, hinnehmen oder übertragen\n");
  const leer = sicherheit("Noch nichts.", "");
  const ohneWege = pruefe(context, { sicherheitstext: leer, auftraege: [funktion("a1", { S1, B1 }), funktion("a2", { S2 })] });
  assert.equal(ohneWege.status, EXIT_ROT);
  assert.equal(ohneWege.stderr, "Abdeckung nicht bestimmbar: „2. Angriffswege“ in sicherheit.md nennt weder „### T<n>:“ noch „keine Angriffswege gefunden“\n");
  const keine = sicherheit("Keine Angriffswege gefunden, weil nichts Neues erreichbar ist.", "");
  const gruen = pruefe(context, { sicherheitstext: keine, auftraege: [funktion("a1", { S1, B1 }), funktion("a2", { S2 })] });
  assert.equal(gruen.status, EXIT_GRUEN, gruen.stderr);
});

test("abdeckung-pruefen: der Ausgang zählt auch fett und groß geschrieben", (context) => {
  const fett = SICHERHEIT.replace(/^Ausgang: verhindern, weil es sonst passiert\nSzenario \(/m, "**Ausgang:** Verhindern, weil es sonst passiert\nSzenario (");
  assert.notEqual(fett, SICHERHEIT);
  const ohneT2 = pruefe(context, { sicherheitstext: fett, auftraege: [funktion("a1", { S1, B1 }), funktion("a2", { S2, T1 })] });
  assert.equal(ohneT2.status, EXIT_ROT);
  assert.equal(ohneT2.stderr, "T2 gehört keinem Auftrag\n");
  assert.equal(pruefe(context, { sicherheitstext: fett }).status, EXIT_GRUEN);
});

test("abdeckung-pruefen: eine Nummer, die in einem Dokument doppelt steht, ist rot", (context) => {
  const pitch = PITCH.replace("#### Szenario S2:", "#### Szenario S1:");
  const imPitch = pruefe(context, { pitchtext: pitch, auftraege: [funktion("a1", { S1, B1 }), funktion("a2", { T1 }), funktion("a3", { T2 })] });
  assert.equal(imPitch.status, EXIT_ROT);
  assert.equal(imPitch.stderr, "Abdeckung nicht bestimmbar: S1 steht in pitch.md mehrfach\n");
  const zweimal = sicherheit(angriffsweg("T1", "verhindern", `Szenario: ${T1}`), angriffsweg("T1", "hinnehmen (Vorschlag)"), angriffsweg("T2", "verhindern", `Szenario (nur bei „verhindern“):\n${T2}`));
  const inSicherheit = pruefe(context, { sicherheitstext: zweimal });
  assert.equal(inSicherheit.status, EXIT_ROT);
  assert.equal(inSicherheit.stderr, "Abdeckung nicht bestimmbar: T1 steht in sicherheit.md mehrfach\n");
});

test("abdeckung-pruefen: der Szenariotext muss wörtlich übernommen sein, nur Leerraum darf abweichen", (context) => {
  const umbrochen = { S1: S1.replaceAll("\n", "\n  "), B1: `  ${B1.replaceAll(" ", "  ")}\n` };
  const leer = pruefe(context, { auftraege: [funktion("a1", umbrochen), funktion("a2", { S2, T1 }), funktion("a3", { T2 })] });
  assert.equal(leer.status, EXIT_GRUEN, leer.stderr);
  const geaendert = { S2, T1: T1.replace("5 falsche", "6 falsche") };
  const lauf = pruefe(context, { auftraege: [funktion("a1", { S1, B1 }), funktion("a2", geaendert), funktion("a3", { T2 })] });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, `a2: szenarien["T1"] ist nicht wörtlich der Text aus sicherheit.md: ${T1.replaceAll("\n", " ")}\n`);
  const ausPitch = pruefe(context, { auftraege: [funktion("a1", { S1: S1.slice(1), B1 }), funktion("a2", { S2, T1 }), funktion("a3", { T2 })] });
  assert.match(ausPitch.stderr, /^a1: szenarien\["S1"\] ist nicht wörtlich der Text aus pitch\.md: Gegeben ein Kunde ohne Nummer Wenn/m);
});

test("abdeckung-pruefen: ein fehlender Szenariotext im Auftrag ist rot, außer die Bedrohung hat selbst keine Szenariozeile", (context) => {
  const ohneTexte = pruefe(context, { auftraege: [{ ...funktion("a1", { S1, B1 }), szenarien: undefined }, funktion("a2", { S2, T1 }), funktion("a3", { T2 })] });
  assert.equal(ohneTexte.status, EXIT_ROT);
  assert.match(ohneTexte.stderr, /^a1: szenarien\["S1"\] ist nicht wörtlich der Text aus pitch\.md: Gegeben ein Kunde ohne Nummer Wenn/m);
  assert.match(ohneTexte.stderr, /^a1: szenarien\["B1"\] ist nicht wörtlich der Text aus pitch\.md: Gegeben ein Kunde mit bestätigter Nummer Wenn/m);
  assert.match(ohneTexte.stdout, /^rot: 2 Befunde in P-001-probe\.$/m);
  const ohneSzenario = SICHERHEIT.replace("## 3. Lückenprüfung", `${angriffsweg("T4", "verhindern")}\n## 3. Lückenprüfung`);
  const lauf = pruefe(context, { sicherheitstext: ohneSzenario, auftraege: [...vollstaendig(), funktion("a4", { T4: null })] });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.match(lauf.stdout, /^grün: 6 Nummern in P-001-probe/m);
  const mitText = pruefe(context, { sicherheitstext: ohneSzenario, auftraege: [...vollstaendig(), funktion("a4", { T4: "Gegeben\nWenn\nDann" })] });
  assert.equal(mitText.stderr, "a4: szenarien[\"T4\"] ist nicht wörtlich der Text aus sicherheit.md: \n");
});

test("abdeckung-pruefen: Überschriften, Ausgang und Szenariozeile zählen nur am Zeilenanfang, Leerraum darin darf abweichen", (context) => {
  const text = "Gegeben ein Kunde mit Ticket #4\nDann enthält die Antwort `ok`";
  const weg = "Gegeben ein Kunde\nWenn er `POST /api/x` sendet";
  const pitchtext = ["# P-001 Probe", "", "## Anforderungen", "Die Vorlage nennt je Fall ## Szenario S7: Titel", "", "####  Szenario  S12 : Mit Leerraum", text, "  ", "Erläuterung, die nicht zum Szenario gehört.", ""].join("\n");
  const sicherheitstext = [
    "# P-001 Probe: Sicherheitsprüfung",
    "",
    "## 1. Woran arbeiten wir",
    "Die Wege stehen unten unter ##  2. Angriffswege",
    "## 2. Angriffswege (alte Fassung)",
    "##  2.  Angriffswege ",
    "Vorlage je Weg: ### T9: Titel",
    "###  T12 : Ein Kunde erreicht etwas",
    "Weg: wie im Szenario S12: über die Route aus Issue #3",
    "  Ausgang: verhindern, weil es sonst passiert",
    `Szenario: ${weg}`,
    "  ",
    "Anmerkung außerhalb des Szenarios",
    "###  T13: Ein Kunde erreicht anderes",
    "Weg: anders als beim Ausgang: verhindern",
    "Ausgang:hinnehmen",
    "## 3. Lückenprüfung",
    "",
  ].join("\n");
  const lauf = pruefe(context, { pitchtext, sicherheitstext, auftraege: [funktion("a1", { S12: text, T12: weg })] });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.match(lauf.stdout, /^grün: 2 Nummern in P-001-probe gehören je genau einem Auftrag\.$/m);
});

test("abdeckung-pruefen: die Kennung der Phase ist der Ordnername", (context) => {
  const lauf = pruefe(context, { phase: { phase: "E-001-probe", auftraege: vollstaendig() } });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, 'phase muss P-001-probe heißen wie der Ordner, nicht "E-001-probe"\n');
});

test("abdeckung-pruefen: eine unlesbare Phasendatei ist rot, ein falscher Aufruf endet mit 2", (context) => {
  const kaputt = pruefe(context, { phase: "{ kein json" });
  assert.equal(kaputt.status, EXIT_ROT);
  assert.match(kaputt.stderr, /^phase\.json ist nicht lesbar: /);
  const ohneOrdner = runIn(REPO_ROOT, process.execPath, [PRUEFER]);
  assert.equal(ohneOrdner.status, EXIT_AUFRUF);
  assert.match(ohneOrdner.stderr, /^Aufruf: node tools\/abdeckung-pruefen\.mjs /);
  const fehlt = runIn(REPO_ROOT, process.execPath, [PRUEFER, "plaene/P-999-gibt-es-nicht"]);
  assert.equal(fehlt.status, EXIT_AUFRUF);
  assert.match(fehlt.stderr, /^Im Ordner plaene\/P-999-gibt-es-nicht fehlt: pitch\.md, sicherheit\.md, phase\.json$/m);
});

const KEIN_OBJEKT = [
  ["null", "null"],
  ["0", "number"],
  ["1", "number"],
  ['""', "string"],
  ['"x"', "string"],
  ["true", "boolean"],
  ["false", "boolean"],
  ["[]", "array"],
  ["[1]", "array"],
];

test("abdeckung-pruefen: eine phase.json, die kein JSON-Objekt ist, ist rot mit der Meldung „nicht lesbar“ und ohne Absturz", (context) => {
  for (const [inhalt, gefunden] of KEIN_OBJEKT) {
    const lauf = pruefe(context, { phase: inhalt });
    assert.equal(lauf.status, EXIT_ROT, `${inhalt}: ${lauf.stderr}`);
    assert.equal(lauf.stderr, `phase.json ist nicht lesbar: erwartet ein JSON-Objekt, gefunden ${gefunden}\n`, inhalt);
    assert.match(lauf.stdout, /^rot: 1 Befunde in P-001-probe\.$/m, inhalt);
  }
});

const ABSICHT = "Ein Kunde soll seine eigene Nummer nur mit Code bestätigen können. Im Zweifel bleibt der Hinweis an.";

function mitAbsicht(absicht) {
  return PITCH.replace("## Anforderungen", `## Absicht\n${absicht}\n\n## Anforderungen`);
}

function phaseMitAbsicht(absicht = ABSICHT) {
  return { phase: ORDNER, absicht, auftraege: vollstaendig() };
}

test("abdeckung-pruefen: hat die Phase eine Absicht, ist ein Pitch ohne Abschnitt „Absicht“ oder mit leerer Absicht rot, eine alte Phase ohne Feld nicht", (context) => {
  const ohne = pruefe(context, { phase: phaseMitAbsicht() });
  assert.equal(ohne.status, EXIT_ROT);
  assert.match(ohne.stderr, /^pitch\.md hat keinen Abschnitt „## Absicht“$/m);
  const leer = pruefe(context, { pitchtext: mitAbsicht(""), phase: phaseMitAbsicht() });
  assert.equal(leer.status, EXIT_ROT);
  assert.match(leer.stderr, /^pitch\.md: Absicht ist leer; sie sagt in 2 bis 4 Sätzen, wofür/m);
  assert.equal(pruefe(context, { pitchtext: mitAbsicht(ABSICHT), phase: phaseMitAbsicht() }).status, EXIT_GRUEN);
  assert.equal(pruefe(context).status, EXIT_GRUEN);
});

test("abdeckung-pruefen: eine Absicht über 1000 Zeichen ist rot, genau 1000 Zeichen sind grün", (context) => {
  const ZEICHEN_HOECHSTENS = 1000;
  const zuLangeAbsicht = "a".repeat(ZEICHEN_HOECHSTENS + 1);
  const zuLang = pruefe(context, { pitchtext: mitAbsicht(zuLangeAbsicht), phase: phaseMitAbsicht(zuLangeAbsicht) });
  assert.equal(zuLang.status, EXIT_ROT);
  assert.match(zuLang.stderr, /^pitch\.md: Absicht hat 1001 Zeichen, höchstens 1000 \(2 bis 4 Sätze\)$/m);
  const genauGrenze = "a".repeat(ZEICHEN_HOECHSTENS);
  const genau = pruefe(context, { pitchtext: mitAbsicht(genauGrenze), phase: phaseMitAbsicht(genauGrenze) });
  assert.equal(genau.status, EXIT_GRUEN, genau.stderr);
});

test("abdeckung-pruefen: weicht die Absicht der Phase vom Pitch ab, auch nur gekürzt, ist sie rot", (context) => {
  const gekuerzt = pruefe(context, { pitchtext: mitAbsicht(ABSICHT), phase: phaseMitAbsicht(ABSICHT.split(". ")[0]) });
  assert.equal(gekuerzt.status, EXIT_ROT);
  assert.match(gekuerzt.stderr, /^phase\.json: absicht weicht vom Abschnitt „## Absicht“ in pitch\.md ab/m);
});
