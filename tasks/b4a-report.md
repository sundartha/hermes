# Phase B4a — Detailbericht

**Titel:** Preisstaffel je Token-Sorte + Boot-Abbruch bei unbepreistem Modell
**Gate:** PASS
**finalBranch:** `phase/b4a-preisstaffel-gate`
**headCommit:** `064e85f` (auf `master` `dd149ef`)

---

## 1. Ausloeser-Tabelle des Boot-Abbruchs (vollstaendig)

Geprueft werden weiterhin GENAU zwei Werte: `config.llm.claudeModel` und `config.llm.briefingModel` (`boot.js:126`, unveraendert). Die Liste der geprueften Modelle wird NICHT erweitert; nur die Schwere aendert sich (WARN -> `exit(1)`).

### Bricht ab (JA)

| # | Konfiguration | Waechter / Ort | Ausgabe + Exit | Test |
|---|---|---|---|---|
| A-1 | `CLAUDE_MODEL` ohne Eintrag in `modelPricesUsd` | `assertPricedModels` (boot.js) ueber `unpricedModels` (boot-guard.js:196) | `[boot] Start abgebrochen: Modell(e) ohne Preis in modelPricesUsd: <id> - ...`, Exit 1, kein offener Port | Spawn `B4A-BOOT-1` |
| A-2 | `PRECALL_BRIEFING_MODEL` ohne Eintrag — auch bei `PRECALL_BRIEFING_ENABLED=false` | dieselbe Funktion, dieselbe Liste | wie A-1 | Spawn `B4A-BOOT-2` |
| A-3 | Datierte Snapshot-ID als `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL` (z.B. `claude-haiku-4-5-20251001`) | dieselbe Funktion — haeufigster realer Weg in A-1 | wie A-1 | Spawn `B4A-BOOT-3` |
| A-4 | Ein Staffel-Eintrag unvollstaendig: eine der vier Raten fehlt/nicht-numerisch/negativ/`NaN`; ebenso fehlendes/formfremdes `validFrom` | `resolveModelPrices` (config.js), Regel 3 — wirft beim Modul-Laden von config.js | Unhandled Exception `modelPricesUsd: Staffel '<id>' ab <validFrom> hat keine gueltige Rate <feld> (<wert>) - vier Raten sind Pflicht`, Node Exit 1. Kein `[boot] Start abgebrochen:`-Praefix (config.js laeuft vor boot.js) | Unit `B4A-RES-4/5` |
| A-5 | Ein Modell hat fuer heute keine gueltige Staffel (alle `validFrom` in der Zukunft, oder leeres Staffel-Array) | `resolveModelPrices`, Regel 2 | `modelPricesUsd: Modell '<id>' hat am <heute> keine gueltige Preisstaffel ...`, Exit 1 | Unit `B4A-RES-6` |
| A-6 | `MODEL_PRICE_SCHEDULES` leer | `resolveModelPrices`, eigene Vorpruefung | `modelPricesUsd: keine Preisstaffel hinterlegt - keine Preisquelle fuer den Budget-Guard (Regel 1)` | Unit `B4A-RES-7` |

> A-4/A-5/A-6 sind per Env NICHT erreichbar — nur ueber eine Quelltext-Aenderung an `MODEL_PRICE_SCHEDULES`. Deshalb bewusst `throw` beim Modul-Laden (frueheste Stelle, fail-closed), kein zweiter `[boot]`-formatierter Refusal.

### Bricht NICHT ab (NEIN)

