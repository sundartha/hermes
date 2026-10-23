import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bauPrompt } from "../../tools/auftrag/agenten.mjs";
import { designPfad } from "../../tools/auftrag/annahmen.mjs";
import { AUFTRAG, EXIT_GRUEN, jePruefer, phaseDatei, plane } from "./planung-plane-probe.js";
import { ENTWURF_HINWEIS, GRUEN_PRUEFLISTE, HINWEIS, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";

const EIGENE = "a1 speichert den Code nur gehasht, weil design.md es so festlegt";
const FREMDE = "a3 liest den Status nur einmal je Anruf, weil der Anruf sonst wartet";
const PLANWEITE = "alle Aufträge bleiben ohne neue Abhängigkeit, weil die Owner-Liste leer ist";
const FALLE_BEISPIEL = "Heute freigeschaltete Konten würden mit dem Wegfall der Liste sofort den Hinweis für Fremde hören";
const ANNAHMEN = [{ auftrag: "a1", text: EIGENE }, { auftrag: "a3", text: FREMDE }, { text: PLANWEITE }];

function entwurfNachricht(lauf, bereich) {
  return aufrufe(lauf, "entwurf", "## Entwurf").find(({ eingabe }) => eingabe.includes(`### Bereich\n\n${bereich}\n`)).eingabe;
}

function phaseVon(lauf) {
  return JSON.parse(readFileSync(phaseDatei(lauf), "utf8"));
}

function bauPromptFuer(lauf, id) {
  const phase = phaseVon(lauf);
  const auftrag = phase.auftraege.find((eintrag) => eintrag.id === id);
  return bauPrompt({ phase, auftrag, root: lauf.wurzel, design: designPfad(phase) }, "Ausgabe.");
}

test("entwurf-vorgaben: Entwurf-Nachricht, phase.json und Bau-Prompt tragen die Annahmen der eigenen Aufträge und die planweiten, nicht die eines Auftrags in einem fremden Bereich", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Zuschnitt": [alsJson({ schnitt: schnittliste({ annahmen: ANNAHMEN }) })] });
  exit(lauf, EXIT_GRUEN);
  const nachricht = entwurfNachricht(lauf, ROUTE);
  assert.ok(nachricht.includes(EIGENE) && nachricht.includes(PLANWEITE), nachricht);
  assert.equal(nachricht.includes(FREMDE), false);
  assert.ok(entwurfNachricht(lauf, HINWEIS).includes(FREMDE));
  const entwurf = phaseVon(lauf).entwurf[ROUTE];
  assert.ok(entwurf.includes(`Annahme a1: ${EIGENE}`) && entwurf.includes(`Annahme der Planung: ${PLANWEITE}`), entwurf);
  assert.equal(entwurf.includes(FREMDE), false);
  const prompt = bauPromptFuer(lauf, "a1");
  assert.ok(prompt.includes(EIGENE), prompt);
  assert.equal(prompt.includes(FREMDE), false);
});

test("entwurf-vorgaben: Entwurf-Nachricht und Bau-Prompt enthalten Fallen und Nicht-Ziele des Pitches wörtlich", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);
  exit(lauf, EXIT_GRUEN);
  const pitch = readFileSync(join(lauf.wurzel, ORDNER, "pitch.md"), "utf8");
  const nichtZiel = pitch.split("\n").find((zeile) => zeile.startsWith("- Nicht Teil dieser Änderung"));
  for (const text of [entwurfNachricht(lauf, ROUTE), bauPromptFuer(lauf, "a1")]) {
    assert.ok(text.includes(FALLE_BEISPIEL), text);
    assert.ok(text.includes(nichtZiel), text);
  }
});

const UMBAU_FALLE = "- Die Prüfung könnte beim Herausziehen ihre Reihenfolge ändern: Sie bleibt die erste Zeile der Funktion.";
const UMBAU_NICHT_ZIEL = "- Nicht Teil dieser Änderung: eine zweite Prüfung, weil es heute nur eine gibt.";
const UMBAU_ANNAHME = "a0 zieht die Prüfung ohne Platzhalter heraus, weil der Pitch das in Fallen entscheidet";
const UMBAU_PITCH = [
  "# P-001 Umbau",
  "",
  "Planung freigegeben: 15000000 Token",
  "",
  "## Absicht",
  "Die Prüfung soll in eine eigene Funktion wandern, ohne dass sich nach außen etwas ändert. Nicht gewollt ist ein neues Verhalten nebenbei. Im Zweifel bleibt der Code, wie er ist.",
  "",
  "## Fallen",
  UMBAU_FALLE,
  "",
  "## Anforderungen",
  "",
  "keine neuen, weil sich nach außen nichts zeigt; das Prüfbare steht unter „Bleibt unverändert“",
  "",
  "## Bleibt unverändert",
  "",
  "keins, weil die bestehenden Tests das Verhalten unverändert prüfen",
  "",
  "## Nicht-Ziele",
  UMBAU_NICHT_ZIEL,
  "",
].join("\n");
const OHNE_ANGRIFFSWEGE = ["# P-001 Umbau: Sicherheitsprüfung", "", "## 2. Angriffswege", "", "keine Angriffswege gefunden", "", "## 3. Lückenprüfung", ""].join("\n");

test("entwurf-vorgaben: beim Umbau-Weg ohne Nummern bekommen Entwurf-Nachricht, phase.json und Bau-Prompt Annahmen, Fallen und Nicht-Ziele", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  writeFileSync(join(wurzel, ORDNER, "pitch.md"), UMBAU_PITCH);
  writeFileSync(join(wurzel, ORDNER, "sicherheit.md"), OHNE_ANGRIFFSWEGE);
  const [umbau] = schnittliste().auftraege;
  const schnitt = { annahmen: [{ auftrag: umbau.id, text: UMBAU_ANNAHME }], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege: [umbau] };
  const antworten = {
    "planer|## Zuschnitt": [alsJson({ schnitt })],
    "pruefer-planung|## Prüfung": jePruefer(GRUEN_PRUEFLISTE),
    "pruefer-planung|## Nachprüfung": [GRUEN_PRUEFLISTE],
    [`entwurf|## Entwurf|${HINWEIS}`]: [ENTWURF_HINWEIS],
  };
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: antworten, argumente: ["plane", ORDNER] });
  exit(lauf, EXIT_GRUEN);
  const nachricht = entwurfNachricht(lauf, HINWEIS);
  for (const text of [UMBAU_ANNAHME, UMBAU_FALLE, UMBAU_NICHT_ZIEL]) assert.ok(nachricht.includes(text), nachricht);
  assert.ok(phaseVon(lauf).entwurf[HINWEIS].includes(`Annahme ${umbau.id}: ${UMBAU_ANNAHME}`));
  const prompt = bauPromptFuer(lauf, umbau.id);
  for (const text of [UMBAU_ANNAHME, UMBAU_FALLE, UMBAU_NICHT_ZIEL]) assert.ok(prompt.includes(text), prompt);
});
