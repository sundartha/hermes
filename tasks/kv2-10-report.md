# Detailbericht Phase KV2-10 — Zweiteiliger Tarif, deckungs-unabhaengiger Boden, Boot-Waechter

- **Phase:** KV2-10 (Kosten-V2-Kette, Grundlage `tasks/PLAN-KOSTEN-V2.md` Abschnitt KV2-10, Owner-Entscheidungen 5/6, Katalogzeile #8, K6)
- **Gate:** PASS
- **Final Branch:** `phase/kv2-10-impl-fix1`
- **Head-Commit (Impl):** `2d24c019eb6225e8f1ef0423ee2d6519bb47e47a`
- **Review-Branch (Safety):** `review-kv2-10-r1` (= `phase/kv2-10-impl-fix1`, `9f79f25`)

---

## 1. Plan (gekuerzt)

**Ziele:**

- **Tarifpaar-Waechter:** misst je Route (Kostenprofil) aus gesettelten, voll belegten Anrufen die Vollkosten (Belegsumme + Eigen-Achsen #4/#5), leitet per p95 ein Paar (Grundbetrag + Minutensatz) her, prueft das konfigurierte Paar dagegen. **Justiert nichts** (Owner-Entscheidung 6).
- **Boden-Waechter:** `voiceTariffFloorFindings` feuert kuenftig auf `belowFloor` ALLEIN (deckungs-unabhaengig, Kriterium (c)); Deckung wird Nachrichten-Kontext, nie Ausloeser.
- **Boot-Waechter:** `warnTarifpaar` einmal je Start nach `warnTariffDrift` (Kriterium (e)).
- **Sweep-Kanal:** `TARIFPAAR_UNTERSCHAETZT` meldet VOLL (Mail+SMS) ueber den KV2-1-Kanal (Kriterium (d)).
- **Waehrungs-Klarstellung** an `PLATFORM_FIXED_COST_CENTS_PER_MONTH` (USD-Listenpreis statt falsch gelabelter EUR-Cent, Katalogzeile #8); Boden-Neuherleitung 10 -> 15.

**Zentrale Design-Entscheidung (Eigen-Achsen, R9-2):** runtime existiert KEINE je-Anruf-Quelle fuer Eigen-Achsen (#4/#5): Briefing/Eroeffnungssatz buchen `callId: null`, `research_fee` schreibt kein `usage_event`. Eine Summe aus `usageEvents` waere strukturell unvollstaendig (R9-2-Unterschaetzung). Der Waechter nimmt Eigen-Cent je Anruf daher als **injizierte Quelle** (`eigenCentJeAnruf`, Default `null`): `null` = benannt "keine je-Anruf-Quelle" -> jede Stichprobe wird verweigert (`fehlgrund=eigen_achsen`), Report meldet `tarifpaar_zu_wenig_proben` — laut, nicht alarmierend, in jeder Sweep-/Boot-Zeile sichtbar. Kein geratener Zuschlag, keine tenant-weite Mittelung, kein toter Bauform-Zweig. Die Luecke ist benannter offener Punkt (Phasenbericht + `.env.example`); Schliesser waere eine per-Call-Erfassung der Eigen-Achsen — eigene Phase nach KV2-10.

**Scope-Riegel:** keine Reserve-Formel-Aenderung, kein Safety-Gate, kein Settlement, kein Store/Schema, keine neue Route, keine neue npm-Dependency. Der neue Grundbetrag wird von KEINER Reserve-Rechnung gelesen.

**Blast-Radius (Plan):** 7 src-Dateien, 4 mit Verhaltensaenderung; 2 neue Test-Dateien.

---

## 2. Impl-Zusammenfassung

Umgesetzt auf `phase/kv2-10-impl-fix1` (Head `2d24c01`), `node --check` OK, Suite gruen (5675/5675 im Impl-Lauf), Smoke gruen, ESLint 0 Errors ohne neue Suppressions, committed.

**(1) Tarifpaar-Waechter** in `src/billing/cost-calibration.js`: p95-Idiom extrahiert (`nearestRankWert`, G5: ein Idiom fuer Praefix- und Routen-Waechter); Vollkosten = Belegsumme (ueber DIE EINE Kursfunktion `providerMicroCentsToBucketCents`) + Eigen-Cent als injizierte Quelle `eigenCentJeAnruf` (Default null -> `eigen_achsen`-Verweigerung, `tarifpaar_zu_wenig_proben` laut und nicht alarmierend); fuenf benannte Ausschlussgruende (`herkunft`, `beleg_unvollstaendig`, `eigen_achsen`, `ueberlauf`, `minuten`); Funktionen `vollkostenCentsJeAnruf`, `vollkostenStichprobenJeRoute`, `tarifpaarVorschlag`, `tarifpaarDecktStichproben`, `tarifpaarEintrag`, `tarifpaarReport`, `alertbareTarifpaarBefunde`, `tarifpaarZeile` — rein, justiert nichts.

**(2) Boden-Waechter** (`src/boot-guard.js`): feuert seit KV2-10 auf `belowFloor` ALLEIN; `thinCoverage`-Variable entfernt (kein toter Code); Message behaelt die Substrings `Abgleich-Deckung N%` und beide Env-Namen als Kontext; bleibt WARN, nie fatal. Diagnose, kein Geld-Gate — Regel 1 unberuehrt.

**(3) Boot-Waechter** (`src/boot.js`): `warnTarifpaar` einmal je Start direkt nach `warnTariffDrift`, eine Zeile fuer ALLE Routen; kein SMS/Mail am Boot.

**(4) Sweep-Kanal** (`src/billing/cost-truing.js`): `TARIFPAAR_UNTERSCHAETZT` in `COST_TRUING_FINDING`; `VOLL_BEFUND_CODES` erweitert -> VOLL (Mail+SMS) wie die Deckungs-Klassen; GENAU EIN Befund fuer alle unterschaetzten Routen (WARN-Muedigkeit); `eigenCentJeAnruf` injiziert statt Lazy-Init (P15); Aufruf nach `reportTariffDrift` in `sweepAllCandidates`.

**(5) Konfiguration** (`src/config.js`, `.env.example`, `render.yaml`): neu `voiceTariffGrundbetragCentsJeRoute` aus Env `VOICE_TARIFF_GRUNDBETRAG_CENTS` (csv-Karte `profil:cents`, fail-closed via `fatalConfigErrors`, Default `{}` = alle Routen 0); Boden-Fallback `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` 10 -> 15 (Herleitung: 0,1576 USD x 0,92 = 14,5 -> 15).

**(6) Waehrungs-Klarstellung:** Key `platformFixedCostCentsPerMonth` -> `platformFixedCostUsdCentsPerMonth` (Env-Name unveraendert); `platform-costs` (`src/routes/api-billing.js`) rechnet 600 US-ct ueber DEN EINEN Kurs zu 552 EUR-ct und gibt den USD-Listenpreis separat mit; Kurs-Ueberlauf -> 500 mit Diagnose statt stiller 0.

**(7) `src/billing/kostenarten.js`:** Kommentar-Fix Katalogzeile #8 (EL-Grundgebuehr = USD-Listenpreis, seit KV2-10 ueber den EINEN Kurs umgerechnet).

**Dateien:**

- Neu: `test/fixtures/kostenv2-vollkosten-stichprobe.js`, `test/kv2-10-tarifpaar.test.js` (16 Tests)
- Editiert (src): `cost-calibration.js`, `cost-truing.js`, `kostenarten.js`, `boot.js`, `boot-guard.js`, `config.js`, `routes/api-billing.js`
- Editiert (sonst): `.env.example`, `render.yaml`, `test/api-platform-costs.test.js`, `test/auth-p6-operator-routes.test.js`, `test/config-money-manifest.test.js`, `test/config-namespaces.test.js`, `test/kv-p2-inbound-budget.test.js`, `test/voice-budget-reconcile-finishcall.test.js`, `test/voice-tariff-full-cost-guard.test.js`

**Smoke:** Server PORT=3997, `/healthz` 200; Boot-Log enthaelt `[boot] Tarifpaar: route=el_convai_sip proben=0 fehlgrund=keine befund=tarifpaar_zu_wenig_proben | ...` (alle 5 Routen, sichtbar-wartend); KEINE Vollkostenschwellen-WARN (Tarif 20 >= Boden 15).

### Abweichungen vom Plan (deviations)

1. **Fixture folgt der MESSUNG (O2), nicht dem Plan-Klammerkommentar:** Plan nannte fuer den 76-s-Festnetz-Anruf "2 x 0,0401 USD"; O2 misst Festnetz 0,0231 USD/min (billed_sec=120, cost=0,0462 USD). Vorschlag damit **(20,18)** statt plan-pinnend (23,18); Gegenprobe ohne Eigen-Cent **(17,15)** statt (20,15). Alle geforderten Eigenschaften bleiben erhalten (Paar deckt alle 8 am p95, unabhaengig per `tarifpaarDecktStichproben` bewiesen; Gegenprobe strikt niedriger, R9-2; (0,20)=im_band, (0,10)=tarifpaar_unterschaetzt). Boden 15 unveraendert.
2. **KV-P2-5-Bestandstest angepasst:** pinnt jetzt GENAU ZWEI legitimierte Lesestellen von `billing.voiceTariffInboundCents` — `metering.js` (Buchung) und `cost-calibration.js` (Waechter-Vergleich, misst/bucht nichts) — statt einer.
3. **`test/voice-budget-reconcile-finishcall.test.js` gehaertet:** vorbestehende Race (nicht erwartete Promise aus `terminateAndBillCall`, Store-Schreiben erst nach await), reproduzierbar seit Suite-Wachstum; Test pollt jetzt bis zur Buchung (Frist 3 s), Assertions unveraendert scharf. Keine Produktionsaenderung.
4. **`makeCostTruing` bleibt bei exakt 292 gezaehlten Zeilen:** der Pre-Commit-Hook pinnt die Befund-IDENTITAET inklusive Zeilenzahl — kein Zuwachs ohne Owner-Freigabe. Deshalb liegt `meldeTarifpaar` auf Modul-Ebene; eine rein formatierende Zeilenzusammenfuehrung in `emitFailure` hebt den einen Zuwachs auf. Suppressions-Datei unveraendert, Gate-Exit 0.
5. **`fehlgrund=` in der Zeilenausgabe ist der GLOBALE Ausschluss-Zaehler** (Funktionsvertrag liefert genau eine Map<fehlgrund, anzahl>), gerendert auf jeder `zu_wenig_proben`-Zeile; am Code kommentiert (die EIGEN_ACHSEN-Quelle ist eine prozessweite Luecke, kein Routen-Merkmal).

---

## 3. Safety-Urteil (final)

**FREIGEGEBEN.** `approved: true`, keine Blocker.

- **Tests unabhaengig gefahren** (Review-Branch `review-kv2-10-r1`, `9f79f25`): Volllauf 5677 Tests, 5655 pass / 3 fail — alle drei Spawn-Last-Flakes. Deterministisch aufgeteilt nachgestellt: 5630/5630 gruen + 47/47 isoliert fuer `test/el-consult-neustart.test.js` => alle Tests gruen ohne Spawn-Parallellast. Kontrolle auf sauberem master (`7bb57df`): 1 fail an ANDERER Stelle — Flakiness vorbestehend, umgebungs-, nicht branch-bedingt. Beide Backends im selben Lauf abgedeckt (json-Spawn-Default plus PGlite/PG). `node --check` und ESLint OK.
- **Absolute Regeln:** Null-Diff auf `claude.js`/`bridge.js` (Offenlegung), `callee-is-owner`, gesamtes `src/telephony/` (Outbound-Gates), `src/store/`, Auth/Middleware/route-policy. Floor-Guard wurde STRENGER (deckungs-unabhaengig, Fallback 10->15; Prod-Tarif 20 >= 15, kein Schein-Alarm). Neue Env-Karte fail-closed (Boot-Refusal), in `config.js` + `.env.example` + `render.yaml` + BASE_ENV gepinnt. Keine neuen Endpunkte, keine npm-Dependencies, keine Secrets/PII in neuen Logs/Meldungen (testgepinnt).
- **Kein Regler:** nichts justiert automatisch; der Grundbetrag wird von KEINER Reserve-Rechnung gelesen (einziger Leser ist der Waechter, per grep belegt).

**Concerns (keine blockiert):**

1. Vorbestehende Last-Flakiness der Spawn-Suite (3 fails im Branch-Volllauf, 1 fail auf master, ein kompletter Hang in `el-consult-neustart.test.js`) — vorbestehend, aber der Hang verdient einen eigenen Auftrag.
2. Dokumentierte Abweichung vom Plan-Klammerkommentar (Vorschlag (20,18)/(17,15) statt (23,18)/(20,15)) — korrekt entschieden zugunsten der Messquelle O2, transparent dokumentiert; Owner sollte die Zahl zur Kenntnis nehmen.
3. KV-P2-5 Struktur-Riegel: eine Lesestelle `voiceTariffInboundCents` -> zwei legitimierte (Buchungsquelle bleibt einzig); dokumentierte Aufweitung eines Invarianten-Tests.
4. Bis eine je-Anruf-Quelle fuer die Eigen-Achsen existiert, loggt JEDER Boot und JEDE Sweep eine `tarifpaar_zu_wenig_proben`-Zeile (sichtbar-wartend per Design) — Dauer-WARN-Rauschen als bewusster, im Code benannter Trade-off.
5. Kleinigkeiten: `eigenCent=3 ct/anruf` in der Fixture ist modelliert, korrekt als "NICHT gemessen" markiert (runtime rät der Waechter nie, er verweigert); Race-Fix in `voice-budget-reconcile-finishcall.test.js` nur Test, kein src-Verhalten.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS — keine S1/S2-Verstoesse.** S1-Achse sauber: neues Verhalten durchgehend getestet (Herleitung, R9-2-Gegenprobe, alle 5 Ausschlussgruende einzeln, PII-Riegel, Kanal, Boot-Spawn, Config-Pins, BASE_ENV-Klemme, Kurs-Ueberlauf-500). Geld durchgehend Ganzzahl-Cent, "nicht berechenbar ist nicht kostet nichts" konsequent (null statt 0, 500 statt stiller Summe, `zu_wenig_proben` statt geratener Messung). Kein Safety-Gate beruehrt (Boot-Guard feuert eher mehr). S2 vorbildlich: ein p95-Idiom (`nearestRankWert`), Spione zu `fakeSpies` konsolidiert, EINE Route-Liste aus `KOSTENPROFIL`. P15: Injektion statt Lazy-Init. Fixture kennzeichnet modellierte Werte und dokumentiert die Abweichung zugunsten der Messung. Kommentare deutsch ohne Umlaute (ein Umlaut-Rest in `boot.js:995` ist unveraenderter Bestand). Vollsuite im Worktree zweimal: Lauf 1 5676/5677 (1 Flok), Lauf 2 komplett gruen.

**S3 (bewusste Ausnahmen, dokumentiert):**

- **s3-1** C2/G20 · `test/voice-tariff-full-cost-guard.test.js:91` — Testname (q2) sagt noch "Guard feuert nur in der Konjunktion"; diese Begruendung ist seit KV2-10 falsch. Klammerzusatz anpassen.
- **s3-2** G5/G22 · `src/billing/cost-calibration.js:240` `INBOUND_KOSTENPROFILE` — das Wissen "welche Profile Inbound sind" liegt zweit-hand neben der Registry; ein kuenftiges drittes Inbound-Profil muesste hier erinnert werden. Richtung als Feld in die Registry ziehen, sobald die Registry beruehrt werden darf (bewusst unberuehrt gelassen — akzeptiert).
- **s3-3** G24/G16 · `src/billing/cost-truing.js:711` — meldung-Objekt fuer das gepinnte max-lines-Budget in eine Zeile gequetscht; bei naechster Beruehrung Pinhoehe neu verhandeln statt Formatting zu opfern.

**S4 (Haertungs-/Aufraeum-Punkte):**

- **s4-1** F4/G8 · `src/billing/cost-calibration.js:96,259` — `nearestRankWert` und `vollkostenCentsJeAnruf` sind exportiert ohne externen Aufrufer; Export auf module-lokal zuruecknehmen.
- **s4-2** G3/G26 · `src/billing/cost-calibration.js:338-345` — bei `minSamples<=0` UND `proben=0` greift `tarifpaarZeile` auf `eintrag.vorschlag.grundbetragCents` zu (TypeError). Ueber die einzige Prod-Quelle nicht erreichbar (`numEnv min:1`), aber nur durch eine Config-Invariante geschuetzt — haerten.
- **s4-3** G3 · `src/config.js:583` `routeCentsEnv` — doppeltem Profil-Key in der csv-Karte ueberschreibt still den ersten Eintrag; Umgebung sonst durchgaengig fail-closed — doppelten Key ebenfalls in `fatalConfigErrors` melden.

**Top-Todos:** (q2)-Testnamen anpassen; `routeCentsEnv` doppelten Profil-Key fail-closed ablehnen; ungenutzte Exporte module-lokal machen und `tarifpaarZeile` gegen `vorschlag===null`-Randfall haerten.

---

## 5. Fix-Runden

- **r1 (final: `phase/kv2-10-impl-fix1`):** Alle drei Review-Blocker der Phase KV2-10 behoben, minimal und ohne Scope-Drift. (1) Randbedingung 3: `test/helpers.js` BASE_ENV pinnt `VOICE_TARIFF_GRUNDBETRAG_CENTS` neutral leer (`""` = fail-closed Default `{}`), wie jede Schwester-Variable; empirisch belegt am Spawn-Boot. (2)–(3) siehe Branch-Historie; Ergebnis: Gate PASS, Suite gruen, Smoke gruen.
