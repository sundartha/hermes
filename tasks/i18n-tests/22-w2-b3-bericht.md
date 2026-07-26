# W2-B3 — Phasenbericht: Wahlziel-Normalisierung und Gate-Kette

Basis: `master` (`b1bd854`), Umsetzung auf Branch `phase/w2-b3-wahl-gates`. Kein
Produktionscode geaendert (nur `test/*`, ein Kommentar in `package.json`, dieser Bericht).

## 1. Polaritaets-Tabelle — gemessenes Ergebnis je ID

| ID | Art | erwartete Polaritaet | gemessen | Datei |
|---|---|---|---|---|
| OUT-03 | Mechanismus | gruen | **gruen** | test/outbound-gates-order.test.js (neu) |
| OUT-12 | Charakterisierung | gruen | **gruen** | test/cost-origin-axis.test.js (neu) |
| OUT-14 | SOLL | rot | **rot** | test/outbound-gates-order.test.js (neu) |
| OUT-15 | Mechanismus | gruen | **gruen** | test/number-gate.test.js (neu, Spawn) |
| OUT-16 | Mechanismus | gruen | **gruen** | test/e164-trunk-zero-reject.test.js (neu) |
| OUT-17 | Mechanismus | gruen | **gruen** | test/dial-target-normalization.test.js (neu) |
| OUT-18 | Buchhaltung | — | Referenz-Kommentar | test/dial-target-normalization.test.js |
| OUT-22 | Mechanismus | gruen | **gruen** | test/outbound-gates-order.test.js (neu) |
| OUT-23 | Mechanismus | gruen | **gruen** | test/config-shape.test.js (neu) |
| OUT-27 | Mechanismus | gruen | **gruen** | test/telnyx-p5-origination.test.js (neu) |
| OUT-28 | Mechanismus | gruen | **gruen** | test/outbound-gates-order.test.js (neu) |
| FMT-20 | Mechanismus | gruen | **gruen** | test/e164-trunk-zero-reject.test.js (neu) |
| FMT-21 | Mechanismus | gruen | **gruen** | test/e164-trunk-zero-reject.test.js (neu) |
| FMT-22 | Buchhaltung | — | Referenz-Kommentar | test/dial-target-normalization.test.js |

Ergebnis deckt sich exakt mit dem Plan: **12 neue Tests (11 gruen, 1 rot), 2
Buchhaltungen** ohne eigenen Test. Keine neue Testdatei — jede ID hatte eine bestehende,
thematisch eindeutige Heimat (G17).

## 2. Abweichungen (R-G)

1. **OUT-14 als SOLL/rot statt gruenem Ist-Pin.** Die Katalog-Erwartung lautete "gruen".
   Gemessen: `src/telephony/outbound-gates.js` nennt im Modul-Kommentar "16 Glieder", die
   gebaute Kette traegt 17 (`grep -c 'name: "' src/telephony/outbound-gates.js` = 17,
   `EXPECTED_ORDER` = 17 Namen). Ein gruener Pin auf "16" wuerde die Doku-Drift zum
   Sollzustand erklaeren und beim Korrigieren des Kommentars brechen. Der Test faellt heute
   und heilt genau dann, wenn jemand die Zahl richtig stellt — danach ist er der Waechter
   gegen die naechste Drift (G27).
2. **OUT-16 auf Praedikat-Ebene statt HTTP-Vergleich.** Der Katalog wollte einen
   HTTP-Vergleich der beiden 400-Pfade (Pre-Check `isTrunkZeroFormatError` vs. regulaeres
   Format-Gate). Gemessen sind beide Pfade nach aussen ununterscheidbar: gleicher Status
   400, dieselbe Konstante `E164_FORMAT_ERROR` als Text, beide ohne Audit-Eintrag. Ein
   HTTP-Vergleich koennte deshalb gar nichts beweisen; der Test misst stattdessen das
   Praedikat plus seinen `!isDenied`-Guard.
3. **OUT-18 Praemisse widerlegt** — "die US-Testnummer bleibt der einzige Negativ-/Randfall
   der Suite" traegt nicht mehr: `test/number-gate.test.js` fuehrt mit `OUT-25` einen
   gruenen US-POSITIV-Pfad. Ein automatisierter Waechter darueber waere eine Aussage ueber
   die Testsuite selbst und altert mit jedem neuen Test (auch mit denen aus W2) —
   Buchhaltung am bestehenden Anker-Test statt alterndem Meta-Test.
4. **FMT-22 Titel ueberholt** (Baseline §2.3 "TEIL"): ein Tenant mit `country="US"` bekommt
   `homeCountryCode(...) === "+1"`; `null` gilt nur OHNE bestaetigtes NANP-Herkunftsland.
   Beide Haelften sind bereits von zwei benachbarten Bestands-Subtests gepinnt —
   Buchhaltung statt Duplikat (G5).
5. **OUT-23 an der Praefix-Struktur gemessen** statt am `languageForCountry`-Casing. Die
   ISO-Land-Achse ist Gegenstand von `LANG-09` (W2-B1, `test/f1-geo-port.test.js`); ein
   zweiter Test dort waere ein Duplikat. Gemessen wird stattdessen die Aussage, die die
   Casing-Frage auf der Praefix-Achse ueberhaupt erst gegenstandslos macht: jeder Eintrag
   in `ALLOWED_COUNTRY_CODES` und `VOICE_TARIFF_DOMESTIC_PREFIXES` ist ein reiner
   E.164-Ziffernstring (bzw. die `*`-Wildcard, der LIVE gesetzte Wert, s.
   `13-live-env-befund.md`) — ein ISO-Code wie `"US"` wuerde dort lautlos NIE matchen.
