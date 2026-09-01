# Phase KV2-8 — Das Settlement (der Geld-Umschalter)

- **Gate:** BLOCKED
- **finalBranch:** `phase/kv2-8-impl-fix2`
- **Basis:** `master` @ `0fe7008` (KV2-7 gemergt)
- **headCommit (Impl):** `c9ebe5880986c71cbc8a02f5884b4c9a20e19066`

---

## 1. Plan (gekürzt)

### Sperre vor dem ersten Edit
Die Spec macht KV2-8 von der Telnyx-Messung KV2-5(d) abhängig: ohne sie darf die Phase nicht begonnen werden. Am Code stand `KOSTENPROFILE[el_convai_sip].pflichttypen = PFLICHTTYPEN_UNGEMESSEN` mit Verweis auf einen fehlenden `TELNYX_API_KEY`. Neuer Befund der Planung: `.env` trug den Key, das Messskript lud nur kein dotenv. Schritt 0 (kein Code-Change): Messskript mit geladenem `.env` + Positiv-Kontrolle laufen lassen; nur bei grüner Positiv-Kontrolle darf `el_convai_sip.pflichttypen` auf die gemessene Menge eingefroren und KV2-8 begonnen werden.

### Zwei harte Randbedingungen
1. **Lint-Pin `cost-truing.js`**: Die Datei steht unter `eslint-suppressions.json` (nicht in den Legacy-Exceptions). `makeCostTruing` muss bei **292 Zeilen**, `trueOneCall` bei **Komplexität 12** bleiben — sonst lehnt das pre-commit-Gate den Commit ab, weil sich die Lint-Meldung (inkl. Zeilenzahl) ändert. Neue Logik gehört auf Modul-Ebene / in neue Module.
2. **EL-Riegel bleibt**: Die Spec-Begründung würde EL-Anrufe ins Settlement laufen lassen; das gemergte Abnahmekriterium KV2-5(h) verlangt aber `korrekturAufrufe === 0` für die 12 EL-Altanrufe. Entscheidung: `sweepDarfKorrigieren` ruft `applyCostCorrectionCents` für `el_convai_sip` weiterhin nie — schärfer als die Spec, in der sicheren Richtung. Nachbuchen für EL wandert nach KV2-9 (Report-Punkt an den Lead).

### Neue Datei: `src/billing/kosten-projektion.js`
Reines Regelwerk (kein Store/Netz/`console`/`await`), Import-Richtung strikt einseitig.
- `istVollBelegt({profil, pflichtTraeger, fehlend})` — der Allquantor-Riegel: über der leeren Pflichtmenge ist „alles belegt" sonst trivial wahr; die Funktion verlangt zusätzlich ein bekanntes Profil und eine nicht-leere Pflichtmenge.
- `settlementProjektion({call, belege})` — liefert `profil`, `pflichtTraeger`, `fehlend`, `summeMikroCents` (NULL statt 0, wenn nichts summierbar oder aus dem sicheren Ganzzahlbereich raus) und `vollBelegt`.
- `belegSummeJeTraegerFuerMonat({state, monthKey})` — Träger-Trennung für die Monats-Gegenprobe, gruppiert über `estimatedCostSpendMonthKey` und `costTruedAt !== null`.

