# W2-B4 — Phasenbericht: Geld — Tarif, Metering, Plan-Decken

Basis: `master` (`63563e3`), Umsetzung auf Branch `phase/w2-b4-geld`. Kein Produktionscode
geaendert (nur `test/*`, ein Kommentar-String in `package.json`, dieser Bericht).

## 1. Polaritaets-Tabelle — gemessenes Ergebnis je ID

| ID | Art | erwartete Polaritaet | gemessen | Datei |
|---|---|---|---|---|
| PAY-01 | Buchhaltung | — | Referenz-Kommentar | test/plans-catalog.test.js |
| PAY-06 | Mechanismus | gruen | **gruen** (2 Tests) | test/cost-truing-booking.test.js |
| PAY-08 | Buchhaltung | — | Referenz-Kommentar | test/metering-unit.test.js |
| PAY-09 | Buchhaltung | — | Referenz-Kommentar | test/cost-origin-axis.test.js |
| PAY-10 | Mechanismus | gruen | **gruen** | test/billing-stripe-idempotent-headers.test.js |
| PAY-12 | Buchhaltung | — | Referenz-Kommentar (Praemisse ueberholt) | test/p15-gate-denial-language.test.js |
| PAY-15 | Mechanismus | gruen | **gruen** | test/plan-cap-derivation.test.js |
| PAY-16 | Mechanismus (OCP) | gruen | **gruen** | test/plan-cap-derivation.test.js |
| PAY-17 | Charakterisierung | gruen | **gruen** | test/f1-provisioning-geo.test.js |
| PAY-20 | Buchhaltung | — | Referenz-Kommentar (Praemisse widerlegt) | test/provider-rate-guard.test.js |
| PAY-22 | Charakterisierung | gruen | **gruen** | test/cost-origin-axis.test.js |
| PAY-23 | Buchhaltung | — | Referenz-Kommentar | test/outbound-reserve-reconcile.test.js |
| PAY-24 | Mechanismus | gruen | **gruen** | test/plan-cap-derivation.test.js |
| PAY-25 | Buchhaltung | — | Referenz-Kommentar (ID entfaellt) | test/env-docs-spend-cap-coherence.test.js |
| PAY-26 | Mechanismus | gruen | **gruen** (2 Tests) | test/outbound-gates.test.js |
| GAP-06 | SOLL | rot | **rot** | test/metering-unit.test.js |
| GAP-08 | SOLL | rot | **rot** (2 Tests) | test/fx-single-source.test.js (neu) |
| GAP-09 | SOLL | rot | **rot** (2 Tests) | test/tts-quota-counter.test.js |
| GAP-11 | SOLL + Mechanismus | rot | **1 gruen + 1 rot** | test/f1-provisioning-geo.test.js |

**17 neue Tests (11 gruen, 6 rot) ueber 12 IDs, 7 IDs Buchhaltung, EINE neue Datei.**
Der Plan sprach von „15 Testbloecken"; die Aufzaehlung in seinem §2 traegt tatsaechlich 17
`test()`-Bloecke (PAY-06/PAY-26/GAP-08/GAP-09 sind je zweigeteilt, GAP-11 traegt zwei) —
die Zahl 15 war ein Zaehlfehler in der Plan-Kopfzeile, kein Scope-Unterschied.

## 2. Abweichungen (R-G)

1. **PAY-06 umformuliert.** Der Katalog unterstellt, der Cost-Truing-Sweep befreie die
   *Reserve*. Gemessen ist die Praemisse halb falsch: die Reserve befreit
   `releaseOutboundReserve` bei Call-Ende (`src/telephony/call-finish.js`, gepinnt in
   `test/reservation-ledger.test.js`); der Sweep korrigiert die zu hoch **gebuchte**
   Schaetzung (`applyCostCorrectionCents`) und ein Call wird erst nach
   `costTruingDelayMinutes` faellig (`isTruingCandidate`). Gebaut ist deshalb die
   **Decken**-Befreiung als GATE-Wirkung: `budgetExceeded` kippt von `true` auf `false`.
   Der Bestandstest (a) derselben Datei prueft nur die Bucket-ZAHL. Der zweite Block
   (nicht faelliger Call) ist bewusst kein Duplikat von `cost-truing-cadence.test.js`:
   dort ist das Subjekt die Kandidatenauswahl, hier die Decke.
2. **PAY-09 ist ein Duplikat-Befund.** „recordVoiceMinuteMeter rechnet auch fuer INBOUND
   mit dem Auslandstarif, wenn `call.to` eine US-DID ist" ist woertlich die Aussage des
   bestehenden ORIG-03-Tests. Buchhaltung statt zweitem Test (G5).
3. **PAY-12 Praemisse ueberholt** (Baseline §3.3). Der 402-Text folgt seit P15/T2 der
   Tenant-Sprache (`localeFor(store.tenantLanguage(id)).gates`); ein „hart deutsch"-Pin
   waere genau der Mischsprach-Pin, den der GAP-27-Waechter meldet.