6. **OUT-12 ohne roten SOLL-Zwilling** — begruendete Ausnahme von R1 der kanonischen Liste.
   "fail-safe teuer statt fail-open billig" ist die getroffene Produktentscheidung derselben
   Achse (PAY-22); ein guenstigerer Toll-Free-Satz waere ein erfundenes Soll, solange kein
   Satz GEMESSEN ist. Der gruene Test faengt genau die gefaehrliche Richtung: einen stillen
   Kipp auf den billigen Satz.
7. **Kollisionsflaeche fuer Parallel-Bloecke** (Hinweis an den Lead): B4 wird
   voraussichtlich `test/outbound-gates-order.test.js` (PAY-26/`resolveMaxDurationS`) und
   `test/cost-origin-axis.test.js` (PAY-09) beruehren. Beide Edits hier sind rein additiv am
   Dateiende bzw. hinter benannten Ankern, ein Merge sollte konfliktfrei bleiben.

## 3. Lauf-Zahlen

| # | Befehl | Erwartet | Gemessen |
|---|---|---|---|
| 1 | `node --test test/outbound-gates-order.test.js` | 25 / 24 pass / 1 fail | **25 / 24 / 1** — genau ein `not ok`: OUT-14 (vorher 21/21/0) |
| 2 | `node --test test/e164-trunk-zero-reject.test.js` | 12 / 12 / 0 | **12 / 12 / 0** (vorher 9) |
| 3 | `node --test test/dial-target-normalization.test.js` | 33 / 33 / 0 | **33 / 33 / 0** (vorher 32) |
| 4 | `node --test test/number-gate.test.js` | 45 / 45 / 0 | **45 / 45 / 0** (vorher 44) |
| 5 | `node --test test/cost-origin-axis.test.js` | 11 / 11 / 0 | **11 / 11 / 0** (vorher 10) |
| 6 | `node --test test/telnyx-p5-origination.test.js` | 5 / 5 / 0 | **5 / 5 / 0** (vorher 4) |
| 7 | `node --test test/config-shape.test.js` | 17 / 17 / 0 | **17 / 17 / 0** (vorher 16) |
| 8 | `node --test test/characterization-marking.test.js` | 9/9 pass | **9 / 9 / 0** — GAP-27-Waechter bleibt gruen |
| 9 | `npm test` | 3295 / 3295 / 0 (unveraendert) | **korrigiert: tests 3295 / pass 3295 / fail 0** |
| 10 | `npm run test:gates` | 69 / 61 / 8 | **korrigiert: tests 69 / pass 61 / fail 8** |
| 11 | `node --test "test/*.test.js"` (ungefiltert) | 3295 + 69 = 3364, 8 fail | **3364 / 3356 / 8** — der Split verliert und dupliziert nichts |
| 12 | `git diff master --name-only` | nur test/, package.json, Bericht | **8 Dateien, davon 7 `test/*.test.js` + `package.json`; null unter `src/`, `public/`, `apps/`, `scripts/`** |

Fail-Set des Gate-Laufs, woertlich und vollstaendig:

```
LANG-19, GAP-05, GAP-15 (x2), LANG-15, OUT-14, VOICE-12, GAP-24
```

Das ist exakt das Baseline-Fail-Set (7) **plus OUT-14** — kein weiterer Fehlschlag, kein
Bestandstest gekippt (R-F erfuellt, kein Flake-Wiederholungslauf noetig).

## 4. Nebenbefunde

- **OUT-14 ist die einzige gefundene Sachdrift der Phase.** Der Modul-Kommentar in
  `src/telephony/outbound-gates.js` ("Die geordnete Gate-Kette (16 Glieder)") ist um ein
  Glied zurueck. Der Fix ist ein Ein-Wort-Edit im Produktionscode und gehoert bewusst NICHT
  in diese Phase (R-A: nur Tests).
- **`isTrunkZeroFormatError` und die Denylist-Praezedenz** haengen zusammen: `+19005550123`
  ist gleichzeitig denied (1-900) und wird vom Pre-Check korrekt NICHT als Formatfehler
  gemeldet — der `!isDenied`-Guard traegt also auf beiden NANP-Achsen.
- **Die `originationConfig()`-Fixture** in `test/telnyx-p5-origination.test.js` ist ein
  reiner Refactor: dasselbe Config-Literal stand sonst zweimal in derselben Datei (G5). Die
  Werte sind byte-identisch, keine Assertion des Bestandstests wurde beruehrt.
- **Bestaetigt gemessen** (relevant fuer R-C): ein per `--test-skip-pattern` gefilterter
  Test verschwindet vollstaendig aus der TAP-Summe. `npm test` bleibt deshalb bei exakt
  3295, obwohl 12 Tests dazugekommen sind — alle 12 tragen ihre Katalog-ID am
  Namensanfang und landen im Gate-Lauf.

## 5. Blast-Radius

Null. Es wurde kein Produktionscode geaendert, keine Env-Variable eingefuehrt (`BASE_ENV`
in `test/helpers.js` unberuehrt, R-D erfuellt), keine Dependency ergaenzt (nur `node:fs`,
`node:path`, `node:url` — Haus-Idiom aus `test/cost-calibration.test.js`). Der einzige
Nicht-Test-Edit ist der Kommentar-String `config._comment_i18nCatalogPattern` in
`package.json` (Buchhaltungs-Ausnahmen `OUT-18`, `FMT-22` nachgezogen); das wirksame
`i18nCatalogPattern` selbst bleibt unveraendert.

Deploy-Relevanz: keine. Der Merge dieser Phase aendert am laufenden Dienst nichts und
laesst `npm test` gruen; `npm run test:gates` gewinnt einen roten Test (OUT-14) — das ist
das Arbeitsergebnis (PLAN-I18N-TESTS.md 4.1), kein Regressionsfang.
