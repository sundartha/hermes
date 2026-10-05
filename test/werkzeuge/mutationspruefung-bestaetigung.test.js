import assert from "node:assert/strict";
import { test } from "node:test";

import { bestaetige, bestaetigt, bilanz } from "../../tools/mutationspruefung/bestaetigung.mjs";

const ERSTE_ZEILE = 3;
const ZWEITE_ZEILE = 4;
const DRITTE_ZEILE = 5;
const SCHLUESSEL = "src/zahl.js:3:7 ConditionalExpression → true";
const ZEILEN = [ERSTE_ZEILE, ERSTE_ZEILE];
const MUTANT = { schluessel: SCHLUESSEL, zeilen: ZEILEN };
const ZWEITER = { schluessel: "src/zahl.js:4:7 ConditionalExpression → true", zeilen: [ZWEITE_ZEILE, ZWEITE_ZEILE] };
const DRITTER = { schluessel: "src/zahl.js:5:7 ConditionalExpression → true", zeilen: [DRITTE_ZEILE, DRITTE_ZEILE] };
const DATEI = "test/a.test.js";
const ANDERE = "test/b.test.js";
const NICHT_BESTAETIGT = "Hinweis: im Bestätigungslauf nicht bestätigt, Mutant zählt als überlebt";
const NUR_HAENGER = `Hinweis: nur durch Zeitablauf oder Absturz erkannt, in beiden Läufen; nicht bestätigt getötet: ${SCHLUESSEL}`;
const ABBRUECHE = ["Timeout", "RuntimeError", "CompileError"];
const GRUENE = ["Survived", "NoCoverage"];

function eintrag(status, toeter = [], mutant = MUTANT) {
  return { ...mutant, status, art: "ConditionalExpression", toeter };
}

function nachlaeufe(...antworten) {
  const aufrufe = [];
  const nachlauf = async (auswahl) => {
    aufrufe.push(auswahl);
    return antworten[aufrufe.length - 1];
  };
  return { aufrufe, nachlauf };
}

async function bestaetigung(erster, ...antworten) {
  const { aufrufe, nachlauf } = nachlaeufe(...antworten);
  const [ergebnis] = await bestaetige([erster], nachlauf);
  return { ergebnis, aufrufe };
}

function nichtBestaetigt(laeufe) {
  return `${NICHT_BESTAETIGT} (${laeufe}): ${SCHLUESSEL}`;
}

test("ein roter Test, der im Bestätigungslauf nur mit seiner Datei wieder rot wird, ist bestätigt getötet", async () => {
  const erster = eintrag("Killed", [DATEI]);
  const { ergebnis, aufrufe } = await bestaetigung(erster, [eintrag("Killed", [DATEI])]);
  assert.deepEqual(aufrufe, [{ zeilen: [ZEILEN], tests: [DATEI] }]);
  assert.equal(bestaetigt(ergebnis), true);
  assert.equal(ergebnis.status, "Killed");
  assert.equal(ergebnis.hinweis, undefined);
  assert.equal(bilanz([ergebnis]), "1 bestätigt getötet, 0 nur durch Zeitablauf oder Absturz erkannt");
});

test("ein roter Test, den der Bestätigungslauf nicht in derselben Datei wiederholt, zählt als überlebt", async () => {
  const wiederholungen = [
    [[eintrag("Survived")], "Bestätigungslauf Survived"],
    [[eintrag("NoCoverage")], "Bestätigungslauf NoCoverage"],
    [[eintrag("Killed", [ANDERE])], `Bestätigungslauf Killed ${ANDERE}`],
    [[eintrag("Timeout")], "Bestätigungslauf Timeout"],
    [[eintrag("RuntimeError")], "Bestätigungslauf RuntimeError"],
    [[], "Bestätigungslauf ohne Ergebnis"],
  ];
  for (const [antwort, zweiter] of wiederholungen) {
    const { ergebnis } = await bestaetigung(eintrag("Killed", [DATEI]), antwort);
    assert.equal(ergebnis.status, "Survived", zweiter);
    assert.equal(bestaetigt(ergebnis), false, zweiter);
    assert.equal(ergebnis.hinweis, nichtBestaetigt(`erster Lauf Killed ${DATEI}, ${zweiter}`));
  }
});

