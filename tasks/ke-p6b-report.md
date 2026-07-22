# Phase KE-P6B — Verzug 180→30 min, Kadenz 6 h → 1 h (Intervall wird Env-Variable)

- **Gate:** PASS
- **finalBranch:** `phase/ke-p6b-kadenz`
- **Basis:** `master`
- **headCommit:** `894ba058c7d107094cd4eaae17a716780b0cc8aa`

---

## 1. Was geändert wurde

**Blast-Radius:** 3 Produktionsdateien, 2 Deploy-Dokumente, 3 bestehende Testdateien angepasst, 1 Testdatei neu. Kein Geldpfad-Code angefasst (`anchoredSessionIds` / `assignmentOutcome` / `toCostRecord` / `via_`-Zähler / `bookablePool` / `refundProven` / die Query `filter[record_type]`, `page[size]`, `page[number]` — unberührt).

### Neue Datei

- **`test/cost-truing-cadence.test.js`** (neu, 6 Tests P6B-1…P6B-6): eigene Datei, weil Gegenstand die Fälligkeits-Schwelle und die Herkunft der Kadenz ist, nicht die Zuordnung. Nutzt einen bewusst leeren Pool-Adapter (`raw: []`) — Prüfgegenstand ist WELCHE Calls der Sweep anfasst, nicht WAS er zuordnet.

### Bearbeitete Dateien

- **`src/config.js`**
  - Neue modul-lokale Konstante `MAX_TIMER_DELAY_MS = 2_147_483_647` (Node-32-Bit-Timer-Grenze), als `max`-Klemme.
  - `costTruingDelayMinutes`: Default `180` → `30`, Begründung auf die Messung umgestellt (F3: Testanruf 2026-07-21, Belege spätestens 133 s nach Gesprächsende vollständig und wertrichtig — 30 min = 13-facher Sicherheitsabstand).
  - Neuer Knopf `costTruingSweepIntervalMs`: `numEnv("COST_TRUING_SWEEP_INTERVAL_MS", …, { fallback: 60*60*1000, min: 60*1000, max: MAX_TIMER_DELAY_MS })`. `min` fatal (Boot-Refusal), `max` Clamp ohne Fatal.
  - `CONFIG_NAMESPACES.billing` um `"costTruingSweepIntervalMs"` ergänzt.
  - Zwei veraltete Kommentare korrigiert (Stall-Sweeps „8 × 6 h = zwei Tage" → „8 × 1 h = rund 8 h"; Debounce „6-h-Sweep viermal am Tag" → „Sweep in jeder Kadenz erneut, bei 1 h 24-mal am Tag").
- **`src/billing/cost-truing.js`**
  - Modul-Konstante `COST_TRUING_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000` ersatzlos entfernt (inkl. Kommentarblock, kein Kommentar-Grabstein).
  - Zwei Kommentar-Korrekturen an Debounce- bzw. SMS-Kostenklemme-Stelle (6-h-Sweep → Sweep/Kadenz-neutral).
- **`src/boot.js`**
  - Import von `COST_TRUING_SWEEP_INTERVAL_MS` entfernt.
  - `setInterval(...)`-Aufruf liest jetzt `config.billing.costTruingSweepIntervalMs` statt der Modul-Konstante.
  - Kommentar an der Registrierungsstelle aktualisiert.
- **`.env.example`**: `COST_TRUING_DELAY_MINUTES=180` → `=30` (mit Messbegründung); neuer Block `COST_TRUING_SWEEP_INTERVAL_MS=3600000` mit Erklärung zu min/max; zwei Kommentar-Korrekturen (6h-Intervall/6h-Sweep-Aussagen).
- **`render.yaml`**: `COST_TRUING_DELAY_MINUTES` `"180"` → `"30"`; neuer Eintrag `COST_TRUING_SWEEP_INTERVAL_MS: "3600000"`; Kommentare mit KE-P6B-Herkunft ergänzt.
- **`test/helpers.js`** (BASE_ENV): `COST_TRUING_DELAY_MINUTES` `"180"` → `"30"`; neu `COST_TRUING_SWEEP_INTERVAL_MS: "3600000"`; Kommentar aktualisiert.
- **`test/api-cost-truing-sweep.test.js`**: Kommentarwert 180 → 30 (Verträglichkeit geprüft: `ENDED_MINUTES_AGO = 200` bleibt unter 180 wie unter 30 fällig, Erwartungen unverändert).
- **`test/config-namespaces.test.js`**: gepinnte Zählungen nachgezogen — Testtitel „123 Keys" → „124 Keys"; `billing: 35` → `36` (mit erklärendem Kommentar); `EXPECTED_TOTAL_KEYS` 123 → 124; geprüfte primitive Blätter 115 → 116 (mit Kommentar).