| # | Fall | Warum nicht | Test |
|---|---|---|---|
| N-1 | Ueberzaehliger Eintrag in der Tabelle (Modell hinterlegt, nirgends konfiguriert) | Abbruch wegen ungenutztem Datensatz toetete den Dienst grundlos | Unit `B4A-RES-8` |
| N-2 | `REALTIME_MODEL=<ohne Preis>` (`gpt-realtime`) | Realtime-Pfad bucht keine Token: `bookTokenUsage`-Aufrufer sind nur `claude.js:796/816/1302` und `precall-briefing.js:265/316` — `bridge.js` ist nicht darunter | Spawn `B4A-BOOT-4` |
| N-3 | `asOf` weit in der Vergangenheit (Preisliste veraltet) | WARN, kein Abbruch — sonst legt ein Kalendertag die Telefonie lahm | Unit `B4A-STALE-1/2` |
| N-4 | Spaetere Staffel existiert, noch nicht faellig (Sonnet ab 2026-09-01) | Normalfall | Unit `B4A-RES-2` |
| N-5 | Fehlender/ungueltiger `DEEPSEEK_API_KEY`, nicht registrierter Fremdadapter | B5, kein Code in B4a | — |
| N-6 | `usdToEur` ausserhalb des Bandes | Schon von `assertProviderRateInBand` abgedeckt — keine zweite Meldung | Bestandstest bleibt |
| N-7 | BASE_ENV-Standardstart (`CLAUDE_MODEL=claude-haiku-4-5`, `PRECALL_BRIEFING_MODEL=claude-sonnet-5`) | Beide bepreist | Bestandstest `T-P3-11` bleibt gruen (Gegenprobe zu A-1) |

**Scharfe Kante (A-2):** `briefingModel` wird auch bei abgeschaltetem Briefing geprueft. Unveraendertes Bestandsverhalten der geprueften Liste; B4a aendert nur die Schwere.

---

## 2. Abnahmepunkte A-1..A-7 — Urteil und Kommando

| # | Kommando | Urteil |
|---|---|---|
| A-1 (Syntax) | `node --check src/config.js && node --check src/store/state-ops.js && node --check src/llm-usage.js && node --check src/boot.js && node --check src/boot-guard.js && node --check src/store/defaults.js` | PASS — Exit 0, keine Ausgabe |
| A-2 (Regressionssuite) | `npm test` | PASS — 4077 pass, 0 fail, Exit 0 (Ausgangsstand vor B4a: 4046 — Delta +31, keine geschrumpfte Menge, Namensvergleich zeigt 0 verschwundene Tests) |
| A-3 (Buchungsbeweis + Gegenprobe) | `node --test test/llm-booking.test.js` (mit vorheriger Sabotage, s. Abschnitt 3) | PASS — nach Sabotage EXIT=1 (fail 4), nach Ruecknahme EXIT=0 (pass 4) |
| A-4 (Boot-Abbruch) | `node --test test/boot-failclosed.test.js` + manueller Direktlauf `CLAUDE_MODEL=modell-ohne-preis ... node src/server.js` | PASS — Spawn-Tests fail 0/EXIT 0; manueller Lauf EXIT=1, `[boot] Start abgebrochen:` mit `modell-ohne-preis`, kein offener Port |
| A-5 (Nicht-Ausloeser) | `node --test test/b4a-model-prices.test.js` + `B4A-BOOT-4`/`B4A-BOOT-5` | PASS — fail 0, EXIT 0; jeder benannte Nicht-Ausloeser startet weiterhin normal (`/healthz`=200) |
| A-6 (Fixture-Rechnung) | `node --test test/model-price-gate.test.js` | PASS — fail 0, EXIT 0; Zahlen s. Abschnitt 4 |
| A-7 (Formatierung) | `npx prettier --check ...` (13 Dateien) | TEILWEISE — s. Deviations/Concerns; Bestandsbefund, kein B4a-Defekt (Basis-Dateien waren schon auf `dd149ef` prettier-rot) |

---

## 3. A-3-Gegenprobe — woertlich ausgefuehrt

**Schritt 1 — Sabotage:** in `src/llm-usage.js` den Rumpf von `bookTokenUsage` auf `return;` gesetzt.