test("ein Zeitablauf oder Absturz, der sich im Bestätigungslauf wiederholt, ist nur als Hänger erkannt, nicht bestätigt getötet", async () => {
  for (const erster of ABBRUECHE) {
    for (const zweiter of ABBRUECHE) {
      const { ergebnis, aufrufe } = await bestaetigung(eintrag(erster), [eintrag(zweiter)]);
      assert.deepEqual(aufrufe, [{ zeilen: [ZEILEN], tests: undefined }]);
      assert.equal(ergebnis.status, erster);
      assert.equal(bestaetigt(ergebnis), false);
      assert.equal(ergebnis.hinweis, NUR_HAENGER);
      assert.equal(bilanz([ergebnis]), "0 bestätigt getötet, 1 nur durch Zeitablauf oder Absturz erkannt");
    }
  }
});

test("ein Zeitablauf, nach dem der Bestätigungslauf grün ist oder nichts liefert, zählt als überlebt", async () => {
  for (const [antwort, zweiter] of [...GRUENE.map((status) => [[eintrag(status)], status]), [[], "ohne Ergebnis"]]) {
    const { ergebnis } = await bestaetigung(eintrag("Timeout"), antwort);
    assert.equal(ergebnis.status, "Survived", zweiter);
    assert.equal(ergebnis.hinweis, nichtBestaetigt(`erster Lauf Timeout, Bestätigungslauf ${zweiter}`));
  }
});

test("wird ein Zeitablauf im Bestätigungslauf zum roten Test, entscheidet ein dritter Lauf nur mit dieser Datei", async () => {
  const bestaetigter = await bestaetigung(eintrag("Timeout"), [eintrag("Killed", [DATEI])], [eintrag("Killed", [DATEI])]);
  assert.deepEqual(bestaetigter.aufrufe, [
    { zeilen: [ZEILEN], tests: undefined },
    { zeilen: [ZEILEN], tests: [DATEI] },
  ]);
  assert.equal(bestaetigt(bestaetigter.ergebnis), true);
  const gruener = await bestaetigung(eintrag("Timeout"), [eintrag("Killed", [DATEI])], [eintrag("Survived")]);
  assert.equal(gruener.ergebnis.status, "Survived");
  assert.equal(gruener.ergebnis.hinweis, nichtBestaetigt(`erster Lauf Timeout, Bestätigungslauf Killed ${DATEI}, dritter Lauf Survived`));
});

test("ein überlebender Mutant läuft nicht erneut und bleibt unverändert", async () => {
  for (const status of [...GRUENE, "Ignored", "CheckFailed"]) {
    const erster = eintrag(status);
    const { ergebnis, aufrufe } = await bestaetigung(erster);
    assert.deepEqual(aufrufe, []);
    assert.equal(ergebnis, erster);
  }
});

test("je tötende Datei läuft ein eigener Bestätigungslauf nur mit ihr, alle Abbrüche zusammen mit der Gruppe", async () => {
  const ergebnisse = [
    eintrag("Killed", [DATEI]),
    eintrag("Killed", [ANDERE], ZWEITER),
    eintrag("Timeout", [], DRITTER),
  ];
  const { aufrufe, nachlauf } = nachlaeufe(
    [eintrag("Killed", [DATEI]), eintrag("Survived", [], ZWEITER)],
    [eintrag("Killed", [ANDERE], ZWEITER)],
    [eintrag("Timeout", [], DRITTER)],
  );
  const bestaetigte = await bestaetige(ergebnisse, nachlauf);
  assert.deepEqual(aufrufe, [
    { zeilen: [ZEILEN], tests: [DATEI] },
    { zeilen: [ZWEITER.zeilen], tests: [ANDERE] },
    { zeilen: [DRITTER.zeilen], tests: undefined },
  ]);
  assert.deepEqual(bestaetigte.map(({ status }) => status), ["Killed", "Killed", "Timeout"]);
  assert.equal(bilanz(bestaetigte), "2 bestätigt getötet, 1 nur durch Zeitablauf oder Absturz erkannt");
});