**Nicht angefasst:** `test/cost-truing-harness.js` (`fakeConfig.costTruingDelayMinutes: 180` bleibt als explizite Fixtur bestehen), keine der übrigen `cost-truing-*`-Testdateien (observe/pool/since/booking/sweep-log/tts-characters).

---

## 2. DER ROTE LAUF VOR DEM FIX

**Befehl** (ausgeführt VOR jeder Code-Änderung, nur der neue Test existierte):

```
NODE_ENV=test node --test test/cost-truing-cadence.test.js (ausgefuehrt VOR jeder Code-Aenderung, nur der neue Test existierte)
```

**Wörtliche Ausgabe:**

```
✖ (P6B-1) beim Config-Default ist ein 31 min alter Call Kandidat, ein 29 min alter nicht — AssertionError: genau der 31-min-Call ist Kandidat, 0 !== 1
✖ (P6B-2) Config-Default: Verzug 30 min, Kadenz 1 h — AssertionError: 180 !== 30
✖ (P6B-3) cost-truing.js exportiert keine eigene Sweep-Kadenz mehr — AssertionError: true !== false (Modul-Konstante existiert noch)
✖ (P6B-4) Verzug und Kadenz stehen in config.js, .env.example, render.yaml und BASE_ENV identisch — AssertionError: COST_TRUING_DELAY_MINUTES in .env.example, '180' !== '30'
✖ (P6B-5) Kadenz unter dem Minimum -> Fatal-Befund (Boot-Refusal) + Fallback statt Sweep-Sturm — AssertionError: eine zu kleine Kadenz muss den Boot verweigern, nicht still durchlaufen (kein Fatal, weil der Key nicht existiert)
✖ (P6B-6) Kadenz ueber der Node-Timer-Grenze wird geklemmt — TypeError: config.billing.costTruingSweepIntervalMs existiert nicht
ℹ tests 6
ℹ pass 0
ℹ fail 6
```

Zusätzlich zur Absicherung isoliert vom Safety-Reviewer nachgestellt (kein `git stash`, sondern gezieltes `git checkout master -- <datei>`): mit der `master`-Fassung von `src/config.js` fielen 5 von 6 neuen Tests rot, `(P6B-1)` genau an der 180-min-Schwelle (`0 !== 1`); mit der `master`-Fassung von `src/billing/cost-truing.js` fiel `(P6B-3)` rot (Modul-Konstante wieder exportiert).

---

## 3. Der grüne Lauf danach

```
NODE_ENV=test node --test test/cost-truing-cadence.test.js
→ ℹ tests 6 / ℹ pass 6 / ℹ fail 0
```

**Voll-Suite:**

- `testsPass: true`
- `testPassCount: 2930`, `testFailCount: 0`
- Referenz laut Auftrag: **2861/0** → gewachsen auf **2930/0** (Plan-Header nannte 2922 als Ausgangswert, ebenfalls überschritten).
- `node --check` auf `src/config.js`, `src/billing/cost-truing.js`, `src/boot.js`: alle drei ohne Ausgabe (Syntax ok).
- Zusätzlich isoliert grün (Flake-Protokoll): `test/cost-truing-observe/-booking/-pool/-since/-sweep-log/-tts-characters/-booking-guard.test.js` (66/66), `test/api-cost-truing-sweep.test.js` (3/3), `test/boot-*.test.js` + `bootstrap-tenant` + `cost-drift-boot` (37/37).
- Safety-Review (unabhängiger Lauf im eigenen Review-Worktree): `npm test` → 2930/2930, zweimal `NODE_ENV=test node --test "test/*.test.js"` → 2930/0.
- Clean-Code-Audit: volle Suite lief dort mit 2929/2930 grün — der eine Fail (`test/cq-p8-briefing.test.js`, 50ms-Timing-Test) ist nachweislich unabhängig vom Diff (Datei nicht im Diff, isoliert 12/12 grün, nur unter Volllast ein bekannter Timing-Flake).

