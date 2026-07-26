# Phasenreport W2-B4 — Geld: Tarif, Metering, Plan-Decken

**Status:** Gate = PASS
**finalBranch:** `phase/w2-b4-geld`
**headCommit:** `f4347b3520a80a9c869b19d8ecab67889d972a65`
**Basis:** `master` = `63563e3` (W2-B3 gemergt)

---

## 1. Plan (gekuerzt)

Bindend: `tasks/i18n-tests/18-w2-scope.md` §W2-B4 + §3 (R-A…R-G), `19-w2-baseline.md` §2.4 + §3.7, `.claude/refs/clean-code.md`.

**R-A gilt hart:** kein Byte unter `src/`, `public/`, `apps/`, `scripts/`, `render.yaml`. Geaendert werden ausschliesslich `test/*`, ein Kommentar-String in `package.json` und der Blockreport.

Ausgangslage: alle Katalog-IDs wurden am heutigen `master` neu vermessen statt aus dem Katalog uebernommen (R-G). Ergebnis der Einteilung: **12 IDs mit Testbau** (15 im Plan angekuendigte, tatsaechlich 17 test()-Bloecke — Zaehlfehler in der Plan-Kopfzeile, s. Deviations), **7 IDs reine Buchhaltung** (Sachverhalt bereits woertlich gepinnt, kein zweiter Test).

Wichtigste Einzelbefunde je ID:

- **PAY-01** gruen (Buchhaltung) — `plans-catalog.test.js` + `bk1-plan-price-format.test.js` pinnen bereits EUR/Katalog-Gleichheit.
- **PAY-06** Katalog-Praemisse halb falsch, umformuliert: nicht der Sweep befreit die Reserve (das tut `releaseOutboundReserve` bei Call-Ende), sondern er korrigiert die ueberbuchte Schaetzung nach `costTruingDelayMinutes`. Neu gepinnt: Gate-Praedikat `budgetExceeded` kippt true->false nach dem Sweep, bleibt true vor Faelligkeit.
- **PAY-08, PAY-09, PAY-23** gruen (Buchhaltung) — bereits gepinnt (Inbound zieht kein Tenant-Budget, Herkunfts-Achse ORIG-03, Reserve-Grenzfall T5).
- **PAY-10** neu, gruen — `reportMeter` liess `costCents` NIE in den Stripe-HTTP-Body durchsickern; jetzt explizit gepinnt (Geld-Betrag verlaesst den Prozess nicht).
- **PAY-12** ueberholt (Baseline §3.3) — Denial-Texte folgen bereits der Tenant-Sprache, kein "hart deutsch"-Pin gebaut (waere der GAP-27-Mischsprach-Befund).
- **PAY-15/PAY-16** neu, gruen — `planCapCents` wirft fail-closed bei unbekanntem Slug UND jeder Katalog-Slug hat eine Kopffreiheit (OCP-Waechter fuer kuenftige Plaene).
- **PAY-17** neu, gruen — `holdAmountForCountry` liefert fuer US denselben Betrag wie DE (kein eigener US-Preis, per Sentinel bewiesen).
- **PAY-20** ueberholt — Drift-Alarm existiert bereits (`providerRateOutOfBand` + `cost-calibration.js`).
- **PAY-22** neu, gruen — Ziel-Achse von `tariffCentsPerMin`: leere/unbekannte Zielvorwahl faellt fail-safe-teuer auf den Default-Tarif, nicht fail-open-billig.
- **PAY-24** neu, gruen — Downgrade business->starter wirkt sofort auf eine bereits offene In-Flight-Reserve (kein zwischengespeicherter Cap).
- **PAY-25** entfaellt — `VOICE_TARIFF_DOMESTIC_PREFIXES` ist Code-Konstante, keine Env; `.env.example` dokumentiert korrekt nichts.
- **PAY-26** neu, gruen (2 Tests) — feindliches `max_duration_s` (negativ/NaN/String/0) senkt die Outbound-Reserve nicht; ein absurder Wert wird auf `MAX_CALL_DURATION_CAP_S` gedeckelt.
- **GAP-06** neu, ROT (SOLL) — `recordNumberMonthMeter` hat GENAU EINE Aufrufstelle (Aktivierung im Provisioning-Orchestrator), kein wiederkehrender Miet-Pfad.
- **GAP-08** neu, ROT (SOLL, 2 Tests, neue Datei `test/fx-single-source.test.js`) — zwei divergente USD/EUR-Kurse: `usdToEur: 0.93` nacktes Literal vs. `PROVIDER_TO_BUCKET_RATE_MICRO`-Fallback 920000 (=0.92).
- **GAP-09** neu, ROT (SOLL, 2 Tests) — Play-TTS-Zeichen sind keinem Tenant zurechenbar (nur Plattform-Zaehler), und ein erschoepftes TTS-Kontingent hat keinen definierten Zustand (nur Warnung, keine Sperre/Degradation).
- **GAP-11** neu, 1 gruen + 1 ROT (SOLL) — Hold/Capture/Ledger teilen zwar eine Quelle (jetzt als Invariante gepinnt), aber kein Kaufland traegt einen expliziten `holdAmountCents` (Default-Fallback fuer alle).

