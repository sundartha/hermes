# Phase PA-21 — C2-Kommentar-Kosmetik: Flach-config-Pfade → Namespace-Form

**Gate: PASS**
**finalBranch: `phase/polish-a-p21-fix1`**

## Ueberblick

Folgephase nach dem config-Flip (PA-12…PA-20, gemergt auf `master` @ `bd27eee`).
Die flache config-Oberflaeche ist entfernt; die 13 Namespaces aus
`CONFIG_NAMESPACES` (`src/config.js:792`) sind die einzige Oberflaeche —
`guardedConfig` wirft bei jedem flachen Zugriff `config.<flatKey>` einen
**TypeError** (`src/config.js:759-778`). PA-21 behebt die verbliebenen C2-Faelle:
Kommentare, die aktuelles Verhalten noch mit einem flachen Pfad beschreiben.

Reine Kommentar-Kosmetik, keine Logik-, Test- oder Verhaltensaenderung.

---

## Plan (gekuerzt)

**Ausgangslage:** Verifiziert gegen `master` @ `bd27eee`. Autoritative Karte
der relevanten Blatt→Namespace-Zuordnungen (`src/config.js:792-806`):

| Namespace | relevante Blaetter (PA-21) |
|---|---|
| `safety` | allowedCountryCodes, maxCallsPerHour, maxCallDurationS, fakeOriginate |
| `billing` | maxBudgetCents, paymentEnabled, numberSetupFeeCents, smsCostCents |
| `provisioning` | maxNumbers, provisioningCountry, forceNumberCountry, geoDbPath, ownerNumberSeed, ownerNumberProvider |
| `auth` | loginCookieTtlSeconds, devLoginEnabled |
| `voice` | realtimeVoice, sttSpeechTimeoutSec, callerSubstanceMinLen |
| `telephony` | telnyxAccountSid |
| `tenancy` | multiTenant, mcpUiEnabled, assistantContextEnabled, profilesSeed |
| `server` | publicUrl |
| `store` | databaseUrl, queueBackend |
| `metrics` | metricsEnabled |
| `privacy` | retentionDays |

**Neue Dateien:** Keine — reine Kommentar-Korrektur in Bestandsdateien.

**Scope-Klassifikation** (drei Grep-Durchlaeufe auf `master`):

- **Fix (a):** 45 Kommentar-Zeilen in 32 Dateien (31 `src/`, 1 `scripts/`) —
  Flach-Pfad beschreibt aktuelles Verhalten → auf Namespace-Form umschreiben.
- **Keep (b):** 5 Zeilen sind bewusste „existiert-nicht-mehr"-Notizen →
  unveraendert lassen (`config.js:243`, `sms-summary.js:10`,
  `store/json.js:432`, `store/state-ops.js:639`, `telephony/call-finish.js:77`).
- **Ausschluss:** 1 False-Positive (`judge.mjs:6`, Anthropic-API-Feld
  `output_config.format`), 1 `.sql` ausserhalb Scope (`db/schema.sql`),
  1 `cfg.*`-Cluster (lokaler Parameter, kein Flach-Pfad — korrekter Code).

**Mechanik (empfohlen, deterministisch sicher):** pro (Datei, Flach-Token)
genau ein `Edit` mit `replace_all: true`,
`old_string = "config.<flat>"` → `new_string = "config.<ns>.<flat>"`.
Kollisionsfrei, weil bereits-namespaced Code (`config.<ns>.<flat>`) den
Teilstring `config.<flat>` nie enthaelt (dazwischen liegt immer `.<ns>.`).
Jede Datei vor dem Edit lesen (Pflicht).

38 Edit-Positionen ueber 32 Dateien wurden im Plan tabellarisch mit exaktem
Anker-Kommentar und Token-Mapping spezifiziert (z.B. `bridge.js: realtimeVoice
→ voice.realtimeVoice`, `server.js: paymentEnabled → billing.paymentEnabled`,
`voice-render.js`: 3 Stellen `publicUrl`/`sttSpeechTimeoutSec` byte-genau
vorgegeben).