---

## 4. Abnahmekriterium der Phase — Beleg

Alle 7 Abnahmekriterien (A–G) wörtlich geprüft, alle grün:

**A)** `NODE_ENV=test node --test test/cost-truing-cadence.test.js`
→ „ℹ tests 6 / ℹ pass 6 / ℹ fail 0" (vorher: pass 0 / fail 6)

**B)** `grep -n "6 \* 60 \* 60 \* 1000" src/billing/cost-truing.js`
→ keine Ausgabe, Exit-Code 1 (Modul-Konstante entfernt)

**C)** `grep -n "COST_TRUING_DELAY_MINUTES=" .env.example`
→ „246:COST_TRUING_DELAY_MINUTES=30"

**D)** `grep -c "COST_TRUING_SWEEP_INTERVAL_MS" .env.example render.yaml test/helpers.js src/config.js`
→ `.env.example:1` / `render.yaml:1` / `test/helpers.js:1` / `src/config.js:2` (jede Datei ≥ 1)

**E)** `NODE_ENV=test node --test test/config-namespaces.test.js`
→ „ℹ tests 6 / ℹ pass 6 / ℹ fail 0" (billing=36, EXPECTED_TOTAL_KEYS=124, checked=116)

**F)** `node --check` auf `src/config.js`, `src/billing/cost-truing.js`, `src/boot.js`
→ keine Ausgabe (Syntax ok), alle drei Dateien einzeln geprüft

**G)** `npm test`
→ „ℹ tests 2930 / ℹ pass 2930 / ℹ fail 0" (≥ 2928 gefordert; Referenz 2861 aus Auftrag bzw. 2922 aus Plan-Header — wächst in jedem Fall)

---

## 5. Safety-Urteil

**Verdikt: FREIGABE** (`approved: true`).

- `testsPassIndependently: true`, `testPassCount: 2930`
- `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`, `moneyPathFailClosed: true`, `fixturesHonest: true`, `redBeforeGreenProven: true`, `noGuessedQueryParam: true`
- `blockers: []`

Prüfmethode: unabhängig im eigenen Review-Worktree ausgeführt. Warnung zum Verfahren: mit dem vorgegebenen Selbst-Symlink `ln -s "./node_modules" node_modules` bricht `npm test` sofort mit Exit 194 ab, ohne Testausgabe — der Symlink wurde auf `../../../node_modules` umgehängt, danach erst gemessen. Rot-vor-grün selbst nachgestellt (s. Abschnitt 2). Mutationsprobe: `src/boot.js` probeweise auf hartkodierten Wert `6*60*60*1000` gemutet → Voll-Suite blieb 2930/0 (zweimal gelaufen) — die Verdrahtung `boot.js` → `config.billing.costTruingSweepIntervalMs` ist damit **nicht testgepinnt** (siehe Concerns unten). Ein Zwischenlauf unter Mutation zeigte 6 Fehler, die im Wiederholungslauf verschwanden — bekannter Voll-Last-Flake, kein isoliert roter Test.

**GELDPFAD:** unberührt. Diff in `cost-truing.js` besteht ausschließlich aus Kommentar-Korrekturen und dem Entfernen der exportierten Konstante; `anchoredSessionIds`/`assignmentOutcome`/`toCostRecord` kommen im Diff nicht vor, ebenso wenig die Refund-Asymmetrie in `applyCostCorrectionCents`. Kein Pfad erzeugt „Kosten = 0": der leere Pool-Adapter des neuen Tests landet nachweislich bei „unbestimmt=1" in der Sweep-Log-Zeile, nicht bei „gemessen". Query-Konstruktion unverändert (`filter[record_type]`, `page[size]`, `page[number]` per grep geprüft).

### Concerns (keine Blocker)

