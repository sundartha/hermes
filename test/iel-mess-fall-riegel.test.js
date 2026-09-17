// Fail-closed-Riegel der Fall-Definition (scripts/iel-mess.cases.json -> scripts/iel-mess.mjs).
//
// Der bleibende Wert der entfernten Messmaschine (IEP-A): die Ohrzeugen-Gruppe war der EINZIGE
// Weg, auf dem dieses Werkzeug je eine echte Telefonnummer waehlte (Feld "ziel_e164", art
// "texml-ohrzeuge", Zaehler "ohrzeuge"). Nach ihrer Entfernung darf eine blosse Aenderung an der
// Fall-Datei diesen Weg nicht wieder oeffnen, und kein unbekannter Wert darf still als undefined
// durchfallen. KEIN NETZ: alles laeuft mit --dry-run (fetch per Stolperdraht gesperrt).

import { strict as assert } from "node:assert";
import fs from "node:fs";
import { describe, it } from "node:test";

import { bauMessBaum, faellePfadIn, setzeZusatzFall, spawnDry, trockenAufrufe } from "./_iel-messbaum.mjs";

const EXIT_VERWEIGERT = 2;
// Der Bestands-M1-Zaehler steht auf 5/5; ein freier Zaehler trennt die Zielpruefung von der Budgetsperre.
const FREIER_M1_ZAEHLER = Object.freeze({ ausgeloest: 0, anrufe: [] });
const PRUEFFALL = "Z-RIEGEL";
const BASIS_FAELLE = Object.freeze(["F-A", "N2-ohne-inbound"]); // je einer aus m1 und nachdeploy

// Baut einen Messbaum, leitet den Pruefall aus einem BESTANDSFALL ab und aendert genau ein Feld -
// nur so belegt eine Verweigerung, dass sie an DIESEM Feld haengt und nicht am Aufbau.
function laufMitAbgewandeltemFall(basisName, aenderung) {
  const dir = bauMessBaum({ m1Zaehler: FREIER_M1_ZAEHLER });
  const basis = JSON.parse(fs.readFileSync(faellePfadIn(dir), "utf8")).faelle[basisName];
  setzeZusatzFall(dir, PRUEFFALL, aenderung({ ...basis }));
  return spawnDry(dir, [PRUEFFALL]);
}

describe("IEL-Messwerkzeug: die Fall-Definition ist fail-closed", () => {
  it("Positiv-Kontrolle: der unveraendert kopierte Bestandsfall laeuft trocken durch", () => {
    for (const name of BASIS_FAELLE) {
      const ergebnis = laufMitAbgewandeltemFall(name, (fall) => fall);
      assert.equal(ergebnis.status, 0, `${name}: ${ergebnis.stderr}`);
      assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    }
  });

  it("das Feld ziel_e164 verweigert in JEDER Gruppe - eine Telefonnummer waehlt dieses Werkzeug nie", () => {
    for (const name of BASIS_FAELLE) {
      const ergebnis = laufMitAbgewandeltemFall(name, (fall) => ({ ...fall, ziel_e164: "+491701234567" }));
      assert.equal(ergebnis.status, EXIT_VERWEIGERT, `${name}: ${ergebnis.stdout}\n${ergebnis.stderr}`);
      assert.match(ergebnis.stderr, /ziel_e164/);
      assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    }
  });

  it("eine unbekannte art verweigert mit Grund - auch die entfernte texml-ohrzeuge", () => {
    for (const art of ["texml-ohrzeuge", "texml-erfunden", "toString", undefined]) {
      const ergebnis = laufMitAbgewandeltemFall("F-A", (fall) => {
        const { art: _bisherigeArt, ...rest } = fall;
        return art === undefined ? rest : { ...rest, art };
      });
      assert.equal(ergebnis.status, EXIT_VERWEIGERT, `art=${art}: ${ergebnis.stdout}\n${ergebnis.stderr}`);
      assert.match(ergebnis.stderr, /keine gueltige Art/);
      assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    }
  });

  it("eine unbekannte Zaehler-Gruppe verweigert mit Grund - auch die entfernte ohrzeuge", () => {
    for (const zaehler of ["ohrzeuge", "x", "toString", undefined]) {
      const ergebnis = laufMitAbgewandeltemFall("F-A", (fall) => {
        const { zaehler: _bisherigerZaehler, ...rest } = fall;
        return zaehler === undefined ? rest : { ...rest, zaehler };
      });
      assert.equal(ergebnis.status, EXIT_VERWEIGERT, `zaehler=${zaehler}: ${ergebnis.stdout}\n${ergebnis.stderr}`);
      assert.match(ergebnis.stderr, /keine gueltige Zaehler-Gruppe/);
      assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    }
  });
});