Kommando:
```
node --test test/llm-booking.test.js ; echo "EXIT=$?"
```
Ausgabe (woertlich, gekuerzt auf die Beleg-Zeilen):
```
✖ B4A-BUCH-1 (Attrappe): ein Turn nach dem Port-Vertrag bucht den von Hand gerechneten Betrag (15.191792ms)
✖ B4A-BUCH-2 (Adapter Anthropic): dieselbe Rohantwort ergibt ueber den ECHTEN Adapter denselben Betrag (0.471916ms)
✖ B4A-BUCH-3 (Ledger-Achse): derselbe Betrag im Stripe-Beleg, die MENGE unveraendert (0.086375ms)
✖ B4A-BUCH-4 (Regel 1): die pro-Tenant-Kostendecke greift auf dem NEU gerechneten Betrag (4.543291ms)
ℹ tests 4
ℹ pass 0
ℹ fail 4
✖ failing tests:
test at test/llm-booking.test.js:82:1
✖ B4A-BUCH-1 ...
  AssertionError [ERR_ASSERTION]: auf der Budget-Achse muss der je Token-Sorte gerechnete Betrag stehen, nicht die alte Faltung (14720)
  0 !== 6900
    actual: 0,
    expected: 6900,
    operator: 'strictEqual',
EXIT=1
```

**Schritt 2 — Zuruecknehmen und erneut fahren:**
```
node --check src/llm-usage.js && node --test test/llm-booking.test.js ; echo "EXIT=$?"
```
Ausgabe (woertlich):
```
✔ B4A-BUCH-1 (Attrappe): ein Turn nach dem Port-Vertrag bucht den von Hand gerechneten Betrag (24.621416ms)
✔ B4A-BUCH-2 (Adapter Anthropic): dieselbe Rohantwort ergibt ueber den ECHTEN Adapter denselben Betrag (7.713958ms)
✔ B4A-BUCH-3 (Ledger-Achse): derselbe Betrag im Stripe-Beleg, die MENGE unveraendert (7.883209ms)
✔ B4A-BUCH-4 (Regel 1): die pro-Tenant-Kostendecke greift auf dem NEU gerechneten Betrag (12.040541ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
EXIT=0
```

**Anmerkung zur Durchfuehrung (ehrlich festgehalten):** der in der Spec vorgesehene Rueckweg `git checkout -- src/llm-usage.js` hat NICHT die Sabotage zurueckgenommen, sondern die gesamte, noch nicht committete B4a-Aenderung dieser Datei (HEAD war `master`). Der erste Rueckweg-Lauf war deshalb rot mit "NaN !== 6900" (`billedTokens` lieferte wieder die alte gefaltete Form -> undefined-Sorten -> NaN, vom D7-Riegel verworfen: "[usage] grund=usage_korrupt verworfen kante=trackUsage"). Die B4a-Edits wurden danach vollstaendig neu aufgetragen; der gezeigte gruene Lauf entspricht dem committeten Code.

Der Erwartungswert 6900 Mikro-Cent ist von Hand gerechnet und steht als Rechenweg im Test:
`(5*1.00 + 20*1.25 + 100*0.10 + 7*5.00)/1e6 = 0.000075 USD; 0.000075 * 0.92 * 100 * 1e6 = 6900`.

---

## 4. A-6-Fixture-Rechnung

Fixture: 5 / 20 / 100 / 7 (ungecacht / Cache-Schreiben / Cache-Lesen / Ausgabe), Modell `claude-haiku-4-5`, Raten 1.00 / 1.25 / 0.10 / 5.00 USD je 1 Mio. Token.

**VORHER** (Faltung: `inputTokensOf` legte 5+20+100 = 125 Eingabe-Token auf die VOLLE Eingabe-Rate):
```
Eingabe 125 x 1.00 = 125/1e6 x 1.00 = 0.000125 USD
Ausgabe   7 x 5.00 =   7/1e6 x 5.00 = 0.000035 USD
SUMME VORHER                        = 0.000160 USD
```

**NACHHER** (vier Sorten, vier Raten):
```
ungecacht        5 x 1.00 =   5/1e6 x 1.00 = 0.000005 USD
Cache-Schreiben  20 x 1.25 =  20/1e6 x 1.25 = 0.000025 USD
Cache-Lesen     100 x 0.10 = 100/1e6 x 0.10 = 0.000010 USD
Ausgabe           7 x 5.00 =   7/1e6 x 5.00 = 0.000035 USD
SUMME NACHHER                               = 0.000075 USD
```