Was NICHT gebaut wird (Scope-Riegel): kein Produktionscode, keine neue Env-Variable, keine neue Dependency, kein Spawn/Netz/echte DB ausser vorhandenem pglite, kein Anfassen des GAP-27-Waechters (`characterization-marking.test.js`).

Erwartetes deterministisches Ergebnis (Auszug): `npm test` unveraendert 3295/3295/0; `npm run test:gates` von 69/61/8 auf 84 (Plan) bzw. 86 (gemessen)/72/14; Split-Invariante `node --test "test/*.test.js"` = Summe beider Laeufe ohne Verlust/Duplikat; `git diff master --stat` ausserhalb `test/`+`package.json`+Report leer.

---

## 2. Impl-Zusammenfassung

- **headCommit:** `f4347b3520a80a9c869b19d8ecab67889d972a65`, committed auf `phase/w2-b4-geld`.
- **node --check:** pass. **npm test:** pass, 3295/3295/0.
- **Smoke:** pass — Server-Boot ueber Test-Harness (BASE_ENV, echter Kindprozess, Temp-DATA_DIR): `GET /healthz` = 200, `GET /api/plans` = 200 (die Geld-Lesekante des Blocks).
- **Neue Datei:** `test/fx-single-source.test.js` (GAP-08, 2 SOLL-Tests, beide rot) + `tasks/i18n-tests/23-w2-b4-bericht.md`.
- **Editierte Testdateien (12):** `test/plan-cap-derivation.test.js` (PAY-15/16/24), `test/f1-provisioning-geo.test.js` (PAY-17, GAP-11 x2), `test/cost-origin-axis.test.js` (PAY-22 + PAY-09 Kommentar), `test/outbound-gates.test.js` (PAY-26 x2), `test/cost-truing-booking.test.js` (PAY-06 x2), `test/billing-stripe-idempotent-headers.test.js` (PAY-10), `test/tts-quota-counter.test.js` (GAP-09 x2), `test/metering-unit.test.js` (GAP-06 + PAY-08 Kommentar), plus reine Kommentar-Ergaenzungen in `test/plans-catalog.test.js` (PAY-01), `test/p15-gate-denial-language.test.js` (PAY-12), `test/outbound-reserve-reconcile.test.js` (PAY-23), `test/provider-rate-guard.test.js` (PAY-20), `test/env-docs-spend-cap-coherence.test.js` (PAY-25).
- **package.json:** nur der Kommentar-String `_comment_i18nCatalogPattern` um die neuen Buchhaltungs-IDs ergaenzt; das wirksame Pattern selbst unveraendert.
- **Laufzahlen (gemessen):** `npm test` 3295/3295/0 (unveraendert ggue. B3-Baseline). `npm run test:gates` 86/72/14 (vorher 69/61/8, Delta genau +17 Tests/+6 rot). Ungefiltert `node --test "test/*.test.js"`: 3381 = 3295 + 86, Split verliert/dupliziert nichts. GAP-27-Waechter (`characterization-marking.test.js`) unveraendert 9/9/0.
- **Fail-Set des Gate-Laufs:** Baseline `LANG-19, GAP-05, GAP-15 (x2), LANG-15, OUT-14, VOICE-12, GAP-24` (8, unveraendert rot) plus neu `GAP-06, GAP-08 (x2), GAP-09 (x2), GAP-11` (6) = 14. Kein Bestandstest gekippt.

### Deviations (aus dem Impl-Report)

