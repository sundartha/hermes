# Phase AL-P8 — Detailbericht

**Titel:** „Der Bench misst den Pfad, der live ist"
**Gate:** PASS
**finalBranch:** `phase/al-p8-bench-fix1`
**Basis:** `master` = `3e78160`

---

## 1. Plan (gekuerzt)

### Befund am echten Code
- Der Bench (`scripts/convo-bench/runner.mjs`) fuhr bisher ausschliesslich den **TeXML-Pfad** (`/voice/outbound`/`/voice/incoming` + Gather-Schleife ueber `nextTurnUrl`). `TELNYX_AI_ASSISTANT_ENABLED` wurde nie gesetzt.
- **Live** laeuft aber der **Assistant-Pfad**: Opening ueber Call-Control-`speak`, danach jeder Gespraechsturn ueber `POST /v1/chat/completions` (`src/telnyx-llm-shim.js`).
- Der Shim ist bereits end-to-end per HTTP fahrbar (Muster in `test/telnyx-shim-route.test.js`) — **kein Bypass-Schalter noetig**.
- `roundtrips` werden transportunabhaengig geloggt (AL-P1), Metrics-Parsing existiert schon.
- `hold-warteschleife` codiert TeXML-spezifische No-Speech-Staffel; im Shim-Pfad gibt es dieses Mechanismus nicht.

### Architektur-Entscheidung
Ein Transport-**Seam** (`drivers.mjs`) statt eines zweiten Runners: Persona-Schleife/Judge/Checks/Kosten/Snapshot bleiben in `runner.mjs`; die Transportschicht wandert hinter einen Port (`open/say/finish/close/diagnostics`), analog `src/telephony/ports.js`. `turn.endedVia` ersetzt TeXML-spezifisches `hasHangup`/`!nextTurnUrl`. Feldumbenennung `texmlSamples` → `agentSamples` (rein mechanisch).

### Neue Dateien (Plan)
- `scripts/convo-bench/telnyx-fake.mjs` — lokaler Telnyx-Call-Control-Fake (kein echtes Netz)
- `scripts/convo-bench/driver-texml.mjs` — Bestands-Treiber, verbatim verschoben
- `scripts/convo-bench/driver-shim.mjs` — neuer Treiber fuer den live laufenden Assistant-Pfad, alle vier Shim-Gates scharf (kein Bypass)
- `scripts/convo-bench/drivers.mjs` — Registry, `DEFAULT_DRIVER_ID = shim` (O1)
- 3 neue Szenarien: `zweiter-anruf-gedaechtnis`, `rueckfrage-notausgang`, `anrufbeantworter`
- 3 Testdateien: `al-p8-bench-checks.test.js`, `al-p8-bench-shim-driver.test.js`, `al-p8-bench-shim-gates.test.js`

### Edits (Plan)
- `checks.mjs`: `foldedHits`/`turnRoundtrips` extrahiert (G5), 5 neue transportunabhaengige Messungen (`opening_chars_before_yield`, `handoff_rate`, `recap_present`, `one_question_per_turn`, `roundtrips_per_turn`), additiver `value`-Vertrag
- `runner.mjs`: Transportschicht entfernt/verschoben, `pushSample`, `waitForSummary`
- `convo-bench.mjs`: `--driver`-Flag, `resolveDriverId` fail-closed
- `report.mjs`: `meta.driver`, Warnung bei Treiber-Mismatch im Compare
- 12 Bestands-Szenarien: `MEASUREMENT_CHECKS`-Spread, `hold-warteschleife` auf `drivers:["texml"]` beschraenkt
- `tasks/al-testcall-checklist.md`: 2 offene Abnahmen (Baseline-Lauf mit echtem API-Key, Gegenprobe)

### Pre-Mortem-Kernpunkte
- Default-Treiber `shim` verhindert stilles Weitermessen des toten TeXML-Pfads
- Kein Bypass — alle vier Shim-Gates scharf mit Wegwerf-Werten aus `TELNYX_ASSISTANT_BOOT_ENV`
- Opening kommt ausschliesslich aus dem echten `speak`-Aufruf des Servers (kein Bench-eigener Offenlegungssatz)
- Szenario-Filterung sichtbar geloggt statt stiller Skip; falscher `--scenario`/`--driver` = harter Fehler
- Kostenkontrolle: `--max-turns`, `cost_estimate_usd`, Baseline-Lauf als offene Abnahme ausgelagert
- Blast-Radius: **0 Dateien in `src/`**

---

## 2. Impl-Zusammenfassung