4. **PAY-20 Praemisse widerlegt** (Baseline §3.7). Der unterstellte fehlende Drift-Alarm
   existiert zweistufig: `providerRateOutOfBand` (Boot-Guard) + `src/billing/cost-calibration.js`.
5. **PAY-25 entfaellt** (Baseline §3.7). `VOICE_TARIFF_DOMESTIC_PREFIXES` ist eine
   Code-Konstante, keine Env-Variable — es gibt keine Env-Doku-Kohaerenz zu pruefen.
6. **GAP-09 zweigeteilt.** Die ID traegt zwei unabhaengige Zusagen (Zurechenbarkeit je
   Tenant / definierter Zustand bei Erschoepfung). Zwei Konzepte = zwei Tests (P14).
7. **GAP-11 zweigeteilt (1 gruen + 1 rot).** Die *Invariante* „Hold == Capture ==
   `number_month`-costCents" ist heute erfuellt und war nur nirgends als EINE Assertion
   festgehalten (die Bestandstests belegen die Legs getrennt) — gruener Waechter. Die
   *zweite* Haelfte der ID („stimmen je Kaufland ueberein") ist offen: kein Kaufland traegt
   einen expliziten `holdAmountCents`, alle fallen auf den globalen Default — SOLL/rot.
8. **PAY-22 ohne eigene Vorbedingungs-Assertion.** Der Plan sah im Test ein
   `assert.notEqual(abroad, domestic)` vor. Genau diese Aussage steht bereits als eigener
   Vorbedingungs-Test am Kopf von `test/cost-origin-axis.test.js` — die Wiederholung waere
   eine Duplizierung (G5). Der Test verweist stattdessen im Kommentar darauf.
9. **Zwei Magic-Number-Bereinigungen im Bestand** (keine Assertion, kein Testname
   beruehrt, Werte beweisbar identisch):
   - `test/outbound-gates.test.js`: `const CAP_S = 300` -> `= MAX_CALL_DURATION_CAP_S`.
     Sonst staende die 300 zweimal in derselben Datei, nachdem die PAY-26-Bloecke die
     Konstante importieren (G5/G25).
   - `test/f1-provisioning-geo.test.js`: der dreifach wiederholte String `"t_user1"` wird
     zur benannten Konstante `TENANT_ID` (die GAP-11-Fixture braucht ihn als vierte
     Stelle).

## 3. Lauf-Zahlen

Alle Zahlen GEMESSEN; die „vorher"-Spalte ist am Branch-Punkt `63563e3` erhoben, nicht aus
dem Plan uebernommen (dessen Ausgangszahlen wichen fuer 5 Dateien ab).

| # | Befehl | vorher | nachher |
|---|---|---|---|
| 1 | `node --test test/plan-cap-derivation.test.js` | 21 / 21 / 0 | **24 / 24 / 0** |
| 2 | `node --test test/f1-provisioning-geo.test.js` | 15 / 15 / 0 | **18 / 17 / 1** — genau `GAP-11 (SOLL, rot)` |
| 3 | `node --test test/cost-origin-axis.test.js` | 11 / 11 / 0 | **12 / 12 / 0** |
| 4 | `node --test test/outbound-gates.test.js` | 4 / 4 / 0 | **6 / 6 / 0** |
| 5 | `node --test test/cost-truing-booking.test.js` | 11 / 11 / 0 | **13 / 13 / 0** |
| 6 | `node --test test/billing-stripe-idempotent-headers.test.js` | 4 / 4 / 0 | **5 / 5 / 0** |
| 7 | `node --test test/tts-quota-counter.test.js` | 20 / 20 / 0 | **22 / 20 / 2** — genau die beiden `GAP-09`-Bloecke |
| 8 | `node --test test/metering-unit.test.js` | 11 / 11 / 0 | **12 / 11 / 1** — genau `GAP-06 (SOLL, rot)` |
| 9 | `node --test test/fx-single-source.test.js` | — (neu) | **2 / 0 / 2** |
| 10 | `node --test test/characterization-marking.test.js` | 9 / 9 / 0 | **9 / 9 / 0** — GAP-27-Waechter unveraendert gruen |
| 11 | `npm test` | 3295 / 3295 / 0 | **korrigiert: tests 3295 / pass 3295 / fail 0 — unveraendert** |
| 12 | `npm run test:gates` | 69 / 61 / 8 | **korrigiert: tests 86 / pass 72 / fail 14** |
| 13 | `node --test "test/*.test.js"` (ungefiltert) | 3364 | **3381 / 3367 / 14** = 3295 + 86 — der Split verliert und dupliziert nichts |
| 14 | `git diff master --name-only` | — | 15 Dateien: 13 `test/*.test.js` (davon 1 neu), `package.json`, dieser Bericht |
| 15 | `git diff master --stat -- src public apps scripts render.yaml` | — | **leere Ausgabe** (R-A-Beweis, gegengeprueft statt Stichprobe) |

`npm test` bleibt bei exakt 3295, obwohl 17 Tests dazugekommen sind: alle 17 tragen ihre
Katalog-ID am Namensanfang und wandern in den Gate-Lauf. Die neue Datei steuert genau EINEN
`1..0`-Datei-Wrapper bei (Regressionslauf: 15 -> 16 abgezogene Wrapper).

Fail-Set des Gate-Laufs, woertlich und vollstaendig:

```
LANG-19, GAP-05, GAP-15 (x2), LANG-15, OUT-14, VOICE-12, GAP-24     (Baseline nach B3, 8)
GAP-06, GAP-08 (x2), GAP-09 (x2), GAP-11                            (neu, 6)
```

= **14**. Kein weiterer Fehlschlag, kein Bestandstest gekippt (R-F erfuellt, kein
Flake-Wiederholungslauf noetig).

## 4. Nebenbefunde

Gemessen, gehoeren NICHT in diese Phase gefixt (R-A):

1. **Toter Parameter auf einer Geld-Kante (G12).** `flushMeters` (`src/billing/meter.js`)
   uebergibt `costCents` an `billing.reportMeter`, obwohl weder der Port-Vertrag
   (`src/billing/ports.js`, `MeterReport`) noch der Stripe-Adapter das Feld kennen — es
   wird beim Destrukturieren fallengelassen. Fuer PAY-10 ist das der Gluecksfall (der
   Betrag leakt nicht), als Code-Zustand ist es eine Luege in der Aufrufstelle.
2. **Zwei unverbundene Zaehler ueber derselben Groesse** (Kandidat fuer G5/G27 im
   Produktivcode): der Play-TTS-Pfad (`src/tts/directive-synth.js`) schreibt nur
   `recordTtsCharacters` (plattformweit), der Tenant-Zaehler `recordTenantTtsCharacters`
   wird ausschliesslich vom Cost-Truing-Sweep aus Telnyx-Belegen gespeist. Summe(Tenant)
   deckt den Plattform-Zaehler damit strukturell nie ab (GAP-09 a).
3. **Kein wiederkehrender `number_month`-Pfad.** `recordNumberMonthMeter` hat GENAU EINE
   Aufrufstelle (`src/worker/provisioning-orchestrator.js`, bei der Aktivierung). Bei
   `NUMBER_MONTHLY_COST_CENTS > 0` weicht die Miet-Anzeige (`src/routes/api-billing.js`)
   damit dauerhaft vom Ledger ab (GAP-06).
4. **Kein Kaufland traegt einen eigenen `holdAmountCents`.** `COUNTRY_SEARCH_PARAMS`
   (`src/telephony/provisioning-geo.js`) fuehrt FR/GB/US nur mit `telnyxCountryCode`. Das
   ist bewusst konservativ (der Kommentar sagt: erst eintragen, wenn der Live-Preis
   bestaetigt ist) — aber solange `PROVISIONING_ENABLED` scharf ist und die realen Preise
   unbestaetigt sind, kann der Hold lautlos vom Ist abweichen (GAP-11 b).

## 5. Blast-Radius

Null Produktionswirkung. Kein Produktionscode, keine Env-Variable (`BASE_ENV` in
`test/helpers.js` unberuehrt, R-D erfuellt), keine neue Dependency (nur `node:test`,
`node:assert/strict`, `node:fs`, `node:path`, `node:url` sowie bereits im Repo genutzte
Test-Helfer). Der einzige Nicht-Test-Edit ist der Kommentar-String
`config._comment_i18nCatalogPattern` in `package.json` (Buchhaltungs-Ausnahmen PAY-01,
PAY-08, PAY-09, PAY-12, PAY-20, PAY-23, PAY-25 nachgezogen); das wirksame
`i18nCatalogPattern` bleibt unveraendert (`PAY`/`GAP` sind bereits Praefixe).

`npm test` bleibt gruen, `npm run test:gates` gewinnt 6 rote Launch-Gates — das ist das
Arbeitsergebnis (PLAN-I18N-TESTS.md 4.1), kein Regressionsfang. Deploy-Relevanz: keine.

Kollisionsflaeche fuer parallele Bloecke (Hinweis an den Lead): `test/cost-origin-axis.test.js`
(B3 hat dort `OUT-12` angehaengt — der B4-Edit sitzt rein additiv hinter dem OUT-12-Block
bzw. als Kommentar ueber dem ORIG-03-Test) und `test/f1-provisioning-geo.test.js` (auch
B5/DID-11 beansprucht `holdAmountForCountry`; die B4-Bloecke haengen additiv hinter der
bestehenden Hold-Sektion bzw. am Dateiende).