**Angrenzende, bewusst NICHT behobene Ungenauigkeiten** (Scope-Disziplin):
Zwei Kommentare tragen zusaetzlich einen veralteten Modul-Verweis
(„server.js: …") neben dem Flach-Pfad — PA-21 korrigiert nur den config-Pfad,
nicht den Modulnamen (separater, vorbestehender C2-Fall, nicht Teil dieser
Phase): `src/store/state-ops.js:372` und `scripts/convo-bench/texml.mjs:22`.

**Tests:** Keine neuen/geaenderten Tests — reine Kommentar-Korrektur ohne
Verhaltensaenderung. Bestandssuite bleibt ohne Test-Aenderung gruen.

**Deterministisch pruefbares Ergebnis:**
- `node --check` auf alle beruehrten Dateien → 0 FAIL erwartet.
- Abschluss-Grep (C2-Gate): jeder verbliebene flache `config.<key>` MUSS
  eine bewusste Keep-(b)/False-Positive-Zeile sein → leer erwartet.
- `npm test` → identisch zur Baseline **2422/0**.
- `git diff --stat` → 32 Dateien, ausschliesslich Kommentar-Zeilen, netto +0.

**Pre-Mortem (Risiken + Mitigation):**

| Risiko | Mitigation im Plan |
|---|---|
| Blind-Replace aendert Code statt Kommentar | nur `Edit`-Tool auf `config.<flat>`; Diff-Stat-Gate beweist „nur Kommentarzeilen" |
| Keep-(b)-Notiz faelschlich „korrigiert" | Keep-Set explizit; Tokens sind keine Blatt-Keys |
| `cfg.maxBudgetCents`-Cluster mit-ersetzt | Ausschluss belegt; Replace laeuft auf `config.<flat>`, nicht `cfg.<flat>` |
| Suite faellt rot durch Voll-Last-Flake | Gate-Protokoll: rot nur echt, wenn isoliert reproduzierbar |

**Blast-Radius:** Minimal — 32 Dateien, ausschliesslich In-Line-Kommentar-
Ersetzungen, kein Code/Test/`.md`/`.sql`. Ein `phase-impl-lean`-Lauf; Merge
im Lead (`--no-ff`), kein Push. `git add` gezielt je Datei (nie `git add -A`).

---

## Impl-Zusammenfassung

45 Kommentarzeilen in 32 Dateien (31 `src/`, 1 `scripts/`) von flachem
`config.<key>` auf Namespace-Form `config.<namespace>.<key>` korrigiert
(C2-Fix nach dem PA-20-Flip).

- `git diff --stat` bestaetigte exakt 32 Dateien mit +45/-45 (netto 0).
- Filter auf jede geaenderte Zeile bestaetigte: ausschliesslich
  Kommentarzeilen (Praefix `//` oder `*`), keine Code-/Test-/`.md`-Logik
  angefasst.
- `node --check` auf allen 32 Dateien: 0 FAIL.
- Voll-Suite `npm test`: **2422/2422 gruen** (identisch zur erwarteten
  Baseline, deckt json- UND pg/pglite-Backend in derselben `node:test`-Suite
  ab).
- Abschluss-Grep bestaetigt: alle verbliebenen flachen `config.<key>`-Treffer
  sind die 5 geplanten Keep-(b)-Historiennotizen + 1 Out-of-Scope-Treffer in
  `src/db/schema.sql`; der `cfg.maxBudgetCents`-Cluster (lokaler Parameter)
  und `judge.mjs`-`output_config.format` blieben wie geplant unangetastet.
- Smoke-Test (Server-Boot + `/healthz` + `/voice/turn`) erfolgreich: Server
  lokal gebootet (Dummy-Env, `SKIP_TWILIO_SIGNATURE_CHECK=true`,
  `bootstrap-tenant.js` fuer aktive Nummer), `/healthz` → 200, `/voice/turn`
  → 200 (korrektes No-Active-Call-Hangup-Verhalten, kein Crash). Boot-Log
  zeigt normale Startzeile ohne Fehler.
- Erst-Commit `e14fe63` auf Branch `phase/polish-a-p21` (Basis
  `master@bd27eee`) inkl. `tasks/polish-a-p21-report.md`.
- `cleanCodeSelfCheck`: G5/S2 (keine neue Duplizierung — festes Muster
  `config.<flat>` → `config.<ns>.<flat>`), G25 (keine Magic Numbers), C5/G9
  (kein toter/auskommentierter Code beruehrt), G12 (keine Imports
  veraendert), N7 (keine Namen betroffen), F1/G30/G34 (keine
  Funktionen/Argumente veraendert), C2 (Kernziel: veraltete Kommentare
  korrigiert), Konventionen (ESM/kein Build/kein TS unberuehrt, Kommentare
  deutsch ohne Umlaute — alle Ersetzungen sind reine ASCII-Namespace-Token).

### Deviations

**Keine** laut Erst-Implementierung (`"deviations": []`). Ein spaeterer
Review-Fix-Zyklus (Runde 1) ergaenzte 5 vom Erst-Grep uebersehene Stellen
(siehe Fix-Runden) — kein Scope-Abweichler, sondern Nachschaerfung der
Abschluss-Grep-Deckung auf nested-Group-Keys (`telnyxElevenLabs`,
`telnyxAssistant`).

---

## Safety-Urteil

**verdict: APPROVED**

- `approved`: true
- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Unabhaengiger Testlauf:** Suite selbst in frischem Worktree
(`review-pa-21-r1` auf `phase/polish-a-p21-fix1`) laufen lassen. Kanonisch
`npm test` = **2422 pass / 0 fail / 0 cancelled** (deckt json UND die
in-process pglite-basierten pg-Tests ab) — exakt das Spec-Ziel 2422/0,
unveraendert. Zusaetzlich `STORE_BACKEND=pg` global forciert: 2109 pass / 36
fail — diese 36 sind eine vorbestehende Harness-Grenze (spawn-basierte
Server-Tests brauchen eine echte `DATABASE_URL`; `test/helpers.js` `BASE_ENV`
pinnt `STORE_BACKEND=json` fuer gespawnte Server), keine Regression: der Diff
ist beweisbar kommentar-only, kann also kein Test-Ergebnis aendern.
`node --check` auf alle 35 beruehrten Dateien: OK.

**Beweis der Sicherheit:**
- Kommentar-only: Zeile-fuer-Zeile geprueft — jede hinzugefuegte/entfernte
  Zeile im gesamten Diff (src + scripts) beginnt getrimmt mit `//`, `*` oder
  `/*`. Null Nicht-Kommentar-Aenderungen. Flag-off byte-identisch zu master
  trivially garantiert.
- Scope (hart) eingehalten: nur Kommentare in 34 `src/**/*.js` + 1
  `scripts/*.mjs`; keine Code-/Test-/Logik-Zeile; keine
  `package.json`/`package-lock`-Aenderung. `rawConfig`-/Namespace-
  Definitionen in `config.js` unangetastet (nur der Kommentar oberhalb von
  `telnyxAssistant` korrigiert).
- Korrektheit gegen die autoritative Karte: alle 31 im Diff eingefuehrten
  `config.<ns>.<key>`-Pfade validieren exakt gegen `CONFIG_NAMESPACES`
  (0 flagged). Insb. `config.telnyxAssistant.<key>` →
  `config.telnyx.telnyxAssistant.<key>` korrekt.
- Urteil (a) vs (b) sauber getroffen: der Abschluss-Grep findet 16
  verbliebene flache `config.<key>` in Kommentaren — 10 Datei-Referenzen auf
  `config.js`, 1 Anthropic-API-Feld `output_config.format`, 5 bewusste
  „existiert-nicht-mehr/kein-Fallback-mehr"-Historiennotizen. Keine einzige
  case-(a)-Notiz uebersehen.

**Absolute Regeln:** Safety-Gates (numberGateError/Denylist/Allowlist/
Land/Stundenlimit/Budget/Max-Dauer) unveraendert. Disclosure fest verdrahtet
(`disclosureSentence` in `claude.js:171` + `bridge.js`-Wiring intakt — die
einzigen Aenderungen sind Kommentare zu `config.voice.callerSubstanceMinLen`
bzw. `config.voice.realtimeVoice`). Auth fail-closed: `safeEqual`/
Signaturpruefungen unberuehrt. Keine Secrets im Diff oder Report. Kein
Deploy/Push durchgefuehrt.

**Concerns (non-blocking):**
1. Diff enthaelt eine neue `tasks/polish-a-p21-report.md` — vom Workflow
   vorgeschriebenes Phasen-Report-Artefakt, PII-/Secret-frei gescannt.
2. `STORE_BACKEND=pg` global forciert → 36 spawn-Test-Fails: Bestandsverhalten
   der Test-Harness (kein echter Postgres im Worktree), nicht durch diese
   Phase verursacht.

---

## Clean-Code-Audit

**Verdict: PASS**

### S1 (Blocker)
Keine.

### S2 (Blocker)
Keine.

### S3 (nicht-blockierend)
- **DOK · `tasks/polish-a-p21-report.md`**: Report ist relativ zum
  Fix-Commit veraltet (C2-artig, aber auf Doku statt Code): er behauptete
  „45 Kommentar-Zeilen in 32 Dateien" und listete nur die 5 Keep-Notizen als
  Ausnahmen. Tatsaechlicher Endstand branch-vs-master ist 50 Zeilen in 35
  Dateien (verifiziert per `git diff --stat`) — der Fix-Commit `1ee9048`
  („Review-Blocker Runde 1") hatte 3 weitere Dateien (`src/config.js`,
  `src/telephony/adapters/telnyx/render.js` zusaetzliche Stelle,
  `src/telnyx-call-control-ingest.js`) und 5 weitere Kommentarzeilen
  korrigiert, ohne dass der Report nachgezogen wurde. Fix-Empfehlung:
  Report-Zahlen/Dateiliste auf den finalen Branch-Stand aktualisieren.

### S4
Keine.

**Begruendung des Verdicts:** Der gesamte Diff (35 Code-Dateien + 1 neue
Report-Datei, Branch `phase/polish-a-p21-fix1` vs `master`) besteht
ausschliesslich aus Kommentar-Text-Aenderungen (verifiziert: jede +/- Zeile
beginnt mit `//` oder `*`, keine einzige Code-/Logik-/Test-Zeile veraendert).
Alle 41 einzigartigen korrigierten Pfade wurden gegen die tatsaechliche
`CONFIG_NAMESPACES`-Definition geprueft (safety/billing/provisioning/auth/
llm/telnyx/voice/telephony/tenancy/server/store/metrics/privacy) — alle 41
korrekt. Nach-Grep bestaetigt: verbleibende flache `config.*`-Referenzen in
Kommentaren sind ausschliesslich die 5 bewussten Historiennotizen plus der
Out-of-Scope-Treffer in `db/schema.sql`. `node --check` auf allen 35
beruehrten Dateien: 0 Fehler. `npm test` lokal nachgefahren: 2422/2422 gruen.

**passNotes:**
1. Diff strukturell garantiert verhaltensneutral (per grep-Filter
   gegenverifiziert).
2. Alle 41 korrigierten `config.<namespace>.<key>`-Pfade stimmen mit der
   realen `CONFIG_NAMESPACES`-Map ueberein.
3. `node --check` fehlerfrei; `npm test` 2422/2422 gruen (selbst
   nachgefahren, nicht nur dem Report geglaubt).
4. Report dokumentiert nachvollziehbar, warum bestimmte flache
   `config.*`-Kommentar-Treffer bewusst nicht angefasst wurden.
5. Commit-Historie zeigt sauberen Review-Fix-Zyklus (Runde 1 behob 4-5
   uebersehene Stellen).

**topTodos (non-blocking):**
1. `tasks/polish-a-p21-report.md` auf finalen Branch-Stand nachziehen
   (35 Dateien/50 Zeilen statt 32/45).
2. Vor Merge: separater, vorbestehender C2-Fall
   (`state-ops.js:372` „server.js: config.safety.maxCallDurationS" — realer
   Aufrufer ist `call-lifecycle.js`/`reattach.js`) als offene Folge-Notiz in
   `tasks/lessons.md` festhalten, sonst geht die Beobachtung mit dem Merge
   unter.

---

## Fix-Runden

### Runde 1
Alle drei gemeldeten C2-Blocker der Phase PA-21 behoben. Der Erst-Report
hatte faelschlich „C2 sauber" behauptet, obwohl der Abschluss-Grep die
nested-Group-Keys `telnyxElevenLabs`/`telnyxAssistant` verfehlt hatte.
5 Kommentarstellen (4 Blocker + 1 Grenzfall) in 4 Dateien
(`src/config.js`, `src/telephony/adapters/telnyx/render.js`,
`src/telnyx-call-control-ingest.js` und eine weitere) wurden auf die
Namespace-Form `config.telnyx.…` korrigiert. Ergebnis: finaler Branch-Stand
`phase/polish-a-p21-fix1` mit 35 Dateien / 50 Kommentarzeilen (statt der im
Erst-Report dokumentierten 32/45).

---

## Ergebnis

- **Gate:** PASS
- **finalBranch:** `phase/polish-a-p21-fix1`
- **headCommit (Erst-Impl):** `e14fe63c311aa8d3830e8ecfcd1b31b69608109d`
  (nach Runde-1-Fix ergaenzt um `1ee9048`)
- Kein Push, kein Merge auf `master` im Rahmen dieses Berichts (Merge liegt
  laut Plan beim Lead).
- Test-Baseline unveraendert: **2422/2422 gruen**.