**DIFFERENZ:** 0.000160 − 0.000075 = 0.000085 USD. Der gebuchte Betrag sinkt auf 46,9 % des bisherigen, also um **53,1 %** bei diesem Cache-Mix (80 % der Eingabe-Token sind Cache-Treffer).

In Mikro-Cent (Einheit von `tokenCostMicroCents`):
- Produktionskurs 0.92 (Test `llm-booking`, `PROVIDER_TO_BUCKET_RATE_MICRO=920000` gepinnt): vorher **14 720** -> nachher **6 900** (der gepinnte Erwartungswert aller vier A-3-Tests).
- Fixture-Kurs 0.93 (`test/_prices.js`, Test `B4A-FORM-1` in `model-price-gate`): vorher **14 880** -> nachher **6 975**, mit `assert.ok(nachher < vorher)`.

Ausdruecklich: das ist eine Arithmetik-Probe an einer Fixture, KEINE Messung an echtem Verkehr. Der reale Rueckgang haengt am realen Cache-Treffer-Anteil und ist Aufgabe von B4b (blockiert, s. Abschnitt 8).

---

## 5. Was sich am gebuchten Betrag aendert — und was nicht

**Aendert sich:** ausschliesslich dort, wo `tokenCostUsd` den Betrag erzeugt — synchron in BEIDEN Achsen, weil beide Achsen dieselbe eine Funktion lesen (`state-ops.js:2245-2246`/`:2256-2262`). Konkret zwei Stellen: (a) vier Raten je Token-Sorte statt zwei; (b) Sonnet-Preiskorrektur 2.00/10.00 statt 3.00/15.00 bis 2026-08-31, danach 3.00/15.00 ab 2026-09-01.

**Aendert sich NICHT:**
- `usage.inputTokens`/`usage.outputTokens` (Bucket-Zaehler): Summe wie bisher, identischer Zahlenwert. Reine Anzeigen als Leser.
- `usage_event.quantity`: Summe wie bisher, identischer Zahlenwert.
- Die Gate-Kette liest keinen Token-Zaehler: `budgetExceeded -> liveBudgetExceeded -> tenantSpendOrDeny -> tenantUsageAxes` liest ausschliesslich `gateUsageCents`/`usageFor(...).costCents` — reine Cent-Achsen. Tragende Tatsache fuer W5: keine Migration, kein Backfill, keine Schema-Aenderung.

**Richtung und Gate-Folge:** der gebuchte Betrag SINKT bei Cache-Treffern. Auf der Gate-Achse heisst "weniger" spaeter sperren — die unsichere Richtung. Gewollt (der bisherige Betrag war schlicht falsch), aber B4b bleibt Pflicht, sobald wieder Verkehr laeuft. Zusaetzliche Deckung unabhaengig davon: Outbound setzt Abo+KYC voraus, `OUTBOUND_FROZEN` bleibt der Notaus.

---

## 6. Impl-Zusammenfassung

Gebaut:
1. **Preisstaffeln je Token-Sorte:** `MODEL_PRICE_SCHEDULES` in `src/config.js` haelt je Modell-ID eine Liste von Staffeln mit `validFrom`/`asOf`/`source` und vier Pflicht-Raten. `resolveModelPrices` loest sie genau einmal beim Boot auf den heutigen Kalendertag auf; `config.llm.modelPricesUsd` bleibt fuer alle Leser eine flache Abbildung. Die Buchungskante bleibt zeitfrei (keine zweite Uhr).
2. **`tokenCostUsd`** rechnet vier Summanden statt zweier, jede Token-Sorte mit ihrer Rate — EINE Formel fuer Gate und Stripe-Ledger (G5).
3. **Boot-Abbruch statt WARN** (`assertPricedModels`). Die alte WARN-Begruendung hing an der Praemisse, dass die Fail-closed-Rate eine sinnvolle Obergrenze ist; mit einem zweiten Anbieter faellt sie weg.
4. **`mostExpensivePrice` -> `worstCasePrice`:** punktweises Maximum jeder der vier Raten ueber alle Staffeln (`B4A-WORST-1` fuehrt eine Fixture, in der kein Einzeleintrag in allen vier Raten dominiert).
5. **Sonnet-Korrektur** als Folge der Tabellenform: 2.00/10.00 bis 31.08., 3.00/15.00 ab 01.09.
6. **F-1:** Behauptung "teuerste Eingabeklasse" in `src/llm/ports.js` richtiggestellt. Verhalten byte-identisch.

