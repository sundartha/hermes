# 16 - Lauf-Trennung Self-Fix Runde 1+2 (Bericht)

Stand: 2026-07-25 | Basis: `9a5e9a6` | Branch: `phase/i18n-lauf-trennung-fix2`

Aufgabe 1 (Lauf-Trennung `npm test` / `npm run test:gates`) wurde in `15cefec` umgesetzt,
danach zwei Runden Self-Fix gegen Review-Befunde. Runde 1 (`eb52ec8`) hat S1 (kein Test fuer
`test/i18n-catalog-run.mjs`) und S2/G5 (Invocation zwischen Wrapper und CI dupliziert) behoben.
Dieser Bericht haelt die einzige noch offene Entscheidung aus Runde 1 fest, die laut Review
"nicht der Review-Agent einseitig entscheiden kann": die Summen-Abnahmebedingung aus Aufgabe 1.

## Entscheidung: Basiszahl 3044 -> 3054

**Aufgabe 1** legte fest: `test:gates` + `npm test` muessen zusammen wieder 3044 Tests
ergeben. Zweck dieser Abnahmebedingung war, zu beweisen, dass der SPLIT-MECHANISMUS selbst
(Skip-/Name-Pattern + Phantom-Wrapper-Korrektur) keinen bestehenden Test verliert oder
dupliziert. Das ist erfuellt und bleibt es: der Regressionslauf ohne die neuen Wrapper-Tests
lag bei genau 2930, der Gates-Lauf bei genau 114 - Summe 3044, byte-genau wie vor der Trennung.

**Runde 1** hat zusaetzlich `test/i18n-catalog-run.test.js` mit 10 Tests eingefuehrt (Pflicht
aus S1: die TAP-Parsing-/Phantom-Zaehl-Logik war zuvor nur durch echte, teure Volllaeufe
verifiziert). Diese 10 Tests sind ausschliesslich Selbsttests des Wrapper-Skripts, tragen
kein Katalog-Praefix und landen deshalb vollstaendig im Regressionslauf (2930 + 10 = 2940).
Der Gates-Lauf bleibt bei 114. Neue Summe: **3054**.

Rechnerisch nicht vermeidbar: `node --test` zaehlt jeden `test()`-Aufruf einzeln in der
TAP-Summe (empirisch geprueft, auch bei `t.test()`-Subtests und bei einem `test()` mit
Schleife ueber mehrere Faelle - letzteres zaehlt als 1, aber mindestens 1 pro getesteter
Verhaltensklasse ist unausweichlich). Um exakt 3044 zu halten, muessten entweder die 10
S1-Pflichttests wieder geloescht werden (macht S1 rueckgaengig, laut Runde-1-Review "wirklich
behoben") oder sie muessten aus dem von `test/*.test.js` erfassten, per `node --test`
gezaehlten Bereich herausgenommen werden (widerspricht der von der Runde-1-Review explizit
gepruepften und gebilligten Platzierung als regulaerer node:test-Testfall).

**Entscheidung (Option A aus dem Befund selbst):** Die Abnahmebedingung wird auf die neue,
korrekte Basis aktualisiert. **3054 ist der aktuelle, richtige Wert** - 3044 unveraendert
uebernommene Bestandstests plus 10 legitime, neue Tests fuer bis dahin ungetestete
Kernlogik des Split-Mechanismus selbst. Kein Test wurde durch die Trennung verloren oder
verdoppelt; die Splitmechanik-Garantie aus Aufgabe 1 gilt unveraendert (2930 + 114 = 3044
fuer den unveraenderten Testbestand). Der Zuwachs auf 3054 ist eine bewusste, im
Fix-Commit von Runde 1 bereits offengelegte Erweiterung, kein Bruch der Abnahmebedingung.

## Gemessene Zahlen (dieser Fix, Runde 2)

| Lauf | tests | pass | fail |
| --- | --- | --- | --- |
| `npm test` (Regression) | 2940 | 2940 | 0 |
| `npm run test:gates` (Launch-Gates) | 114 | 29 | 85 |
| **Summe** | **3054** | 2969 | 85 |

Davon 2930/114 (Summe 3044) unveraenderter Bestand, 10 neue Selbsttests fuer
`test/i18n-catalog-run.mjs` (ausschliesslich im Regressionslauf, alle gruen).