### Edits an Bestandsdateien
1. **`src/store/defaults.js`** — zwei neue `COST_TRUING_SOURCE`-Werte (`KOSTENBUCH_VOLLBELEG`, `KOSTENBUCH_TEILBELEG`) + `istBeweisendeHerkunft(source)` als EINE Quelle für vier Leser (`coverageBreakdown`, `countOutcome`, `isDriftSample`, `truedSourceOf`) statt vier Einzelvergleichen.
2. **`src/store/cost-evidence.js`** — `summierbareBelegzeilen(zeilen)` aus `costEvidenceSumMicroCents` herausgezogen, damit die Projektion „gibt es überhaupt eine summierbare Zeile" beantworten kann, ohne die Bedingung zweimal zu formulieren.
3. **`src/billing/cost-truing.js`** (Kern der Phase):
   - `sweepDarfKorrigieren` bekommt einen dritten Riegel: nur wenn `projektion.summeMikroCents` ein gültiger Anbieter-Mikro-Cent-Betrag ist.
   - Neue Modul-Funktion `setteleAnruf({call, projektion, store, config})` — EIN Settlement-Rumpf für beide Schließpfade (Mess-Lauf und Fälligkeits-Lauf).
   - `bucheKorrektur` wird zu `projektionVon(call)` (nur Store-Beschaffung).
   - `refundProven` entfällt ersatzlos (beide Hälften leben an ihren richtigen Stellen weiter).
   - `truedSourceOf` bekommt die neuen Herkunftswerte, fallabhängig (Pool vollständig+Schätzung → `kostenbuch_vollbeleg`, Pool unvollständig+Frist abgelaufen → `kostenbuch_teilbeleg`, sonst wie bisher).
   - `countOutcome`/`coverageBreakdown` (der vom Plan selbst als „vierter, ungenannter Leser" identifizierte Zähler) laufen über `istBeweisendeHerkunft` statt `=== DETAIL_RECORDS` — ohne diesen Mitzug wäre die Deckungsquote nach Deploy dauerhaft auf 0 % gefallen.
   - `trueOneCall`: Projektion wird NACH `abschlussNachMessung` gebildet (das Buch von „jetzt", nicht von „gestern"); `store.recordCallCostTruingResult` bekommt `actualCostMicroCents: projektion.summeMikroCents`.
   - `schliesseFaelligeOffene` settelt jetzt statt nur zu schließen: `setteleAnruf` + `store.schliesseKostenAbgleich` mit Herkunft (`herkunftOhneMessung`) und Betrag.
4. **`src/store/state-ops.js`** — `schliesseKostenAbgleich` nimmt ein Optionsobjekt (`{closedAt, source=null, actualCostMicroCents=null}`) statt eines dritten Positionsarguments; set-once bleibt erhalten. Weiterreichung in `store.js`, `json.js`, `pg.js`, Test-Harness.
5. **`src/billing/cost-calibration.js`** — `isDriftSample` über `istBeweisendeHerkunft` statt Direktvergleich; ungenutzter `COST_TRUING_SOURCE`-Import entfernt.
6. **`src/billing/cost-cross-check.js`** — Träger-Trennung der Monats-Gegenprobe: `call.actualCostMicroCents` ist jetzt die Summe über ALLE Träger; die Rechnungs-Differenz darf nur noch gegen Telnyx-Träger gebildet werden (`TELNYX_SWEEP_TRAEGER`, neu in `sweep-kostenbeleg.js`), sonst würde ein EL-Anruf (`provider: telnyx`) gegen eine Telnyx-Rechnung mitgerechnet.

### Tests (Plan)
- `test/kv2-8-settlement.test.js` — Matrix mit 10 Lagen × 2 Richtungen (Ist>Schätzung / Ist<Schätzung), Vakuositätstest für `istVollBelegt`, Zweit-Settlement-Idempotenz, Rundungstest (gerechnet, nicht abgeschrieben), Enum-Vollständigkeitstest, Vorzeichen/Typ-Test, vergleichende Erstattungs-Regression (Arm A = neuer Sweep, Arm B = nachgebauter Altpfad).
- `test/kv2-8-cent-schreibstellen.test.js` (Abnahme h) — dauerhafter Scanner über `state-ops.js`: nur `bookCents` und `applyCreditCents` dürfen `.costCents` schreiben, mit Positiv-Kontrolle gegen eine Fixture mit drittem Schreiber.
- `test/kv-m4-monthly-cross-check.test.js` — Log-Format gezogen, neue Fälle für Träger-Trennung.
- Fünf Bestandstests mit dem geschriebenen `costTruedSource`-Wert von `telnyx_detail_records` auf `kostenbuch_vollbeleg` gezogen.

### Pre-Mortem (Auszug)
- Deckungsquote fiele auf 0 % → durch den vierten Leser (`coverageBreakdown`) abgefangen.
- Doppel-Settlement eines Anrufs → `costTruedAt` set-once + sich ausschließende Schließpfade.
- Leere Pflichtmenge macht `dataComplete` fälschlich wahr → `istVollBelegt` verlangt `pflichtTraeger.length > 0`.
- EL-Altanrufe bekommen doch eine Erstattung → EL-Riegel unangetastet, KV2-5(h) bleibt grün.
- Monats-Gegenprobe vergleicht EL gegen Telnyx-Rechnung → Edit 6 im selben Commit.

### Report-Punkte an den Lead (Plan)
1. Owner-Entscheidungen 10/11/12/14/15/16 laufen als Default weiter.
2. EL-Riegel bleibt (§1.2) — Nachbuchen für EL wandert nach KV2-9.
3. Matrixzeile „Profil unbekannt, Anruf nach der Kette" ist am Datenmodell nicht von der Altzeilen-Zeile zu unterscheiden — geerbte KV2-5-Lücke, Rückfrage nötig.
4. Vierter Leser von `DETAIL_RECORDS` (`coverageBreakdown#proven`) gefunden und mitgezogen.
5. Verschärfung: Telnyx-Anruf mit `actualCostMicroCents === 0` bei `billedSec > 0` bekommt ab KV2-8 keine Erstattung mehr (statt volle Schätzung wie im Bestand) — von Matrix 4.6 gefordert.
6. `state-ops.js`-Lint-Pin: Edit 4 soll den Findings-Block nicht bewegen, sonst Report-Punkt.

---

## 2. Impl-Zusammenfassung

- **headCommit:** `c9ebe588`
- `node --check`: PASS
- Tests: PASS, **5598/5598** grün
- Smoke: PASS — Server-Boot mit Dummy-Env, `/healthz`=200, `/api/plans`=200, `POST /voice/incoming`=200 (Bypass), Operator-Sweep-Route 404 ohne OIDC (fail-closed wie vorgesehen); zwei vorherige Boot-Abbrüche waren korrekte fail-closed-Meldungen (fehlende Env), keine Regression.
- Neue Dateien: `src/billing/kosten-projektion.js`, `test/kv2-8-settlement.test.js`, `test/kv2-8-cent-schreibstellen.test.js`.
- Geänderte Dateien: `cost-truing.js`, `cost-cross-check.js`, `cost-calibration.js`, `kostenarten.js`, `sweep-kostenbeleg.js`, `defaults.js`, `cost-evidence.js`, `state-ops.js`, `json.js`, `pg.js`, `befund-telnyx.md`, plus 7 Testdateien (Herkunftswert-Pins, Harness-Signaturwechsel, P7-Anker-Fixtur).

### Deviations (vom Plan-Wortlaut)

1. **§0-Sperre — Abweichung, Owner-Entscheidung nötig.** Die Messung KV2-5(d) lief und ist grün: `el_convai_sip.pflichttypen = ["sip-trunking"]`, anker-stabil gegen zwei unabhängige Ankermengen. Die vom Plan vorgeschriebene Positiv-Kontrolle (`KV2_5_KNOWN_CALL_CONTROL_ID`) war aber NICHT fahrbar — Produktions-DB-Zugriff in der Session gesperrt, und die zwei dokumentierten `call_control_id`-Präfixe sind aus dem Anbieter-Fenster gealtert (0 von 224 Treffern). Ersatz: eine `sip_call_id`-basierte Kontrolle, die zeigt, dass die Abfrageform nicht kaputt ist, aber die vom Plan geforderte Kontrolle nicht ersetzt. Vollständig dokumentiert in `tasks/kostenv2/befund-telnyx.md`.
2. **`truedSourceOf` — eine Klausel mehr als im Plan, fail-closed.** Der Plan-Rückfall `return measured.source` hätte im no-estimate-Zweig bei unvollständigem Buch `telnyx_detail_records` liefern können — Verletzung der eigenen Abnahme (e) („ein el_convai_sip-Settlement schreibt nie telnyx_detail_records"). Ergänzt: ohne `vollBelegt` wird eine beweisende Herkunft auf `incomplete` heruntergesetzt. *(Anmerkung: genau dieser Zweig wurde in der Safety-Review als B1-Blocker identifiziert und in der ersten Fix-Runde behoben — s.u.)*
3. **`trueOneCall` — Settlement hängt am Abschluss statt an der Messung.** Statt `if (measured && closed) { settele }` wurde `if (closed) setteleAnruf(...)` separat gezogen: ein per Frist geschlossener Anruf ohne Messung hätte sonst nie gesettelt. Zugleich stellt dieser Schnitt den gepinnten Komplexitäts-Wert 12 her (der Plan-Schnitt landete bei 11).
4. **Lint-Pins beide exakt getroffen und nachgemessen** — `cost-truing.js` zeichengleich zur alten Befundmenge (292 Zeilen / Komplexität 12), `state-ops.js`/`pg.js` deckungsgleich mit ihrem Legacy-Pin. Keine eslint-Datei angefasst, kein `--no-verify`.
5. **Matrix 4.6 Realisierbarkeit**: es existiert kein Nicht-EL-Profil mit mehr als einem Pflicht-Träger; Zeilen 2–5 sind auf Ein-Träger-Telnyx-Profilen gebaut, Zeile 8 ist am Datenmodell nicht von Zeile 6 zu unterscheiden (geerbte KV2-5-Lücke, Report-Punkt 3 des Plans).
6. **`test/ks-p5-current-period-credits.test.js` musste angepasst werden** (Report-Punkt 5 des Plans, live eingetreten): Fixtur mit Betrag 0 bei `billed_sec 60` erzeugt seit KV2-5 keine Belegzeile mehr → seit KV2-8 keine Erstattung statt voller Rückerstattung. Auf 1 Mikro-Cent je Record geändert, Testzusage (volle Rückerstattung) bleibt wörtlich erhalten.
7. **`outbound-drift-watch.js#verbrauch24hMicroCents`** liest weiterhin `call.actualCostMicroCents`, das jetzt Summe über alle Träger ist — NICHT editiert (Plan-Vorgabe), Zahl wird vollständiger statt falsch, hier benannt.
8. **`npm run test:gates`**: 126/129 grün, 3 rot (GAP-05, GAP-15, E2E-03) — alles i18n-/Legal-Befunde ohne Bezug zum Kosten-Pfad, unverändert gegenüber master, Gates-Bahn darf rot sein.

---

## 3. Safety-Urteil (finale Runde)

**approved: false** — alle vier harten Achsen intakt (Safety-Gates, Offenlegung, Auth fail-closed, keine Secrets), aber BLOCKIERT wegen zwei Befunden.

### Blocker

**B1 (Code-Blocker, am laufenden Sweep reproduziert).** `truedSourceOf` verletzte die eigene, drei Zeilen tiefer ausformulierte Invariante von Abnahme (e): im no-estimate-Zweig (`!isBookableCents`) fiel bei unvollständigem Kosten-Buch `measured.source` unverändert durch — das konnte `telnyx_detail_records` sein. Regression gegen master (dort mappte dieser Zweig immer auf `no_estimate`). Reproduziert: `vollBelegt=false source=telnyx_detail_records beweisend=true actual=4010000`, Anruf wurde fälschlich Drift-Stichprobe (`samples=1, p95=4010000`) — genau der „Alarm gegen die eigene Datenlücke", den die Phase schließen sollte. Kein Geldeffekt, aber ein falscher Tarif-Drift-Alarm. Zusätzliche Testlücke benannt: Abnahme (e) verlangt, jeden Enum-Wert durch `truedSourceOf` zu schicken — das geschah nicht.

**B2 (Owner-Entscheidung, nicht vom Bau-Agenten zu beheben).** Die Spec-Sperre KV2-5(d) ist nur mit einer ausdrücklich als Abweichung gemeldeten Ersatz-Positiv-Kontrolle erfüllt (s. Deviation 1); der Branch entfernt zugleich den master-Satz „KV2-8 bleibt damit blockiert (Spec KV2-5(d))" aus `kostenarten.js`, während die Freigabe noch aussteht. Technisch eingedämmt (`PFLICHTTYPEN_UNGEMESSEN` bleibt fail-closed, betrifft nur `el_convai_sip`, EL bewegt in dieser Phase keinen Cent) — aber ein Geld-Umschalter darf nicht über eine offene Spec-Sperre hinweg gemergt werden.

### Concerns (nicht blockierend)
- **C1**: `schliesseFaelligeOffene` bucht zuerst (`setteleAnruf`), latcht erst danach (`schliesseKostenAbgleich`) — umgekehrte, unsichere Reihenfolge gegenüber `trueOneCall` und master; schmales Durabilitätsfenster für Doppelbuchung bei Prozessabsturz dazwischen.
- **C2**: veralteter Kommentar an `oeffneKostenAbgleichErneut` behauptet noch „bis KV2-7 kein Cent bewegt" — stimmt ab KV2-8 nicht mehr (heute unschädlich, weil nur EL betroffen und EL vom Geldweg ausgeschlossen).
- **C3**: `settlementProjektion` summiert über ALLE Belegzeilen, nicht nur Pflicht-Träger — heute harmlos (nur zwei Einsammler), Risiko für Doppelbuchung sobald ein dritter Einsammler eine bereits anderweitig gebuchte Kostenart schreibt (z.B. `ai_token`).
- **C4**: dokumentierte Verhaltensänderung (Betrag 0 bei billedSec>0 erstattet nicht mehr voll) — konservative Richtung, aber nicht byte-identisch zum Bestand.
- **C5**: Abnahme-(i)-Vergleichstest nutzt einen nachgebauten statt den echten alten Pfad, ohne `chargeAnchors`, nur zwei Achsen verglichen.
- **C6**: Diff geht über die Spec-Dateiliste hinaus (Signaturwechsel `schliesseKostenAbgleich`, Extraktion `summierbareBelegzeilen`, Verschärfung `kostenprofilFuerAnruf`) — sachlich begründet und getestet, aber vermerkt.
- **C7**: kein Feature-Flag — der Geld-Umschalter geht mit Merge unbedingt live, Rollback nur per Revert.

---

## 4. Clean-Code-Audit (final)

**verdict: PASS** — keine S1/S2-Blocker. Voller `npm test`-Lauf grün (5618/5618 sauberer Re-Run), alle 47 gezielten KV2-8-Tests grün.

- **s1**: keine
- **s2**: keine
- **s3** (informativ):
  - N7 (Nebeneffekt im Namen) bei `setteleAnruf` — korrekt selbst dokumentiert, kein Verstoß.
  - G20 (Kommentar-Dichte) in `kosten-projektion.js`, `kostenarten.js`, `defaults.js` — sehr lange Kommentare, bei diesem Money-Pfad bewusst vertretbar.
- **s4** (Beobachtung, keine Flag): `kosten-abschluss.js#endzustandVon` und `kosten-projektion.js#istVollBelegt` prüfen beide `pflichtTraeger.length === 0` für denselben Anruf, beantworten aber unterschiedliche Fragen (Label vs. Geld-Gate) — keine echte Duplizierung.

Positiv hervorgehoben: G5 durchgehend eingehalten (`istBeweisendeHerkunft`, `summierbareBelegzeilen`, `TELNYX_SWEEP_TRAEGER` als jeweils EINE Quelle), NULL-vs-0-Disziplin konsequent, Signaturwechsel an allen sechs Aufrufstellen konsistent nachgezogen, Doppel-Settlement durch `costTruedAt` set-once ausgeschlossen und getestet, Money-Pfad-Grenzfälle einzeln getestet inkl. Positiv-Kontrolle für den Cent-Schreiber-Scanner.

Offener topTodo aus dem Audit: ein erster `npm test`-Lauf zeigte einmalig „fail 2" (nicht protokolliert), ein sauberer Re-Run war 5618/5618 grün — vor Merge einmal isoliert bestätigen, dass es ein bekannter Suite-Flake war.

---

## 5. Fix-Runden

**Fix-Runde 1** (→ `phase/kv2-8-impl-fix2` als Vorläufer-Branch-Historie): behob beide Review-Blocker aus Runde 1, minimal, mit Regressionstests.
- **B1-Fix**: `kostenprofilFuerAnruf` lenkte jeden unbekannten/fehlenden `costProfile`-Wert auf die Legacy-Zuordnung um, wodurch die Matrixzeile „Profil unbekannt (Anruf nach der Kette entstanden) → gar nichts [erstatten]" nicht erreichbar war — korrigiert, mit eigenem Test belegt.

**Fix-Runde 2**: einziger genannter Blocker war ein reiner Doku-Fehler (falsche Behauptung über den gesetzten Wert in `befund-telnyx.md`), kein Code-Bug. Zeile korrigiert, kein Regressionstest nötig (keine Verhaltens-/Codeänderung). `node --check` grün. `npm test` (STORE_BACKEND=json, Regressionsbank) grün: 5618/5618.

**Endstand:** Trotz der beiden Fix-Runden bleibt das Gate laut Auftrag **BLOCKED** — die finale Safety-Bewertung in dieser Übergabe (s. Abschnitt 3) listet B1 und B2 als offen; ob B1 bereits durch Fix-Runde 1 vollständig geschlossen wurde oder ob die zitierte finale Safety-Bewertung vor Fix-Runde 1 lag, ist aus den vorliegenden Quellen nicht eindeutig rekonstruierbar und sollte vor jeder weiteren Entscheidung am aktuellen Diff von `phase/kv2-8-impl-fix2` nachgemessen werden — insbesondere B2 (Owner-Freigabe der Ersatz-Positiv-Kontrolle für KV2-5(d)) ist in keiner Fix-Runde adressierbar und braucht eine ausdrückliche Owner-Entscheidung vor jedem Merge.
