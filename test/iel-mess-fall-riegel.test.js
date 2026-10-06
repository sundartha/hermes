import { strict as assert } from "node:assert";
import fs from "node:fs";
import { describe, it } from "node:test";

import { bauMessBaum, faellePfadIn, setzeZusatzFall, spawnDry, trockenAufrufe } from "./_iel-messbaum.mjs";

const EXIT_VERWEIGERT = 2;
const FREIER_M1_ZAEHLER = Object.freeze({ ausgeloest: 0, anrufe: [] });
const PRUEFFALL = "Z-RIEGEL";
const BASIS_FAELLE = Object.freeze(["F-A", "N2-ohne-inbound"]);

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

  it("eine unbekannte art verweigert mit Grund", () => {
    for (const art of ["texml-erfunden", "toString", undefined]) {
      const ergebnis = laufMitAbgewandeltemFall("F-A", (fall) => {
        const { art: _bisherigeArt, ...rest } = fall;
        return art === undefined ? rest : { ...rest, art };
      });
      assert.equal(ergebnis.status, EXIT_VERWEIGERT, `art=${art}: ${ergebnis.stdout}\n${ergebnis.stderr}`);
      assert.match(ergebnis.stderr, /keine gueltige Art/);
      assert.equal(trockenAufrufe(ergebnis.stdout), 0);
    }
  });

  it("eine unbekannte Zaehler-Gruppe verweigert mit Grund", () => {
    for (const zaehler of ["x", "toString", undefined]) {
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