1. **Mutationslücke (wichtigster Punkt):** Kein Test pinnt, dass die einzige Registrierungsstelle (`boot.js`) den Config-Wert wirklich liest. Das Abnahmekriterium „Intervall kommt aus der Config" ist nur zur Hälfte gedeckt (Default gepinnt, Konsum nicht). Restrisiko begrenzt (guardedConfig würfe bei umbenanntem Key einen TypeError), aber ein späterer Hardcode würde die 6-h-Kadenz lautlos wiederherstellen, während `.env`/`render.yaml` 1 h behaupten. Empfehlung: Wiring-Assertion (injizierbares `setInterval` bzw. Boot-Test).
2. **Doku-Drift bei genau den zwei korrigierten Zahlen:** `src/db/schema.sql:307` und `src/store/defaults.js:410` begründen die Persistenz von `costCorrectionMicroCentsRem` weiter mit „Abgleich alle 6 h, verzögert um 180 min" — Richtung stimmt, Zahlen sind jetzt falsch.
3. **Deploy-Auflage nirgends im Branch verankert:** `COST_TRUING_MAX_ATTEMPTS` muss im Render-Dashboard von 20 zurück auf 5 (live ist 20, `render.yaml` ist für diesen dashboard-verwalteten Service nicht die Wahrheit). `tasks/ke-DEPLOY-CHECKLIST.md` existiert noch nicht, kein Phasenbericht lag im Branch bei. Ohne diesen Schritt bleibt W bei 30 min + 20 × 1 h ≈ 20,5 h statt der geplanten 5,5 h.
4. **30-min-Verzug ruht auf F3 mit n=1** (Testanruf 2026-07-21, Assistant-Pfad). Sobald eine Klassifikation zustande kommt (`measured !== null`), wird der Call über `costTruedAt` dauerhaft geschlossen — ein bei 30 min noch unvollständiger Belegsatz wird nie nachgeholt, der Call bleibt mit untersetztem Ist-Wert stehen. Die verkürzte Frist erhöht die Wahrscheinlichkeit dieses Falls; gehört ausdrücklich in die P7-Live-Verifikation.
5. **Kosmetik:** `.env.example` (Block `COST_TRUING_SWEEP_INTERVAL_MS`) enthält den Tippfehler „braennte".
6. **Nur zur Kenntnis, kein Mangel:** die 6-fache Kadenz vervielfacht den kostenpflichtigen SMS-Pfad nicht — `alertDrift` und `emitFinding` laufen beide über `shouldEmitFinding` mit `COST_ALERT_DEBOUNCE_MS` (24 h), `coverage_stalled` schickt ohnehin nur `console.warn` + Audit.

---

## 6. Clean-Code-Audit

**Verdikt: PASS (kein Blocker).**

- **s1 (Blocker):** keine
- **s2 (schwer):** keine
- **s3 (gering):**
  1. `render.yaml` — Kommentar bei `COST_TRUING_SWEEP_INTERVAL_MS` nennt nur den alten Wert (6 h, Historie), nicht den neuen (1 h = 3600000) — wirkt dünner als der parallele `.env.example`-Kommentar. Fix-Vorschlag: „... jetzt Env, Default 1 h statt vormals 6 h."
  2. `src/config.js:38` vs. `test/cost-truing-cadence.test.js:35` — Node-Timer-Grenzwert `2_147_483_647` als eigene benannte Konstante in Produktions- UND Testcode dupliziert (nicht aus `config.js` exportiert). Bewusst vertretbar (Test soll Erwartungswert unabhängig herleiten), kein Fix nötig, nur zur Kenntnis.
- **s4 (kosmetisch):** keine

