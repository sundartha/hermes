# GATES-P8 — Geo-Backfill-Migration (GAP-34 x2)

**Spec:** Abschnitt "P8" in `tasks/gates-fix-chain.md`
**Abnahme:** beide GAP-34-Tests in `test/f1-geo-store.test.js` gruen via `npm run test:gates`; `npm test` = 3295/0; Diff beruehrt `src/` (ein Diff nur an `test/` ist ein Fehlschlag der Phase)
**Gate:** **PASS**
**finalBranch:** `phase/gates-p8-geo-backfill-r2-fix1`

---

## 1. Plan (gekuerzt)

### Design in einem Satz
`migrate()` bekommt einen fuenften, idempotenten Backfill `backfillNumberGeo(db, restoreTenantId)`, der pro Tenant unter gesetzter RLS-GUC die `number`-Bestandszeilen heilt: Land aus der DID-Vorwahl ableiten (nie raten), Sprache aus dem Land — aber nur, wo sie nicht gewaehlt wurde (`NULL` oder Alt-Default `"de"`). Die Vorwahl→Land-Umkehrung entsteht aus der bereits existierenden Tabelle `CALLING_CODE_FOR_COUNTRY` (`src/store/defaults.js`), kein zweites Vorwahl-Verzeichnis (G5).

### Zwei Befunde vor der Umsetzung

**0.1 BLOCKER (Testaenderung eigentlich verboten):** Ein heute gruener Test in `test/f1-geo-store.test.js` ("R7", kein Katalog-Praefix, laeuft in `npm test`) legt eine `number`-Zeile mit `e164=+4915700099999, country=NULL, language=NULL` an und erwartet nach zweitem `init()`/`migrate()` weiterhin `null/null`. Diese Fixture ist fixture-gleich zur GAP-34-Zeile `num_de_legacy` (`+4915112340001`, ebenfalls `+49`, ebenfalls `null/null`) — jede Implementierung, die GAP-34 Block (b) gruen macht, macht diesen Test zwangslaeufig rot. Vorgeschlagene Minimal-Remediation: Fixture-Nummer auf `+15005550006` (NANP, im Repo bereits als Test-DID etabliert) umstellen — `+1` ist bewusst nicht ableitbar (25 Mitgliedslaender teilen die Vorwahl), die Zeile bleibt `null/null`, Testanzahl bleibt 3295.

**0.2 PRE-MORTEM (Deploy-Auflage, keine Spec-Abweichung):** `src/billing/provision-trigger.js` schreibt heute bewusst zwei verschiedene Laender in eine Zeile — `number.country` ist das Kauf-Land (mit `FORCE_NUMBER_COUNTRY="US"` live also `"US"`), `number.language` folgt dem Herkunfts-Land (z.B. `de`). Der spezifizierte Backfill (`language = languageForCountry(number.country)`) zieht solche Zeilen live von `de` auf `languageForCountry("US")`, beim Weltdefault-Flip also auf `en`. Schutz-Fakt: `resolveCallLanguage = settings.language || number.language || tenant.defaultLanguage || DEFAULT_LANGUAGE` — ist `settings.language` gesetzt, gewinnt sie weiter. Als Deploy-Auflage festgehalten: vor Deploy read-only an der Prod-DB pruefen.

### Scope-Abweichung (bewusst, begruendet)
Die Spec nennt nur `src/db/migrate.js`. Der Plan fasst zusaetzlich `src/store/defaults.js` an (neue exportierte Funktion `countryForE164`, ~14 Zeilen), weil die Vorwahl→Land-Abbildung dort bereits existiert — eine zweite Tabelle in `migrate.js` waere S2-Duplizierung. `src/store/defaults.js` steht in keiner Dateiliste der 15 Kettenphasen (Disjunktheit gewahrt).

### Keine neuen Tests
Abnahme pinnt `npm test` auf 3295/0. Neues Verhalten ist durch die zwei bestehenden GAP-34-Testanker vollstaendig gedeckt (Tabelle im Plan: `num_fr`, `num_at`, `num_us`, `num_de_legacy`, `num_ohne_did`, Idempotenz-Lauf).

---

## 2. Implementierungs-Zusammenfassung

**headCommit:** `018ad67203624fc3b1f7fd6bad066e40df090040`
**Branch (Impl-Runde):** `phase/gates-p8-geo-backfill-r2` (Basis `master` `39ff895`)
**Tests:** `node --check` OK; `npm test` 3295 pass / 0 fail

### Verhaltensaenderung je Datei