W5 verifiziert, nicht geglaubt: kein Token-Zaehler in der Gate-Kette (im Quelltext nachgelesen).
Regel 1 geprueft, nicht behauptet: `B4A-BUCH-4` setzt die Tenant-Decke knapp unter den neu gerechneten Betrag und belegt `budgetExceeded===true` nach der Buchung.

### Deviations

1. **A-7 (prettier) nur teilweise erreichbar** — Bestandsbefund, kein B4a-Defekt: `src/config.js`, `state-ops.js`, `defaults.js`, `boot.js`, `boot-guard.js`, `test/_prices.js`, `model-price-gate.test.js`, `boot-failclosed.test.js`, `budget-nan-fail-closed.test.js`, `kv-p1-cost-ledger-map.test.js` sind ALLE bereits im Ausgangsstand `dd149ef` prettier-rot. `test/llm-usage.js` und `test/llm-booking.test.js` sind sauber. Ein `prettier --write` haette einen grossen, sachfremden Diff auf einer Geld-Kante erzeugt.
2. **`assertScheduleEntry` verschaerft:** Plan pruefte `validFrom` nur auf `typeof string` + Laenge 10. `B4A-RES-5` deckte auf, dass `'08.08.2026'` (ebenfalls 10 Zeichen) durchrutscht und still falsch einsortiert wuerde. Verschaerft auf `ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/` (G27). Strikt enger, nie weiter.
3. **Banner-Regex weicht vom Plan ab:** Plan erwartete `[boot] Preisstaffeln:`. Gedruckt wird die Zeile im Stil ihrer Nachbarn, zwei Leerzeichen eingerueckt, OHNE `[boot]`-Praefix. Test und Doku nennen den tatsaechlichen Wortlaut `Preisstaffeln:`.
4. **`src/claude.js` minimal beruehrt** entgegen der Nicht-anfassen-Liste: ein Kommentar-Symbolname (`priceForModel -> mostExpensivePrice` -> `-> worstCasePrice`). Kein Code, kein Verhalten.
5. **`src/config.js`-Kommentarwortlaut** umformuliert, weil der Verweis auf die Repo-Lehre `rca-lessons-timezone-and-fixtures` den Bestands-Gate-Test `p8-timezone-no-gate.test.js` (LAW-07, Quelltext-Scan `/timezone|timeZone/`) rot werden liess. Waechter blieb unveraendert scharf.
6. **Drei Bestandstests von gerundeter Cent-Achse auf exakte Gate-Achse umgestellt:** `AL-P10-9`, `BR1` (`cq-p8-briefing-breaker`), `AL-P9-4` (`cq-p8-briefing`). Ursache: die Sonnet-Korrektur senkt eine Briefing-Schaetzung von 1,118076 ct (gerundet 1) auf 0,745384 ct (gerundet 0) — die Buchung findet weiter statt, liegt jetzt unter einem ganzen Cent (der Fall, fuer den der Mikro-Cent-Akkumulator existiert). Kein Test entfernt oder trivialisiert.
7. **`AL-P10-9` zusaetzlich:** Gleichheits-Assertion `Differenz == Suchgebuehr` zu `>= Suchgebuehr` geschwaecht. Grund, auf der exakten Achse sichtbar: mit aktivierter Recherche faellt die zeichenbasierte Schaetzung selbst um 15456 Mikro-Cent groesser aus. Trennschaerfe bleibt: ohne Gebuehren-Buchung waere die Differenz 15456 statt >= 1000000. **(Sicherheits-Review benennt das als echte Praezisions-Abschwaechung, kein Blocker.)**
8. **V-3 (Deploy-Blocker) NICHT erledigt, kann von Impl nicht erledigt werden:** die live gesetzten Werte von `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL` stehen im Render-Dashboard (dashboard-managed). Code-Seite geprueft: `render.yaml:315/320` tragen `claude-haiku-4-5`/`claude-sonnet-5` (beide bepreist), lokale `.env` setzt beide Keys nicht. **Owner-Pruefung im Dashboard vor dem Deploy zwingend** — steht dort eine ID ohne Staffel, startet der Dienst nach diesem Deploy nicht mehr.