**passNotes:** EINE Quelle für die Kadenz sauber durchgezogen (Modul-Export entfernt, `boot.js` liest `config.billing.costTruingSweepIntervalMs`, kein toter Re-Export, per grep verifiziert). Grenzen sauber gekapselt (min 60000ms → Fatal/Boot-Refusal, max → Node-Timer-Clamp, beide testgepinnt P6B-5/P6B-6, matched `numEnv()`-Semantik exakt). Boundary-Test P6B-1 prüft den echten Code-Default statt eines Fixture-Literals (31min/29min-Split rechnerisch gegen die `>=`-Formel in `cost-truing.js:144` verifiziert, kein Off-by-one). P6B-4 verifiziert alle vier Config-Oberflächen gegeneinander per Datei-Read — keine Drift möglich, ohne dass ein Test rot wird. Kommentare konsistent ASCII-transliteriert, keine Magic Numbers ohne benannte Konstante im Code. Die Rechnung „6 zuordenbare Typen × 10 Seiten = 60 Anfragen, 30/min-Drossel → 2min Versatz" im `config.js`-Kommentar wurde gegen die tatsächlichen Code-Konstanten nachgerechnet — stimmt, keine Fabrikation. F3-Messwert (133 s) ist im Plan mit Beleg hinterlegt.

**topTodos:**
1. `render.yaml`-Kommentar bei `COST_TRUING_SWEEP_INTERVAL_MS` um den neuen Wert (1 h) ergänzen (S3, kosmetisch).
2. Kein Blocker offen — mergefähig.

---

## 7. Fix-Runden

Keine — die im Auftrag mitgelieferte Quelle enthält einen leeren `=== FIXES ===`-Abschnitt. Es wurden keine Nachbesserungsrunden protokolliert; der Branch erreichte PASS direkt.

---

## 8. Offene Punkte / Deviations

**deviations (aus IMPL):** `[]` — keine Abweichungen vom Plan.

**Offene Punkte (aus Safety- und Clean-Code-Concerns, kein Blocker für das Gate, aber vor Merge/Deploy bzw. spätestens im Phasenbericht abzuarbeiten):**

1. Fehlende Wiring-Assertion für `boot.js` → `config.billing.costTruingSweepIntervalMs` (Mutationsprobe zeigte: ein hartkodierter Rückfall auf 6 h würde die Suite nicht rot machen).
2. Zwei stehengebliebene 6h/180min-Kommentare in `src/db/schema.sql:307` und `src/store/defaults.js:410`.
3. Render-Auflage: `COST_TRUING_MAX_ATTEMPTS` im Dashboard von 20 zurück auf 5.
4. Deploy-Auflagen aus dem Plan (Abschnitt 7 dort), nicht Teil dieser Phase, aber Vorbedingung für Wirksamkeit live:
   - Render-Dashboard `COST_TRUING_DELAY_MINUTES` auf `30` setzen (oder Variable entfernen, damit der Code-Default greift) — ohne das ist die Phase live wirkungslos.
   - Render-Dashboard `COST_TRUING_MAX_ATTEMPTS` zurück auf `5`.
   - `COST_TRUING_SWEEP_INTERVAL_MS` muss live nicht gesetzt werden (Code-Default 1 h); falls doch, ≥ 60000, sonst verweigert der Boot.
   - Owner-Entscheidung vermerken: `COST_TRUING_COVERAGE_STALL_SWEEPS=8` bedeutet ab jetzt ~8 h statt ~2 Tage bis zur `coverage_stalled`-Eskalation (WARN + Audit, keine SMS) — Wert bleibt unverändert, bis der Owner anders entscheidet.
5. `.env.example`-Tippfehler „braennte" (Kosmetik).
6. `tasks/ke-DEPLOY-CHECKLIST.md` existiert noch nicht (laut Plan erst in der KE-P7-Vorbereitung anzulegen — nicht Teil dieser Phase).
7. Der 30-min-Verzug ruht auf einer Einzelmessung (F3, n=1); Deckungsquote (`coverage_below_threshold`/`coverage_stalled`) ist die Beobachtungsfläche für die KE-P7-Live-Verifikation.

**Ausdrücklich nicht Teil dieser Phase (laut Plan):** Bruchpunkt-Wächter/Schwelle 1.440 (KE-P8), Live-Verifikation (KE-P7, Owner), jede Änderung an Abruf/Paginierung/Drossel/Query/Zuordnung/`via_`-Zählern/Sweep-Log-Format/TTS-Zeichen, `RETENTION_SWEEP_INTERVAL_MS` in `boot.js`, `COST_TRUING_COVERAGE_STALL_SWEEPS`-Wert, `test/cost-truing-harness.js`, historische Plan-Dokumente, Deploy/Render-Env/echte Anrufe/neue Dependencies.