1. **Testzahl-Diskrepanz:** Plan-Kopf nannte 15 Bloecke, tatsaechlich 17 (PAY-06/PAY-26/GAP-08/GAP-09 je zweigeteilt, GAP-11 zwei) — Zaehlfehler in der Planzeile, kein Scope-Unterschied. Gate-Lauf real 86 statt geplanter 84.
2. **Plan-Baselines fuer 5 Dateien waren falsch** (z.B. `plan-cap-derivation` 21 statt 19 Ausgangstests, `f1-provisioning-geo` 15 statt 16, `cost-truing-booking` 11 statt 13, `tts-quota-counter` 20 statt 22, `metering-unit` 11). Alle Vorher/Nachher-Zahlen im Bericht sind am Branch-Punkt `63563e3` GEMESSEN (R-G), nicht aus dem Plan uebernommen; die erwarteten Polaritaeten stimmten trotzdem alle.
3. **PAY-22:** die geplante `assert.notEqual(abroad, domestic)`-Zeile weggelassen, weil dieselbe Aussage bereits als Vorbedingungs-Test am Kopf von `cost-origin-axis.test.js` steht (G5-Duplizierung vermieden).
4. **Zwei Magic-Number-Bereinigungen im Bestand** (keine Assertion/kein Testname beruehrt, Werte beweisbar identisch): `outbound-gates.test.js` `const CAP_S = 300` -> `MAX_CALL_DURATION_CAP_S`; `f1-provisioning-geo.test.js` dreifacher String `'t_user1'` -> benannte Konstante `TENANT_ID`.
5. **GAP-11(a)** ruft `recordNumberMonthMeter` nach dem Drain explizit mit der frisch aktivierten Nummer auf statt es aus dem Harness zu ziehen, weil der Meter-Aufruf im Orchestrator sitzt (`worker/provisioning-orchestrator.js`), nicht in `handleProvisionJob` (der den Drain faehrt). Im Test kommentiert.
6. **PAY-06 umformuliert** gegenueber Katalog (Reserve -> Decke, s. o.), im Bericht §2 begruendet.
7. **Drei Katalog-Praemissen als ueberholt/gegenstandslos dokumentiert statt gebaut:** PAY-12, PAY-20, PAY-25 (s. o.).
8. **Worktree-Tooling:** der vorgegebene Befehl `ln -s ./node_modules node_modules` erzeugte im Worktree einen zirkulaeren Symlink (ELOOP); ersetzt durch Link auf `node_modules` des Hauptrepos, nicht committet (gitignored, `git status` sauber).

---

## 3. Safety-Urteil (final)

**Verdikt: FREIGABE** (`approved: true`, `blockers: []`).

Alle Kernkriterien bestanden: Tests unabhaengig reproduziert, Safety-Gates unangetastet, Offenlegungssatz unveraendert, Auth fail-closed unveraendert, keine Secrets geleakt, Scope eingehalten, Verhalten wie spezifiziert.

Unabhaengige Nachmessung (eigener Worktree, `git merge-base` gegen stale-base geprueft): Regression 3295/3295/0 zweimal gruen; Gates 86/72/14 branch vs. 69/61/8 master, Delta exakt +17/+6 rot; Split-Invariante 3381 = 3295+86 bestaetigt; R-A-Beweis: `git diff master..HEAD --stat -- src public apps scripts render.yaml .env.example package-lock.json` leer, 16 geaenderte Dateien insgesamt, alle 7 Minus-Zeilen im Diff einzeln als benigne Bereinigungen identifiziert (keine Assertion/kein Testname entfernt).