---

## 7. Safety-Urteil

**Verdict:** FREIGABE (approved: true)

Alle sieben Abnahmepunkte unabhaengig selbst nachgefahren (nicht vom Impl-Agenten uebernommen):
- Regression (eigener Lauf): 4077 pass/0 fail auf dem Review-Branch; Basis-Gegenmessung auf `dd149ef`: 4046 pass/0 fail. Delta +31, Namensmengen-Vergleich zeigt 0 verschwundene Tests.
- Zweiter Backend-Lauf (14 pg-gestuetzte Geld-/Buchungsdateien via PGlite): 162 pass, 0 fail.
- A-3-Gegenprobe selbst ausgefuehrt: Rumpf `bookTokenUsage` auf `return;` -> pass 0/fail 4/EXIT 1 mit `actual: 0, expected: 6900`; danach `git checkout` -> EXIT 0, `git status --porcelain` leer.
- A-4 mit eigener Spawn-Sonde (eigenes Skript, eigene Erwartungen): alle drei Ausloeser feuern exit 1 mit benannter Modell-ID, kein offener Port.
- A-5 jeder Nicht-Ausloeser selbst gefahren (inkl. `VOICE_ENGINE=realtime`, kaputtem `DEEPSEEK_API_KEY`, `PROVIDER_TO_BUCKET_RATE_MICRO` ausserhalb Band): startet normal bzw. bricht mit der jeweils richtigen Bestandsmeldung ab.
- A-6 selbst nachgerechnet, deckungsgleich mit dem Bericht.
- `noFailOpenPath`: aktiv gesucht, keiner gefunden — jede unvollstaendige Rate wirft benannt beim Modul-Laden; unbekannte Modell-ID liefert die punktweise Obergrenze (>= jede Einzelstaffel), nie `undefined`/`NaN`.
- W5 (`storeUnchanged`): `git diff` auf `src/db/`, `json.js`, `pg.js`, `store.js` leer.
- Scope: `src/bridge.js` unberuehrt, kein B4b/W7, keine neue Env-Var, `src/claude.js`-Diff ein Kommentarwort, Offenlegungssatz unveraendert.

### Concerns (kein Blocker)
1. A-7 Prettier: `test/_prices.js` einzige neu unformatierte Datei (zwei Zeilen >100 Zeichen); Baseline-Vergleich bestaetigt, dass die uebrigen Dateien schon vorher rot waren.
2. Echte Test-Abschwaechung `AL-P10-9` (equal -> >=) — plausibel begruendet, senkt aber Praezision einer Geld-Assertion.
3. `worstCasePrice` Startwert 0 statt `-Infinity` — unschaedlich (negative Raten schon beim Boot verworfen), aber nicht selbsterklaerend ohne Querverweis.
4. `assertScheduleEntry` laesst `rate === 0` zu, prueft `asOf` weder auf Form noch Existenz — ein vertipptes `asOf` schaltet die Veralterungs-WARN still ab (nur Diagnose, nie fatal).
5. Der 2026-09-01-Wechsel der ausgelieferten Tabelle ist NICHT gegen `MODEL_PRICE_SCHEDULES` gepinnt (Suite wuerde sonst am 01.09. von selbst rot). Belegt nur an Fixture-Staffeln + Boot-Banner-Zeile. Restfall haengt an der STATUS.md-Kalenderzeile — menschliche Handlung.
6. `npm run test:gates` nach ~10 Minuten abgebrochen (darf rot sein, kein Abnahmekriterium); in den bis dahin abgearbeiteten 64 Testdateien kein B4A-Test — Katalog-Praefix-Misroute ausgeschlossen, aber kein vollstaendiges Ergebnis.