- **headCommit:** `fc6ca66245ef06a820e471485e18e54db5487a0e`
- **node --check:** PASS
- **npm test:** PASS, 3412/3412 gruen
- Treiber-Seam (`drivers.mjs`) umgesetzt wie geplant; `driver-texml.mjs` verbatim verschoben, `driver-shim.mjs` neu implementiert (Call-Control-`speak` + echter `/v1/chat/completions`-Shim, alle vier Gates scharf).
- Lokaler Telnyx-Fake faengt die drei Call-Control-Actions ohne echtes Netz ab.
- 5 neue transportunabhaengige Messungen additiv in jedem Szenario, 3 neue Szenarien, `hold-warteschleife` auf `texml` beschraenkt.
- `texmlSamples` → `agentSamples` durchgaengig umbenannt.
- CLI `--driver` mit fail-closed-Validierung vor dem API-Key-Gate.
- 28 neue Tests (12 Checks + 10 pure Treiber-Bausteine + 6 Spawn-Gate-Beweise), 2 Bestandstestdateien mechanisch angepasst (`texmlSamples`→`agentSamples`).
- **Kein `src/`-Code beruehrt (0 Dateien).**

### Deviations
1. Manueller interaktiver Smoke-Test (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start` + `curl`) **nicht durchgefuehrt**: Boot-Guard verweigert im frischen Worktree ohne Owner-Nummer-Bootstrap den Start (erwartetes Bestandsverhalten, kein AL-P8-Defekt). Ersatzweise decken 6 echte Spawn-Tests mit realen HTTP-Roundtrips denselben Beweis ab.
2. Erster kompletter `npm test`-Lauf zeigte 2 Fehlschlaege; Re-Lauf war gruen — konsistent mit dem dokumentierten vorbestehenden ~12%-Volllast-Flake (Seed-vor-Boot-Race), nicht durch diese Phase verursacht.

---

## 3. Safety-Urteil (final)

**approved: true** — alle Einzelkriterien (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended) **true**.

**Unabhaengiger Testlauf:** frischer Worktree `review-al-p8-r1` (= `phase/al-p8-bench-fix1`). `npm test`: 3393 pass / 0 fail (91,6 s). `npm run test:gates`: 126 pass / 3 fail — exakt der dokumentierte Bestand (Gates 36→3 rot), kein neues Rot. Die drei AL-P8-Dateien isoliert: 29/29 pass. Zusatzprobe verifizierte, dass `test/helpers.js` `child.stderr` in `srv.stdout` mischt und `shimGateReasons` die Gate-Zeilen tatsaechlich sieht (kein stumm-leeres Report-Feld). `git merge-base --is-ancestor master phase/al-p8-bench-fix1` gruen, 0 verwaiste Server-Prozesse.

**Verdict:** PASS — freigegeben. Diff beruehrt ausschliesslich `scripts/convo-bench*`, `test/*`, `tasks/al-testcall-checklist.md`. Null Aenderungen in `src/`, `public/`, `render.yaml`, `.env.example`, `package.json`/`package-lock.json`. Safety-Gates unberuehrt und in einer Hinsicht **gestaerkt**: die Spec-Auflage „kein Bypass-Schalter" ist eingehalten — der Shim-Treiber durchlaeuft alle vier echten Gates (Flag, Bearer via `safeEqual`, ccid-Korrelation, Rate/Budget) mit Wegwerf-Werten, dreifach mit 403-Negativtests belegt (kein Bearer, falscher Bearer, fremde `call_control_id`). Offenlegung: `claude.js`/`bridge.js` nicht im Diff; ein neuer Test (`AL-P8-27`) pinnt zusaetzlich, dass der `speak`-Payload mit dem Offenlegungssatz des Servers beginnt und `ai_assistant_start` erst nach `speak.ended` folgt. Auth fail-closed gestaerkt (kein neuer Endpunkt, Secret ist Testargument statt Modulzugriff). Keine Secrets im Diff (nur Wegwerf-Konstanten, `shim_gates`-Report-Feld traegt nur Reason-Token). Verhalten flag-off byte-identisch trivial erfuellt, da kein Produktionscode angefasst wurde.

### Concerns (nicht blockierend)
1. Doppelte Test-ID `AL-P8-23` (zwei verschiedene Tests in zwei Dateien) — harmlos fuer Regression/Gates-Trennung, koennte spaeter ein `--test-name-pattern` treffen.
2. `DEFAULT_DRIVER_ID = shim` kippt den CLI-Default ueber den Wortlaut der Spec-Abnahme hinaus (die nur `--driver shim` nennt) — konsistent mit der Phasen-Absicht, aber Risiko fuer Baseline-Vergleiche; entschaerft durch `meta.driver` + Compare-Warnung.
3. `AL-P8-23` bis `AL-P8-26` pinnen `TELNYX_API_BASE` nicht auf den lokalen Fake (nur 27/28 tun das) — aktuell kein Egress messbar, aber Flake-/Netzrisiko bei kuenftigen Code-Aenderungen.
4. Ein Test verwendet ein echtes Umlaut-Literal („Zwölf Zeichen") statt ASCII-Transliteration — kosmetisch, aber erwaehnenswert wegen der Umlaut-Wurzel-Lehre.
5. `recap_present` ist ein harter pass/fail-Check (anders als die vier reinen `MEASUREMENT_CHECKS`) mit handgewaehlten Phrasenlisten in 3 Bestandsszenarien — ein Rot dort waere moeglicherweise ein Phrasenlisten-Artefakt, kein Qualitaetsdefekt; kein Blocker, da der Bench kein CI-Gate ist.

---

## 4. Clean-Code-Audit

**blocker: false**, **verdict: PASS.**

Keine S1/S2-Blocker. Diff ausschliesslich Bench-Tooling.

### S1 — keine

### S2 — keine

### S3
1. **G20/N7** — `scripts/convo-bench/driver-shim.mjs:492`: `say(text = SILENT_TURN_SHIM_TEXT)` hat einen Default-Parameter, der im einzigen Aufrufer (`runner.mjs`) nie greift — tote Doku, kein aktiver Pfad. Fix-Vorschlag: Default entfernen oder kommentieren.
2. **G16** — `scripts/convo-bench/checks.mjs:207-211`: `HANDOFF_PHRASES` (deutsche Denylist) ohne Verweis auf Kalibrierungsquelle — unkritisch, da als Best-effort-Heuristik dokumentiert, aber ein Herkunftskommentar waere wartbarkeitsfoerdernd.

### S4
1. **G8** — `driver-shim.mjs` vs. `driver-texml.mjs`: beide erfuellen denselben Port-Vertrag, `driver-texml.mjs` liefert `diagnostics: () => ({})` und `env: {}` als reine No-op-Stubs — leichte Duplizierung leerer Objekt-Literale ueber zwei Dateien; bei einem dritten Treiber lohnt ein `DEFAULT_TRANSPORT`-Spread.

### passNotes (Auszug)
Registry-Pattern (`drivers.mjs`) statt if/switch-Ketten (G23). G5-Dedup aktiv: `foldedHits()`, `turnRoundtrips()`, `pushSample()` vereinen vormals dreifach duplizierte Logik. `bench-constants.mjs` verhindert Literal-Duplikat zwischen Treibern (per Test gepinnt). Magic Numbers durchgehend benannt. Jede neue Check-ID/jedes neue Szenario per Test (`AL-P8-10`/`11`) gegen Registry-Drift abgesichert. Sicherheitsrelevant: Shim-Treiber zieht alle 4 Gates end-to-end statt sie zu stubben, mit 403-Negativtests belegt. Kein toter/auskommentierter Code, keine abgeschalteten Sicherungen.

### topTodos (optional, kein Blocker)
1. Toten Default-Parameter `SILENT_TURN_SHIM_TEXT` in `driver-shim.mjs#say()` entfernen oder kommentieren.
2. Kalibrierungsquelle der `HANDOFF_PHRASES`-Denylist knapp dokumentieren.
3. Kein Handlungsbedarf vor Merge — beide Punkte sind Politur.

---

## 5. Fix-Runden

**r1:** Einzigen genannten Blocker behoben — den duplizierten Literal `"+4915100000099"` (Default-Anrufer) aus `driver-texml.mjs` und `driver-shim.mjs` in eine neue gemeinsame Datei `scripts/convo-bench/bench-constants.mjs` (`BENCH_DEFAULT_CALLER`) extrahiert. Bewusst **keine** Konstante in `drivers.mjs` selbst platziert (Begruendung im Original-Fix-Log abgeschnitten, sinngemaess: `drivers.mjs` ist reine Registry, keine Konstanten-Quelle). Ergebnis: `finalBranch = phase/al-p8-bench-fix1`.

---

## 6. Offene Punkte (nicht Teil dieser Phase)

- **AL-P8 Baseline** (`tasks/al-testcall-checklist.md`): `npm run convo-bench run --all --repeat 5 --driver shim --out data/convo-bench/baseline-al-p8` mit echtem `ANTHROPIC_API_KEY` — kostet echtes Geld, gehoert dem Owner.
- **AL-P8 Gegenprobe**: derselbe Lauf mit `--driver texml` zum Zahlenvergleich, danach ist der TeXML-Treiber Altlast-Referenz.
</content>