- **`src/db/migrate.js`**: `migrate()` erhaelt einen fuenften Backfill `backfillNumberGeo(db, restoreTenantId)`, laeuft zwischen `backfillAccountEmailCase` und `seedDefaults`. Heilt `number`-Bestandszeilen: Land aus DID-Vorwahl ableiten (nie raten — unbekannte/NANP-Vorwahl laesst beide Felder unberuehrt), Sprache aus dem Land nur wo nicht gewaehlt (`NULL` oder `LEGACY_NUMBER_LANGUAGE = "de"`). Laeuft tenantweise unter gesetzter RLS-GUC (`setCurrentTenant`), weil `number` unter `FORCE ROW LEVEL SECURITY` steht — ein naives `UPDATE` traefe unter nicht-privilegierter App-Rolle lautlos nur Bootstrap-Zeilen. GUC wird am Ende auf den Init-Scope zurueckgestellt. Schreibt nur bei echter Abweichung (zweiter Lauf = 0 UPDATEs). Loggt nur eine Zeilen-Zahl (PII-frei).
- **`src/store/defaults.js`**: neue reine, exportierte Funktion `countryForE164()` — Umkehrung von `CALLING_CODE_FOR_COUNTRY` (G5, keine Zweitpflege), laengste Vorwahl zuerst. Fehlende/ungueltige/unbekannte Nummer → `null`. Kein Bestandsverhalten geaendert.
- **`test/f1-geo-store.test.js`**: eine Fixture-Zeile im Bestandstest "R7" von `+4915700099999` auf `+15005550006` (NANP) umgestellt — siehe Deviation unten.

### Deviations (aus IMPL-Report)

1. **Testaenderung ohne Spec-Deckung** — Spec sagt "Zulaessige Testaenderung: keine". Umgesetzt wurde exakt die im Plan §0.1 vorgeschlagene Minimal-Remediation (Fixture-Umstellung auf `+15005550006`), rot-vor-gruen belegt (alte Fixture faellt mit `'DE' !== null`). Braucht Lead-Freigabe — wurde im Review als notwendig bewertet und akzeptiert.
2. **Scope-Abweichung** (im Plan begruendet): `src/store/defaults.js` zusaetzlich angefasst, um S2-Duplizierung zu vermeiden. Keine der 15 Kettenphasen listet diese Datei — Wellenschnitt unverletzt.
3. **Deploy-Auflage** (Pre-Mortem, keine Verhaltensabweichung): Kauf-Land vs. Herkunfts-Land-Vermischung in `provision-trigger.js` — vor Deploy read-only Pruefung an der Prod-DB noetig (SQL-Statement im Plan/IMPL dokumentiert).
4. Verifikations-Hinweis zu Maschinenlast beim Bestaetigungslauf (Umgebungs-Kontention, kein Code-Befund) und eine Umgebungs-Nebenwirkung (`pkill` traf auch fremde parallele Worktree-Testlaeufe, keine Datei-/Git-Auswirkung).
5. Symlink-Korrektur `node_modules` (gitignored, nicht committet).

---

## 3. Fix-Runden

**Runde 1 → Runde 2 (fix1):** Der initiale Safety-Review fand einen echten Korrektheits-Blocker: Sprache kollabierte faelschlich ueber `number.country` (Kauf-Land) statt ueber die Tenant-Herkunfts-Geo. Fix: `healedNumberGeo()`/`healNumberGeoForTenant()` leiten die geheilte Sprache jetzt primaer aus `tenant.country`/`tenant.default_language` ab (neue Funktion `fetchTenantGeo()`), mit `number.country` nur als Fallback. Abgesichert durch einen gezielten Regressionstest (FORCE_NUMBER_COUNTRY-Szenario). Ergebnis: `phase/gates-p8-geo-backfill-r2-fix1`.

Nach diesem Fix: Safety-Review PASS (approved=true), Clean-Code-Audit PASS (nur ein S3-Dokumentationshinweis, kein Blocker).

---

## 4. Safety-Urteil (final)

**approved:** true · **testsPassIndependently:** true · **safetyGatesIntact:** true · **disclosureIntact:** true · **authFailClosedIntact:** true · **noSecretsLeaked:** true · **scopeRespected:** true · **behaviorAsIntended:** true

**Unabhaengiger Testlauf** (frischer Worktree, `review-gates-p8-r1` auf `phase/gates-p8-geo-backfill-r2-fix1` @ `9ec40ad`):
- `npm test`: EXIT 0, korrigiert 3295/3295/0
- `npm run test:gates`: EXIT 1 (erlaubt), korrigiert 132 Tests/98 pass/34 fail. Beide GAP-34-Gates gruen, rote Gates 36→34 (exakt die zwei Zielgates gekippt, keine neuen roten)
- Eigene Sonden S1-S5 gegen pglite bestaetigten: Tenant ohne Geo + US-Kauf-Nummer → `en` (Spec-konform, E2 eingehalten); Tenant DE + gleiche US-Nummer → bleibt `de` (R1-Fix greift); Tenant-Geo-Wechsel DE→FR wird beim naechsten Boot nachgezogen (Backfill ist ein dauerhafter Reconciler, kein Einmal-Lauf); drei Laeufe hintereinander byte-identisch; RLS-GUC-Beweis (ohne GUC 0 sichtbare Zeilen unter nicht-privilegierter Rolle, mit GUC korrekt geheilt).