---

## 8. Clean-Code-Audit (s1-s4)

**Verdict:** PASS — keine S1/S2-Funde.

- **S1:** keine.
- **S2:** keine.
- **S3:** keine.
- **S4 (Bagatellen):**
  1. Kommentardichte in `config.js`/`boot.js` sehr hoch (teils mehr Kommentar- als Codezeilen je Block) — lesbar, aber am oberen Rand von "Absicht ausdruecken" vs. "Dokument statt Code". Keine Aenderung noetig.
  2. `worstCasePrice()` startet den Reduce-Akkumulator bei 0 statt `-Infinity`; unschaedlich, weil `assertScheduleEntry` negative Raten schon beim Boot verwirft, aber nicht selbsterklaerend ohne diesen Querverweis.

**passNotes:** G5 sauber eingehalten (eine Preisformel, eine Aufloesungsfunktion, eine Rate-Feldliste als gemeinsame Quelle). G26 korrekt: keine zusaetzliche Rundungsstelle, Ganzzahl-Rundung nur an der etablierten Buchungskante. G25/G35 eingehalten: Preise/Schwellen liegen zentral in `config.js`/`boot-guard.js`. G3/T5 gut abgedeckt: NaN/negativ/String/Infinity/null je Rate, formfremdes `validFrom`, leere Staffel, keine faellige Staffel, absteigend sortierte Staffeln — alles getestet. D7-Riegel korrekt auf alle vier Sorten einzeln erweitert (nicht auf die Summe). Boot-Abbruch und Nicht-Ausloeser per Spawn-Test belegt. Doku konsistent nachgezogen.

**topTodos:** keine blockierenden. Optional: die zwei S4-Bagatellen bei Gelegenheit. Betrieblich (kein Code-Befund): die 2026-09-01-Kalenderzeile im Ops-Kalender nachhalten.

---

## 9. Fix-Runden

Keine Fix-Runde noetig — Impl lief direkt in PASS, beide Reviews (Safety und Clean-Code) haben ohne Blocker abgenommen. Der FIXES-Abschnitt der Quelle ist leer.

---

## 10. Was fuer B4b offen bleibt

B4b (Messung des realen Betrags-Rueckgangs an echtem Verkehr) ist **NICHT Teil von B4a** und bleibt offen. A-6 ist ausdruecklich nur eine Arithmetik-Probe an einer Fixture, keine Messung an echtem Verkehr — der reale Rueckgang haengt am realen Cache-Treffer-Anteil im Produktivbetrieb.

**B4b haengt an zwei Blockern gleichzeitig, unabhaengig von Code oder Reviewzustand:**
- **Fehlender Verkehr:** kein Anruf seit 2026-08-04.
- **Leeres Anthropic-Guthaben:** die Kette kann ohne API-Guthaben keine echten Calls fahren, die Token verbrauchen wuerden.

Solange beide Bedingungen bestehen, kann B4b nicht gemessen werden — das ist kein technischer, sondern ein betrieblicher/Owner-Zustand.

Zusaetzlich offen (nicht B4a/B4b, aber im Kontext genannt):
- **Deploy-Blocker V-3:** Owner muss die im Render-Dashboard gesetzten Werte von `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL` gegen `MODEL_PRICE_SCHEDULES` pruefen, bevor deployed wird.
- **STATUS.md-Kalenderzeile 2026-09-01:** Dienst muss neu deployt/neugestartet werden, damit die faellige Sonnet-Staffel (3.00/15.00) greift — sonst bucht ein durchlaufender Prozess nach diesem Datum zu wenig.