**Concerns (keine Blocker, Empfehlungen fuer Folgephasen):**
1. **GAP-06 ist ein un-gruen-barer SOLL-Test** — ruft `recordNumberMonthMeter` genau einmal auf und behauptet `belege.length === 3`; selbst nach einem gedachten Produktions-Fix (wiederkehrender Pfad) bliebe der Test rot, weil kein Zeitverlauf simuliert wird. Ein spaeterer Fixer muss den Test umschreiben — Risiko, dass der Befund dabei stillschweigend verloren geht. Empfehlung: Zeit-Seam einbauen oder Assertion auf den beobachtbaren Vertrag drehen.
2. **GAP-08 (a) und (b) koennen nie gleichzeitig gruen werden** (diagnostisch, nicht als Abnahmekriterium geeignet) — im Test kommentiert, bewusst gewaehlt. Der Befund selbst (0.93 vs. 0.92, ein Kurs nur per Deploy korrigierbar) ist echt und schwerwiegend.
3. **GAP-11(a) ist ein Spiegel-Test, kein End-to-End-Beweis** — baut die number_month-Buchung mit einer selbst konstruierten metering-Instanz nach demselben Fixture-Wert nach, statt den echten Produktionspfad (`worker/provisioning-orchestrator.js:175`, zusaetzlich hinter `paymentEnabled` gegated) zu durchlaufen. Ein Drift zwischen Hold- und Ledger-Config bliebe unentdeckt (Lehre "gleiche Fixture-Werte testen nichts").
4. **`test/outbound-gates.test.js` importiert neu die echte `src/config.js`** und haengt damit an der ambienten `.env` — heute stabil (relevante Env-Variablen lokal ungesetzt), aber ein lokal gesetztes `MAX_CALL_DURATION_S >= 300` wuerde die Assertion falsch-rot machen (Lehre test-base-env-drift). Bestandsmuster vorhanden (`cost-origin-axis.test.js` macht dasselbe), daher kein Blocker.
5. **Vorbestehender Voll-Last-Flake, nicht von B4 verursacht:** `test/api-flush-meters.test.js:53` faellt im ungefilterten Lauf gelegentlich mit 401 statt 404 (Auth greift frueher als Routen-Pruefung, restriktivere Richtung, keine Gate-Aufweichung); Datei vom Diff unberuehrt, isoliert 4/4 gruen.
6. **`npm run lint` ist im Repo derzeit nicht lauffaehig** (`@eslint/js` fehlt), gilt auch auf `master` — kein Branch-Defekt, aber kein Linter hat die 17 neuen Bloecke gesehen.

---

## 4. Clean-Code-Audit (final)

**Verdikt: FREIGABE**, `blocker: false`.

- **S1 (Blocker):** keine.
- **S2 (schwer):** keine.
- **S3 (Kleinkram, kein Fix noetig):**
  - `test/fx-single-source.test.js:27,38` — `readLiteral`/`readEnvFallback` parsen `src/config.js` per Regex auf reinem Quelltext statt Werte zu importieren; bewusste, im Kommentar begruendete Ausnahme (Lehre test-base-env-drift), Musterwiederholung aus `env-docs-spend-cap-coherence.test.js`. Fragil bei Reformatierung von `config.js`, aber Lesbarkeit-vor-Fix bewusst gewaehlt.
  - `test/cost-truing-booking.test.js:130-132` — `PAY06_CAP_CENTS`/`PAY06_ESTIMATE_CENTS`/`PAY06_MEASURED_MICRO_CENTS` sauber benannt und kommentiert, reine positive Beobachtung.
- **S4 (Beobachtung, kein Verstoss):** `test/f1-provisioning-geo.test.js` — GAP-11 fasst zwei Konzepte (Invariante Hold==Capture==Ledger UND fehlender Laender-Preis) unter einer ID, aber sauber in zwei separate `test()`-Bloecke aufgeteilt (P14 eingehalten).

Begruendung: reine Test-Erweiterungsphase, kein Produktionscode beruehrt (verifiziert). Kein Duplizierungs-Befund; Buchhaltungs-Eintraege (PAY-01/08/09/12/20/23/25) bewusst als Kommentar-Referenz statt zweiter Test, um G5 zu vermeiden. Zwei kleine Bereinigungen im Bestand (`CAP_S`->`MAX_CALL_DURATION_CAP_S`, `'t_user1'`->`TENANT_ID`) sind Magic-Number-Haertung ohne Verhaltensaenderung. `PAY-10` ist eine reine Absicherung (kein interner Kostenbetrag im Stripe-Request-Body), keine Schwaechung.

**Offene TODOs fuer Folgephasen (kein Blocker):**
1. Bei Umformatierung von `src/config.js` pruefen, ob die Regex-Parser in `fx-single-source.test.js` und `env-docs-spend-cap-coherence.test.js` noch treffen.
2. GAP-11s zweite Haelfte (fehlender expliziter Laenderpreis je Kaufland) bleibt offen fuer eine Folgephase.
3. Vor Merge sicherstellen: `npm run test:gates` zeigt die 6 neuen rot-erwarteten Tests (86/72/14) und `npm test` bleibt bei 3295/3295/0.

---

## 5. Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) kamen direkt auf FREIGABE ohne Blocker; es gab keine Self-Fix-Iteration in dieser Phase.