**Verdikt:** "FREIGABE ZUM MERGE, NICHT ZUM BLINDEN DEPLOY." Absolute Regeln unberuehrt (kein neuer Endpunkt, kein Gate-/Auth-/Signatur-Pfad angefasst, `disclosureSentence` unveraendert, kein Audio-Pfad, kein Secret geloggt, `numberGateError` liest `number.country` nicht mit — die Outbound-Gate-Kette bleibt unberuehrt). Der Runde-1-Blocker ist echt behoben und eigenstaendig nachgemessen.

**Concerns (kein Blocker, aber festzuhalten):**
- **Pflicht vor Deploy:** empirisch bewiesen (Sonde S1) — eine Zeile mit `number.language='de'` und bekanntem Kauf-Land, deren Tenant keine Geo traegt, wird beim ersten Boot still auf `languageForCountry(Kauf-Land)` gezogen. Fuer den Live-Owner (US-DID, Deutsch-Erlebnis moeglich) ist das der stille Schadensfall, vor dem die Phasen-Spec warnt. Vor Deploy an der Prod-DB pruefen.
- Kommentar an `backfillNumberGeo` nennt die Funktion faelschlich "einmalig" — tatsaechlich ist es ein dauerhafter Boot-Reconciler (Sonde S3 zeigt Nachziehen bei Tenant-Geo-Wechsel). Heute folgenlos, aber Kommentar sollte korrigiert werden.
- Neuer Regressionstest traegt Katalog-Praefix "GAP-34 Regression (Review-Blocker R1)" und laeuft dadurch NUR im Gates-Lauf, nicht im Pflicht-gruenen Regressionslauf — Empfehlung: umbenennen, damit der Waechter gegen genau diesen Review-Blocker im Regressionsschutz haengt.
- Testaenderung trotz "Zulaessige Testaenderung: keine" — formal eine Spec-Abweichung, vom Lead bewusst abzunicken (notwendig, Assertion selbst unveraendert).
- Skalierung: Backfill laeuft bei jedem Boot mit 1+N Selects und je einem Update pro geheilter Zeile (Schwester-Backfills haben je ein Statement) — keine neue Kostenklasse, aber kein Fortschritt.
- `countryForE164` hat genau einen Konsumenten und keinen eigenen Unit-Test (nur indirekt ueber Migrationstests gedeckt).
- Zwei leicht unterschiedliche Quellen fuer "welche Sprache gehoert zur Nummer" (Schreibpfad vs. Heilpfad) — heute deckungsgleich, aber divergenzfaehig.

---

## 5. Clean-Code-Audit (final)

**s1 (Blocker):** keine
**s2 (Duplizierung/Struktur, ernst):** keine
**s3 (Ausdrucksstaerke/Dokumentation):** 1 Fund — `test/f1-geo-store.test.js:364-370` (vorbestehend, durch diesen Diff falsifiziert): Der GAP-34-Kommentarblock behauptet weiterhin "migrate() fuehrt genau zwei Backfills ... Beide Bloecke sind deshalb rot" und Testnamen tragen noch das Label "(SOLL, rot)" — nach diesem Merge sind beide Tests gruen. Fix: Kommentar/Label aktualisieren.
**s4 (Kosmetik):** keine

**blocker:** false
**verdict:** PASS mit einem S3-Hinweis. Saubere Funktionszerlegung (`setCurrentTenant`/`fetchTenantGeo`/`healedNumberGeo`/`healNumberGeoForTenant`/`backfillNumberGeo`), je eine Aufgabe (G30/G34), keine Duplizierung (`countryForE164` leitet aus derselben Tabelle ab, G5 eingehalten), RLS-GUC-Handling korrekt, Idempotenz durch echten Vergleich + Test bewiesen. Der Runde-1-Review-Blocker ist korrekt behoben und regressionsgesichert.

**topTodos:**
- Stale-Kommentar in `test/f1-geo-store.test.js` (Zeilen ~364-370) aktualisieren: nicht mehr "rot", `backfillNumberGeo()` existiert jetzt.

---

## 6. Ergebnis / Belegzahlen

- `npm test`: 3295 pass / 0 fail
- `npm run test:gates`: beide GAP-34-Tests gruen, rote Gates 36 → 34 (kein vorher gruenes Gate gefallen)
- `git diff --name-only master..HEAD -- src/ public/ apps/ render.yaml` → `src/db/migrate.js`, `src/store/defaults.js` (nicht leer — Abnahmebedingung "Diff beruehrt src/" erfuellt)
- Diff-Groesse: `src/db/migrate.js` +111, `src/store/defaults.js` +23, `test/f1-geo-store.test.js` +34/-3
- Keine neue Dependency, keine neuen Endpunkte, keine Schema-Aenderung, kein RLS-Bypass

**Offene Deploy-Auflage** (kein Code-Blocker, muss vor Produktions-Deploy erledigt werden): Read-only Pruefung an der Prod-DB, ob Bestands-Nummern mit `language='de'` und Kauf-Land ungleich Herkunfts-Land eine gesetzte `tenant.country`/`default_language` oder `settings.language` haben — sonst kippt beim Boot die Gespraechssprache dieser Nummern still auf `en`.
